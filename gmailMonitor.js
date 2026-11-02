export const gmailScope = 'https://www.googleapis.com/auth/gmail.metadata';
export const gmailInterval = 15 * 60 * 1000;
export const defaultGmailRules = [{ kind: 'nameOrSubject', value: 'Baverstock Oaks' }];
const addressPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;

export function gmailRules(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Use up to 20 Gmail watch rules.');
  const keys = new Set();
  return value.map(rule => {
    if (!rule || !['address', 'name', 'subject', 'nameOrSubject'].includes(rule.kind) ||
        typeof rule.value !== 'string' || !rule.value.trim() || rule.value.trim().length > 120 || /[\x00-\x1f\x7f]/.test(rule.value)) {
      throw new Error('Each Gmail rule needs a supported match type and 1–120 characters of plain text.');
    }
    const text = rule.value.trim();
    if (rule.kind === 'address' && !addressPattern.test(text)) throw new Error('Enter one complete sender email address, without a display name.');
    const key = `${rule.kind}:${text.toLowerCase()}`;
    if (keys.has(key)) throw new Error('That Gmail watch rule is already present.');
    keys.add(key);
    return { kind: rule.kind, value: rule.kind === 'address' ? text.toLowerCase() : text };
  });
}

function decodeHeader(value) {
  return value.replace(/\?=\s+(?==\?)/g, '?=').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_all, charset, encoding, text) => {
    const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(text, 'base64') :
      Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
    return new TextDecoder(charset).decode(bytes);
  });
}

export function gmailMatch(message, rules = defaultGmailRules) {
  const headers = message.payload?.headers || [];
  const header = name => decodeHeader(headers.find(item => item.name.toLowerCase() === name)?.value || '');
  const subject = header('subject');
  const from = header('from');
  // Only a display name counts, never a bare email address.
  const sender = from.includes('<') ? from.slice(0, from.lastIndexOf('<')).trim().replace(/^"|"$/g, '') : '';
  const mailbox = (from.match(/<([^<>]+)>\s*$/)?.[1] || from).trim().toLowerCase();
  const matches = rules.some(rule => {
    const value = rule.value.toLowerCase();
    if (rule.kind === 'address') return addressPattern.test(mailbox) && mailbox === value;
    if (rule.kind === 'name') return sender.toLowerCase().includes(value);
    if (rule.kind === 'subject') return subject.toLowerCase().includes(value);
    return sender.toLowerCase().includes(value) || subject.toLowerCase().includes(value);
  });
  return { matches, sender, subject };
}

export class GmailApi {
  constructor(oauth) { this.oauth = oauth; }
  async request(resource, params = {}) {
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
      }
      const result = await this.oauth.request({
        url: `https://gmail.googleapis.com/gmail/v1/users/me/${resource}`,
        params: query, timeout: 30000, retry: false
      });
      return result.data;
    } catch (cause) {
      const error = new Error('Gmail request failed. Check connectivity, OAuth consent and Gmail API access.');
      error.response = { status: cause.response?.status, data: { error: cause.response?.data?.error === 'invalid_grant' ? 'invalid_grant' : null } };
      throw error;
    }
  }
  profile() { return this.request('profile'); }
  history(startHistoryId, pageToken) {
    return this.request('history', {
      startHistoryId, pageToken, historyTypes: 'messageAdded', maxResults: 100,
      fields: 'historyId,nextPageToken,history(messagesAdded(message(id,labelIds)))'
    });
  }
  message(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid Gmail message ID.');
    return this.request(`messages/${id}`, {
      format: 'metadata', metadataHeaders: ['From', 'Subject'],
      fields: 'id,internalDate,labelIds,payload(headers)'
    });
  }
}

export class GmailMonitor {
  constructor({ api, state, save, notify, now = Date.now }) {
    this.api = api;
    this.state = state || { connected: false, enabled: false, historyId: null, delivered: [], preview: false };
    this.state = { ...this.state, rules: gmailRules(this.state.rules === undefined ? defaultGmailRules : this.state.rules) };
    this.save = save;
    this.notify = notify;
    this.now = now;
    this.busy = false;
  }
  async exclusive(run) {
    if (this.busy) throw new Error('Gmail is busy. Wait for the current operation to finish.');
    this.busy = true;
    try { return await run(); } finally { this.busy = false; }
  }
  async persist(update) {
    const next = { ...this.state, ...update };
    await this.save(next);
    this.state = next;
  }
  async enable(preview, reset = false) {
    if (typeof preview !== 'boolean') throw new Error('Explicit notification preview choice required.');
    if (this.state.gap && !reset) throw new Error('Gmail history expired. Explicitly approve restarting from now; missed alerts cannot be recovered.');
    const baseline = !this.state.historyId || reset ? await this.api.profile() : null;
    if (baseline && !/^\d+$/.test(baseline.historyId)) throw new Error('Gmail did not return a valid starting checkpoint.');
    await this.persist({
      enabled: true, preview, error: null, gap: false,
      ...(baseline ? { historyId: baseline.historyId, enabledAt: this.now(), delivered: [] } : {})
    });
  }
  async pause() { await this.persist({ enabled: false }); }
  async setRules(rules) { await this.persist({ rules: gmailRules(rules) }); }
  async poll() {
    if (!this.state.enabled) return;
    try {
      const start = this.state.historyId;
      const ids = new Set();
      let pageToken;
      let checkpoint;
      for (let page = 0; page < 100; page++) {
        let response;
        try { response = await this.api.history(start, pageToken); }
        catch (error) {
          if (error.response?.status === 404) {
            await this.persist({ enabled: false, gap: true });
            throw new Error('Gmail history expired. Monitoring paused: missed alerts cannot be recovered. Approve restarting from now.');
          }
          throw error;
        }
        for (const history of response.history || []) for (const added of history.messagesAdded || []) {
          if (added.message.labelIds?.includes('INBOX')) ids.add(added.message.id);
        }
        checkpoint = response.historyId;
        pageToken = response.nextPageToken;
        if (!pageToken) break;
        if (page === 99 || ids.size > 5000) throw new Error('Gmail catch-up limit exceeded. Checkpoint was not advanced; pause and review.');
      }
      if (!/^\d+$/.test(checkpoint)) throw new Error('Gmail returned an invalid checkpoint.');
      for (const id of ids) {
        if (this.state.delivered.includes(id)) continue;
        let message;
        try { message = await this.api.message(id); }
        catch (error) {
          if (error.response?.status === 404) continue; // Removed before metadata could be read.
          throw error;
        }
        if (!message.labelIds?.includes('INBOX')) continue;
        const received = Number(message.internalDate);
        if (!Number.isFinite(received)) throw new Error('Gmail returned an invalid arrival time.');
        if (received < this.state.enabledAt) continue;
        const match = gmailMatch(message, this.state.rules);
        if (!match.matches) continue;
        if (this.state.delivered.length >= 5000) throw new Error('Gmail duplicate-checkpoint limit reached. Monitoring requires operator review.');
        const clean = value => value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 180);
        await this.notify('Peppy Gmail alert', this.state.preview ?
          `${clean(match.sender || 'Matching subject')}: ${clean(match.subject || '(no subject)')}` :
          'A new inbox message matches a notification rule. Open Gmail to review it.');
        await this.persist({ delivered: [...this.state.delivered, id] });
      }
      await this.persist({ historyId: checkpoint, delivered: [], lastSuccess: this.now(), error: null });
    } catch (error) {
      const code = error.response?.status;
      const message = code === 401 || code === 403 || error.code === 'invalid_grant' ||
        error.response?.data?.error === 'invalid_grant' ?
        'Gmail authorization failed. Pause and reconnect Gmail; check API access and consent.' :
        code ? `Gmail check failed (HTTP ${code}). No success is confirmed; checkpoint retained for retry.` :
        error.response ? 'Gmail connection failed. Check Internet access; checkpoint retained for retry.' : error.message;
      await this.persist({ error: message });
      throw new Error(message);
    }
  }
}

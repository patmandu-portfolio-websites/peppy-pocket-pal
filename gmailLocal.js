import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { GmailApi, GmailMonitor, gmailScope, gmailInterval } from './gmailMonitor.js';
import { desktopGmail } from './gmailDesktop.js';

const callbackPath = '/api/local/gmail/callback';
const cookieName = 'peppy_gmail_oauth';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const callbackUrl = 'http://127.0.0.1:3030' + callbackPath;

async function readJson(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 128 * 1024) throw new Error('Gmail configuration must be a regular, unlinked file under 128 KiB.');
  if (process.platform === 'linux' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) throw new Error('Gmail configuration must be owned by this user with chmod 600.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function installLocalGmail(app, stateDir, { desktop = desktopGmail(), makeOauth = config => new OAuth2Client(config.client_id, config.client_secret, callbackUrl) } = {}) {
  const clientPath = path.join(stateDir, 'gmail-client.json');
  const statePath = path.join(stateDir, 'gmail-state.json');
  let state;
  try { state = await readJson(statePath); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Gmail state could not be loaded. Stop Peppy and inspect the private Gmail configuration.'); }
  if (state && (typeof state.connected !== 'boolean' || typeof state.enabled !== 'boolean' || typeof state.preview !== 'boolean' ||
      !Array.isArray(state.delivered) || state.delivered.length > 5000 || !state.delivered.every(id => typeof id === 'string') ||
      (state.historyId !== null && !/^\d+$/.test(state.historyId)) || (state.enabled && (!state.connected || !Number.isFinite(state.enabledAt) || !state.historyId)))) {
    throw new Error('Gmail checkpoint is invalid; refusing to reset it silently.');
  }
  if (state?.alerts !== undefined && (!Array.isArray(state.alerts) || state.alerts.length > 50 ||
      state.alerts.some(item => !item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id) ||
        !Number.isFinite(item.created) || ['sender', 'subject'].some(key => item[key] !== undefined &&
          (typeof item[key] !== 'string' || item[key].length > 180))))) throw new Error('Gmail alert history is invalid; inspect the local state.');
  async function save(next) {
    const temporary = `${statePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, statePath);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async function client() {
    let data;
    try { data = await readJson(clientPath); }
    catch { throw new Error('Configure a private Desktop-app OAuth download at .peppy-local/gmail-client.json (chmod 600 on Ubuntu). Do not use the Render web client or a service-account key.'); }
    const config = data.installed;
    if (!config || typeof config.client_id !== 'string' || !config.client_id.endsWith('.apps.googleusercontent.com') ||
        typeof config.client_secret !== 'string' || !config.client_secret) throw new Error('Gmail requires a Google OAuth Desktop app client download.');
    return makeOauth(config);
  }
  async function authorized() {
    if (!monitor.state.connected) throw new Error('Connect Gmail first.');
    const oauth = await client();
    const refresh = await desktop.read();
    if (!refresh) throw new Error('Gmail credential is missing. Disconnect locally and reconnect.');
    oauth.setCredentials({ refresh_token: refresh });
    return oauth;
  }
  const api = {
    profile: async () => new GmailApi(await authorized()).profile(),
    history: async (...args) => new GmailApi(await authorized()).history(...args),
    message: async (...args) => new GmailApi(await authorized()).message(...args)
  };
  const monitor = new GmailMonitor({ api, state, save, notify: (...args) => desktop.notify(...args) });
  let pending;
  let callbackError = null;
  const endpoint = run => async (req, res) => {
    try { res.json(await monitor.exclusive(() => run(req, res))); }
    catch (error) {
      console.error('Local Gmail operation failed; review the Gmail panel.');
      res.status(400).json({ error: error.message });
    }
  };
  app.get('/api/local/gmail/status', (_req, res) => res.json({
    connected: Boolean(monitor.state.connected), enabled: monitor.state.enabled, preview: monitor.state.preview,
    rules: monitor.state.rules,
    gap: Boolean(monitor.state.gap), lastSuccess: monitor.state.lastSuccess || null, busy: monitor.busy,
    error: callbackError || monitor.state.error || null,
    alerts: monitor.state.alerts.map(item => monitor.state.preview ? item : { id: item.id, created: item.created })
  }));
  app.post('/api/local/gmail/connect', endpoint(async (_req, res) => {
    if (monitor.state.connected) throw new Error('Disconnect the existing Gmail authorization before connecting again.');
    const oauth = await client();
    const verifier = await oauth.generateCodeVerifierAsync();
    const state = crypto.randomBytes(32).toString('hex');
    const cookie = crypto.randomBytes(32).toString('hex');
    pending = { state, cookie: hash(cookie), verifier: verifier.codeVerifier, expires: Date.now() + 10 * 60 * 1000, oauth };
    callbackError = null;
    res.cookie(cookieName, cookie, { httpOnly: true, sameSite: 'lax', path: callbackPath, maxAge: 10 * 60 * 1000 });
    return { url: oauth.generateAuthUrl({
      access_type: 'offline', prompt: 'consent', scope: [gmailScope], include_granted_scopes: false,
      state, code_challenge: verifier.codeChallenge, code_challenge_method: 'S256'
    }) };
  }));
  app.get(callbackPath, async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    const flow = pending;
    if (!flow || flow.expires <= Date.now() || typeof req.query.state !== 'string' || req.query.state !== flow.state || !cookie || hash(cookie) !== flow.cookie) {
      return res.status(400).type('text').send('Gmail authorization state is invalid or expired. Open local Peppy and connect again.');
    }
    pending = null;
    res.clearCookie(cookieName, { path: callbackPath, sameSite: 'lax', httpOnly: true });
    try {
      await monitor.exclusive(async () => {
        if (typeof req.query.code !== 'string' || req.query.error) throw new Error('Consent was not completed.');
        const { tokens } = await flow.oauth.getToken({ code: req.query.code, codeVerifier: flow.verifier, redirect_uri: callbackUrl });
        if (!tokens.access_token || !tokens.refresh_token) throw new Error('Missing credentials.');
        const info = await flow.oauth.getTokenInfo(tokens.access_token);
        if (info.scopes.length !== 1 || info.scopes[0] !== gmailScope) throw new Error('Unexpected Gmail permissions.');
        await desktop.write(tokens.refresh_token);
        await monitor.persist({ connected: true, enabled: false, historyId: null, delivered: [], alerts: [], preview: false, gap: false, error: null });
      });
      callbackError = null;
    } catch {
      callbackError = 'Gmail connection failed. Check consent, Desktop OAuth configuration and the unlocked OS credential store. Only gmail.metadata is accepted; remove earlier broader Peppy grants in Google account settings if necessary. Then reconnect.';
      console.error('Local Gmail connection failed; no credential details logged.');
    }
    res.redirect('/?gmail=returned');
  });
  app.post('/api/local/gmail/enable', endpoint(async req => {
    await monitor.enable(req.body.preview, req.body.restartFromNow === true);
    return { enabled: true };
  }));
  app.post('/api/local/gmail/pause', endpoint(async () => { await monitor.pause(); return { enabled: false }; }));
  app.post('/api/local/gmail/rules', endpoint(async req => {
    await monitor.setRules(req.body.rules);
    return { rules: monitor.state.rules };
  }));
  app.post('/api/local/gmail/dismiss-alert', endpoint(async req => {
    await monitor.dismissAlert(req.body.id);
    return { dismissed: true };
  }));
  app.post('/api/local/gmail/check', endpoint(async () => {
    if (!monitor.state.enabled) throw new Error('Enable Gmail monitoring before checking.');
    await monitor.poll();
    return { checked: true };
  }));
  app.post('/api/local/gmail/test-notification', endpoint(async () => {
    await desktop.notify('Peppy notification test', 'Fictional test only. No Gmail message was read.');
    return { submitted: true };
  }));
  app.post('/api/local/gmail/disconnect', endpoint(async () => {
    pending = null;
    await monitor.pause();
    let revoked = !monitor.state.connected;
    if (monitor.state.connected) {
      try {
        const oauth = await authorized();
        await oauth.revokeToken(oauth.credentials.refresh_token);
        revoked = true;
      } catch { console.error('Gmail remote revocation failed; revoke access in Google account settings.'); }
    }
    if (monitor.state.connected) await desktop.remove();
    await monitor.persist({ connected: false, enabled: false, historyId: null, delivered: [], alerts: [], preview: false, gap: false, error: null, lastSuccess: null });
    callbackError = null;
    if (!revoked) throw new Error('Local Gmail connection removed. Remote revocation was not confirmed: remove Peppy Gmail access in Google account settings. Revoking a shared OAuth client may also disconnect your other installation.');
    return { disconnected: true };
  }));
  const tick = () => {
    if (!monitor.state.enabled || monitor.busy) return;
    void monitor.exclusive(() => monitor.poll()).catch(() => console.error('Background Gmail check failed; inspect the Gmail panel for details.'));
  };
  const timer = setInterval(tick, gmailInterval);
  timer.unref();
  const initial = setTimeout(tick, 1000);
  initial.unref();
  return { stop: () => { clearInterval(timer); clearTimeout(initial); } };
}

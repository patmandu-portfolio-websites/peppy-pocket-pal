import crypto from 'node:crypto';
import { LocalPolicy } from './localPolicy.js';
import { checkedText, validateProposal } from './learning.js';
import { fetchAuthorized } from './localNetwork.js';
import { chromium } from 'playwright';

export const researchIdle = 15 * 60 * 1000;

export function researchUrl(value) {
  const url = new URL(checkedText(value, 'Research URL', 2000));
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.search || url.hash || /(?:login|logout|checkout|subscribe|download|delete|payment)/i.test(decodeURIComponent(url.pathname))) {
    throw new Error('Use a public HTTPS reading URL without credentials, query parameters, ports or account/action paths.');
  }
  return url.href;
}

export async function readResearchPage(url, origins, fetchPage = fetchAuthorized) {
  const policy = new LocalPolicy({ roots: [process.cwd()], origins });
  const response = await fetchPage(policy, researchUrl(url), 512 * 1024, { signal: AbortSignal.timeout(20000) });
  if (response.status < 200 || response.status >= 300) throw new Error('Research page failed or redirected. Approve the exact final URL separately.');
  const type = response.headers['content-type'] || '';
  if (!/^text\/(?:html|plain)\b/i.test(type)) throw new Error('Research accepts only public HTML or plain text, not downloads.');
  if (/^text\/plain\b/i.test(type)) return checkedText(response.body.toString('utf8').slice(0, 8000), 'Website excerpt', 8000);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(response.body.toString('utf8'), { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.locator('script,style,noscript,iframe,form').evaluateAll(elements => elements.forEach(element => element.remove()));
    return checkedText((await page.locator('body').innerText()).slice(0, 8000), 'Website excerpt', 8000);
  } finally { await browser.close(); }
}

export class Research {
  constructor({ state, save, generate, read = readResearchPage, now = Date.now }) {
    this.state = { invitationsEnabled: false, spokenInvitations: false, ideasEnabled: false,
      ideaDay: '', ideaRuns: 0, invitations: [],
      ...(state || { enabled: false, topics: [], origins: [], day: '', runs: 0, drafts: [], plan: null }) };
    this.save = save; this.generate = generate; this.read = read; this.now = now;
    this.busy = false;
    this.activity = now();
    this.seen = 0;
  }
  presence(active) {
    this.seen = this.now();
    if (active) this.activity = this.now();
  }
  eligible() {
    return this.state.enabled && this.idle();
  }
  idle() {
    return this.now() - this.seen < 90000 && this.now() - this.activity >= researchIdle;
  }
  ideasEligible() {
    return this.state.ideasEnabled && this.state.topics.length > 0 && this.idle();
  }
  async conversationSettings(invitationsEnabled, spokenInvitations, ideasEnabled) {
    if ([invitationsEnabled, spokenInvitations, ideasEnabled].some(value => typeof value !== 'boolean')) throw new Error('Explicit conversation settings required.');
    await this.change({ invitationsEnabled, spokenInvitations, ideasEnabled });
    this.activity = this.now();
  }
  async invitationChange(id, kind) {
    const invitation = this.state.invitations.find(item => item.id === id);
    if (!invitation || invitation.status !== 'pending') throw new Error('Pending invitation not found.');
    if (!['dismiss', 'speak'].includes(kind)) throw new Error('Invalid invitation action.');
    if (kind === 'speak' && (!this.state.invitationsEnabled || !this.state.spokenInvitations || invitation.spoken)) throw new Error('Spoken invitation is disabled or already attempted.');
    await this.change({ invitations: this.state.invitations.map(item => item.id === id ?
      { ...item, ...(kind === 'dismiss' ? { status: 'dismissed' } : { spoken: true }) } : item) });
  }
  pendingInvitations() {
    return this.state.invitations.filter(item => item.status === 'pending');
  }
  async idea(approved, findings) {
    if (approved !== true || !this.ideasEligible()) throw new Error('Approve an idea session after 15 idle minutes with idea offers enabled.');
    if (!Array.isArray(findings) || findings.length > 10) throw new Error('Select up to ten reviewed knowledge findings.');
    const reviewed = findings.map(value => validateProposal({ ...value, kind: 'knowledge' }));
    if (this.pendingInvitations().length >= 50) throw new Error('Dismiss some invitations first.');
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const runs = this.state.ideaDay === day ? this.state.ideaRuns : 0;
    if (runs >= 5) throw new Error('Five idea-session daily limit reached (UTC).');
    await this.change({ ideaDay: day, ideaRuns: runs + 1 });
    const result = await this.generate('idea', { topics: this.state.topics, reviewedFindings: reviewed });
    const invitation = { id: crypto.randomUUID(), kind: 'idea', title: checkedText(result.title, 'Idea title', 120),
      content: checkedText(result.content, 'Conversation idea', 2000), created: new Date(this.now()).toISOString(), status: 'pending', spoken: false };
    await this.change({ invitations: [...this.pendingInvitations(), invitation] });
    this.activity = this.now();
    return invitation;
  }
  async change(update) {
    const next = { ...this.state, ...update };
    await this.save(next); this.state = next;
  }
  async exclusive(run) {
    if (this.busy) throw new Error('Research operation already in progress.');
    this.busy = true;
    try { return await run(); } finally { this.busy = false; }
  }
  async configure(enabled, topics) {
    if (typeof enabled !== 'boolean' || !Array.isArray(topics) || topics.length > 10) throw new Error('Use an explicit enable choice and up to ten approved topics.');
    const approved = topics.map(value => checkedText(value, 'Approved topic or selected chat excerpt', 1000));
    if (enabled && !approved.length) throw new Error('Approve at least one topic first.');
    await this.change({ enabled, topics: approved, plan: null });
    this.activity = this.now();
  }
  async plan(approved) {
    if (approved !== true || !this.eligible()) throw new Error('Session requires approval after 15 idle minutes with the Peppy page open.');
    if (this.state.plan) throw new Error('Finish or discard the current plan first.');
    if (this.state.drafts.length >= 20) throw new Error('Review or remove research drafts first.');
    if (this.pendingInvitations().length >= 50) throw new Error('Dismiss some invitations first.');
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const runs = this.state.day === day ? this.state.runs : 0;
    if (runs >= 5) throw new Error('Five-session daily limit reached (UTC).');
    // Persist the paid-attempt count before contacting the model.
    await this.change({ day, runs: runs + 1 });
    const result = await this.generate('plan', { topics: this.state.topics });
    if (!Array.isArray(result.pages) || !result.pages.length || result.pages.length > 10) throw new Error('Research plan must contain 1–10 reading pages.');
    const pages = result.pages.map(page => ({
      url: researchUrl(page.url), reason: checkedText(page.reason, 'Page relevance', 500)
    }));
    const plan = { id: crypto.randomUUID(), pages, topics: [...this.state.topics], day, expires: this.now() + 30 * 60 * 1000 };
    await this.change({ plan });
    return plan;
  }
  async domains(id, origins) {
    const plan = this.state.plan;
    if (!plan || plan.id !== id || plan.expires <= this.now()) throw new Error('Research plan expired or unavailable.');
    if (!Array.isArray(origins)) throw new Error('Approve exact proposed domains.');
    const proposed = new Set(plan.pages.map(page => new URL(page.url).origin));
    for (const origin of origins) if (!proposed.has(origin)) throw new Error('Domain was not proposed in this plan.');
    await this.change({ origins: [...new Set([...this.state.origins, ...origins])].slice(-50) });
  }
  async run(id, approved) {
    const plan = this.state.plan;
    if (approved !== true || !this.state.enabled || !plan || plan.id !== id || plan.expires <= this.now()) throw new Error('Explicit approval of a current research plan required.');
    if (plan.day !== new Date(this.now()).toISOString().slice(0, 10)) throw new Error('Research plan belongs to a previous UTC day; discard and approve a new session.');
    if (this.now() - this.seen >= 90000) throw new Error('Research requires the Peppy page to remain open.');
    if (plan.pages.some(page => !this.state.origins.includes(new URL(page.url).origin))) throw new Error('Approve all proposed domains separately before research.');
    if (this.pendingInvitations().length >= 50) throw new Error('Dismiss some invitations first.');
    // Consume before network activity; retries require a new approved session.
    await this.change({ plan: null });
    const evidence = [];
    for (const page of plan.pages) {
      if (this.now() - this.seen >= 90000) throw new Error('Peppy page closed; research stopped. No further AI analysis authorized.');
      evidence.push({ url: page.url, text: await this.read(page.url, this.state.origins) });
    }
    if (this.now() - this.seen >= 90000) throw new Error('Peppy page closed before AI analysis.');
    const result = await this.generate('notes', { topics: plan.topics, evidence });
    if (!Array.isArray(result.notes) || !result.notes.length || result.notes.length > 10) throw new Error('Invalid research notes.');
    const sources = new Set(evidence.map(item => item.url));
    const notes = result.notes.map(note => {
      const proposal = validateProposal({ ...note, kind: 'knowledge', certainty: 'uncertain' });
      if (!sources.has(proposal.source)) throw new Error('Research note cites a page that was not read.');
      return proposal;
    });
    const draft = { id: plan.id, created: new Date(this.now()).toISOString(), notes, sources: [...sources] };
    const invitation = { id: plan.id, kind: 'research', draftId: draft.id, title: notes[0].title,
      created: draft.created, status: 'pending', spoken: false };
    await this.change({ drafts: [...this.state.drafts, draft], invitations: [...this.pendingInvitations(), invitation] });
    return draft;
  }
}

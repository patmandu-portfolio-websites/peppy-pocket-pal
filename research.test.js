import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Research, researchIdle, researchUrl, readResearchPage } from './research.js';
import { approveProposal } from './learning.js';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';

function fixture() {
  let time = Date.UTC(2026, 10, 3);
  const calls = [];
  let written;
  const research = new Research({
    now: () => time,
    save: async next => { written = structuredClone(next); },
    generate: async (kind, input) => {
      calls.push({ kind, input });
      return kind === 'idea' ? { title: 'A related idea', content: 'An unverified question about the approved topic.' } : kind === 'plan' ? { pages: [{ url: 'https://example.org/article', reason: 'Related to the approved topic.' }] } :
        { notes: [{ title: 'Draft', content: 'Uncertain research finding.', source: 'https://example.org/article' }] };
    },
    read: async (url, origins) => { calls.push({ kind: 'read', url, origins }); return 'Public evidence'; }
  });
  const idle = () => { time += researchIdle; research.presence(false); };
  return { research, calls, idle, advance: ms => { time += ms; }, written: () => written };
}

test('downtime offers do not make paid calls; approvals, presence and independent domain permission are required', async () => {
  const f = fixture();
  await f.research.configure(true, ['Approved topic']);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.research.plan(true), /15 idle/);
  f.idle();
  assert.equal(f.research.eligible(), true);
  await assert.rejects(f.research.plan(false), /approval/);
  const plan = await f.research.plan(true);
  assert.deepEqual(f.calls[0].input.topics, ['Approved topic']);
  assert.equal(f.written().runs, 1);
  await assert.rejects(f.research.run(plan.id, true), /domains separately/);
  await assert.rejects(f.research.domains(plan.id, ['https://other.org']), /not proposed/);
  await f.research.domains(plan.id, ['https://example.org']);
  await assert.rejects(f.research.run(plan.id, false), /approval/);
  const draft = await f.research.run(plan.id, true);
  assert.equal(draft.notes[0].certainty, 'uncertain');
  assert.equal(draft.notes[0].kind, 'knowledge');
  assert.equal(f.research.state.plan, null);
  await assert.rejects(f.research.run(plan.id, true));
  assert.equal(f.research.state.drafts.length, 1);
});

test('attempt quota persists before AI calls; exact five sessions and ten-page limits are enforced', async () => {
  const f = fixture();
  await f.research.configure(true, ['Topic']);
  f.idle();
  f.research.generate = async () => { throw new Error('AI failed'); };
  for (let index = 0; index < 5; index++) await assert.rejects(f.research.plan(true), /AI failed/);
  assert.equal(f.written().runs, 5);
  await assert.rejects(f.research.plan(true), /Five-session/);
  f.advance(24 * 60 * 60 * 1000);
  f.research.presence(false);
  f.research.generate = async () => ({ pages: Array.from({ length: 11 }, () => ({ url: 'https://example.org/article', reason: 'Topic' })) });
  await assert.rejects(f.research.plan(true), /1–10/);
  assert.equal(f.written().runs, 1);
});

test('closed page, expired plans, revoked permissions and fabricated citations are rejected', async () => {
  const f = fixture();
  await f.research.configure(true, ['Topic']); f.idle();
  const plan = await f.research.plan(true);
  await f.research.domains(plan.id, ['https://example.org']);
  f.advance(90000);
  await assert.rejects(f.research.run(plan.id, true), /remain open/);
  f.research.presence(false);
  f.research.generate = async () => ({ notes: [{ title: 'Untrusted', content: 'Draft', source: 'https://other.org/not-read' }] });
  await assert.rejects(f.research.run(plan.id, true), /not read/);
  assert.equal(f.research.state.drafts.length, 0);
  f.research.generate = async () => ({ pages: [{ url: 'https://example.org/article', reason: 'Topic' }] });
  const next = await f.research.plan(true);
  f.advance(31 * 60 * 1000); f.research.presence(false);
  await assert.rejects(f.research.domains(next.id, ['https://example.org']), /expired/);
});

test('reading URLs reject queries, credentials, actions and unsupported schemes', () => {
  for (const url of ['http://example.org', 'https://user:pass@example.org', 'https://example.org/?token=x', 'https://example.org/download', 'https://example.org/%64ownload', 'https://example.org:8443/', 'file:///tmp/test']) {
    assert.throws(() => researchUrl(url));
  }
  assert.equal(researchUrl('https://example.org/article'), 'https://example.org/article');
});

test('text-only reader rejects redirects/downloads and blocks script/embedded page execution', async () => {
  const result = await readResearchPage('https://example.org/article', ['https://example.org'], async (_policy, url, limit, options) => {
    assert.equal(url, 'https://example.org/article');
    assert.equal(limit, 512 * 1024);
    assert.ok(options.signal instanceof AbortSignal);
    return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<body><p>Public research text</p><script>document.body.innerText="Malicious script ran";fetch("https://example.org/action")</script><form>Account form</form><iframe src="https://example.org/action"></iframe></body>') };
  });
  assert.equal(result, 'Public research text');
  await assert.rejects(readResearchPage('https://example.org/article', ['https://example.org'], async () => ({ status: 302 })), /redirected/);
  await assert.rejects(readResearchPage('https://example.org/article', ['https://example.org'], async () => ({ status: 200, headers: { 'content-type': 'application/pdf' } })), /not downloads/);
});

test('ten successful page reads are bounded and saving evidence never enables AI inclusion', async () => {
  const f = fixture();
  await f.research.configure(true, ['Topic']); f.idle();
  f.research.generate = async kind => kind === 'plan' ? {
    pages: Array.from({ length: 10 }, (_, index) => ({ url: `https://example.org/article-${index}`, reason: 'Topic' }))
  } : { notes: [{ title: 'Draft', content: 'Public finding.', source: 'https://example.org/article-0' }] };
  const plan = await f.research.plan(true);
  await f.research.domains(plan.id, ['https://example.org']);
  const draft = await f.research.run(plan.id, true);
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 10);
  const library = approveProposal({ entries: [] }, draft.notes[0], 'note');
  assert.equal(library.entries[0].included, false);
});

test('failed persistence prevents paid requests; interrupted reads consume plan and cannot replay', async () => {
  const f = fixture();
  await f.research.configure(true, ['Topic']); f.idle();
  const save = f.research.save;
  f.research.save = async () => { throw new Error('Disk failed'); };
  await assert.rejects(f.research.plan(true), /Disk failed/);
  assert.equal(f.calls.length, 0);
  f.research.save = save;
  const plan = await f.research.plan(true);
  await f.research.domains(plan.id, ['https://example.org']);
  f.research.read = async () => { throw new Error('Read failed'); };
  await assert.rejects(f.research.run(plan.id, true), /Read failed/);
  assert.equal(f.written().plan, null);
  await assert.rejects(f.research.run(plan.id, true), /approval/);
  assert.equal(f.calls.filter(call => call.kind === 'notes').length, 0);
});

test('idea offers require separate consent, exact idle threshold and only explicitly selected findings', async () => {
  const f = fixture();
  await f.research.configure(false, ['Approved topic']);
  await f.research.conversationSettings(true, false, true);
  assert.equal(f.research.ideasEligible(), false);
  f.advance(researchIdle - 1); f.research.presence(false);
  assert.equal(f.research.ideasEligible(), false);
  f.advance(1);
  assert.equal(f.research.ideasEligible(), true);
  assert.equal(f.research.eligible(), false);
  await assert.rejects(f.research.idea(false, []), /Approve/);
  assert.equal(f.calls.length, 0);
  f.research.generate = async (kind, input) => {
    assert.equal(kind, 'idea');
    assert.deepEqual(input.topics, ['Approved topic']);
    assert.equal(input.reviewedFindings.length, 1);
    assert.equal(input.reviewedFindings[0].title, 'Reviewed');
    return { title: 'A related question', content: 'An unverified idea for discussion.' };
  };
  const finding = { title: 'Reviewed', content: 'Selected evidence', source: 'https://example.org/article', certainty: 'uncertain' };
  await assert.rejects(f.research.idea(true, [{ ...finding, source: 'http://example.org' }]));
  assert.equal(f.written().ideaRuns, 0);
  const invitation = await f.research.idea(true, [finding]);
  assert.equal(invitation.kind, 'idea');
  assert.equal(f.written().ideaRuns, 1);
  assert.equal(f.written().runs, 0);
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 0);
  assert.equal(f.research.ideasEligible(), false);
  await f.research.invitationChange(invitation.id, 'dismiss');
  assert.equal(f.research.pendingInvitations().length, 0);
});

test('idea attempts count failures before AI, persist across restart and reset daily independently', async () => {
  const f = fixture();
  await f.research.configure(true, ['Topic']);
  await f.research.conversationSettings(true, false, true); f.idle();
  f.research.generate = async () => { throw new Error('Paid failure'); };
  for (let index = 0; index < 5; index++) await assert.rejects(f.research.idea(true, []), /Paid failure/);
  assert.equal(f.written().ideaRuns, 5);
  assert.equal(f.written().runs, 0);
  await assert.rejects(f.research.idea(true, []), /Five idea-session/);
  const restored = new Research({ state: f.written(), save: async () => {}, generate: f.research.generate });
  assert.equal(restored.state.ideaRuns, 5);
  f.advance(24 * 60 * 60 * 1000); f.research.presence(false);
  await assert.rejects(f.research.idea(true, []), /Paid failure/);
  assert.equal(f.written().ideaRuns, 1);
});

test('successful research creates one invitation without an extra call; speech claim is opt-in and one-use', async () => {
  const f = fixture();
  await f.research.configure(true, ['Topic']); f.idle();
  const plan = await f.research.plan(true);
  await f.research.domains(plan.id, ['https://example.org']);
  await f.research.run(plan.id, true);
  assert.equal(f.research.state.invitations.length, 1);
  const invitation = f.research.state.invitations[0];
  assert.equal(invitation.draftId, plan.id);
  assert.deepEqual(f.calls.map(call => call.kind), ['plan', 'read', 'notes']);
  await assert.rejects(f.research.invitationChange(invitation.id, 'speak'), /disabled/);
  await f.research.conversationSettings(true, true, false);
  await f.research.invitationChange(invitation.id, 'speak');
  assert.equal(f.written().invitations[0].spoken, true);
  await assert.rejects(f.research.invitationChange(invitation.id, 'speak'), /already attempted/);
  await f.research.invitationChange(invitation.id, 'dismiss');
  await assert.rejects(f.research.invitationChange(invitation.id, 'speak'), /not found/);
});

test('built research UI separates domain, paid-run and library approvals at mobile widths', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const f = fixture();
  await f.research.configure(true, ['Harmless public topic']); f.idle();
  const app = express();
  app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ configured: true, downtimeResearch: true }));
  app.get('/api/local/research', (_req, res) => res.json({ ...f.research.state, eligible: true, ideasEligible: f.research.state.ideasEnabled }));
  app.post('/api/local/research/presence', (_req, res) => res.json({ eligible: true }));
  app.post('/api/local/research/conversation-settings', async (req, res) => {
    await f.research.conversationSettings(req.body.invitationsEnabled, req.body.spokenInvitations, req.body.ideasEnabled);
    res.json(f.research.state);
  });
  app.post('/api/local/research/invitation', async (req, res) => {
    try { await f.research.invitationChange(req.body.id, req.body.kind); res.json(f.research.state); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/local/research/idea', async (req, res) => {
    try {
      f.idle();
      res.json(await f.research.idea(req.body.approved, req.body.findings));
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  const speeches = [];
  app.post('/api/speech', (req, res) => { speeches.push(req.body.text); res.type('audio/mpeg').send(Buffer.from('fictional test audio')); });
  for (const kind of ['plan', 'domains', 'run']) app.post(`/api/local/research/${kind}`, async (req, res) => {
    try {
      const result = kind === 'plan' ? await f.research.plan(req.body.approved) :
        kind === 'domains' ? await f.research.domains(req.body.id, req.body.origins) : await f.research.run(req.body.id, req.body.approved);
      res.json(result || {});
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await page.addInitScript(() => {
    window.Audio = class {
      async play() { setTimeout(() => this.onended?.(), 20); }
      pause() {}
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  await page.getByText('Downtime research — Ubuntu only', { exact: true }).click();
  await page.getByRole('button', { name: 'Approve paid research session and propose pages', exact: true }).click();
  const run = page.getByRole('button', { name: 'Approve reading these pages and paid AI analysis', exact: true });
  await run.waitFor();
  assert.equal(await run.isDisabled(), true);
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 0);
  await page.getByRole('button', { name: 'Approve research domain https://example.org', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Approve reading these pages and paid AI analysis' && !button.disabled));
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 0);
  await run.click();
  const save = page.getByRole('button', { name: 'Approve saving this note, excluded from AI chat', exact: true });
  await save.waitFor();
  await save.click();
  const included = await page.evaluate(() => JSON.parse(localStorage.getItem('peppy-learning-v1')).entries[0].included);
  assert.equal(included, false);
  assert.equal(await page.getByRole('region', { name: 'Peppy conversation invitation' }).count(), 0);
  await page.getByLabel('Show invitation cards after research or idea sessions', { exact: true }).check();
  await page.getByRole('button', { name: 'Save invitation and idea settings', exact: true }).click();
  const card = page.getByRole('region', { name: 'Peppy conversation invitation' });
  await card.waitFor();
  assert.equal(speeches.length, 0);
  await card.getByRole('button', { name: 'Prepare chat about the first finding', exact: true }).click();
  assert.match(await page.getByRole('textbox', { name: 'Your message', exact: true }).inputValue(), /Source: https:\/\/example.org\/article/);
  assert.equal(await page.locator('.message.user').count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('peppy-learning-v1')).entries[0].included), false);
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('');
  await page.getByLabel('Automatically speak a short invitation when spoken replies are enabled (paid voice request)', { exact: true }).check();
  await page.getByRole('button', { name: 'Save invitation and idea settings', exact: true }).click();
  assert.equal(speeches.length, 0);
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('I am typing');
  await page.getByRole('button', { name: 'Spoken replies', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(speeches.length, 0);
  const speechResponse = page.waitForResponse(response => response.url().endsWith('/api/speech'));
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('');
  await speechResponse;
  assert.equal(speeches.length, 1);
  assert.match(speeches[0], /research finding/);
  await page.reload();
  await page.getByRole('region', { name: 'Peppy conversation invitation' }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(speeches.length, 1);
  await page.getByText('Downtime research — Ubuntu only', { exact: true }).click();
  await page.getByRole('button', { name: 'Spoken replies', exact: true }).click();
  await page.getByLabel('Offer separate idea sessions after 15 idle minutes', { exact: true }).check();
  await page.getByRole('button', { name: 'Save invitation and idea settings', exact: true }).click();
  assert.equal(f.calls.filter(call => call.kind === 'idea').length, 0);
  await page.getByLabel('Approve using reviewed finding for this idea session: Draft', { exact: true }).check();
  await page.getByRole('button', { name: 'Approve paid idea session using topics and selected findings', exact: true }).click();
  await page.getByText('A related idea', { exact: false }).waitFor();
  const ideaCall = f.calls.find(call => call.kind === 'idea');
  assert.equal(ideaCall.input.reviewedFindings.length, 1);
  assert.equal(ideaCall.input.reviewedFindings[0].title, 'Draft');
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 1);
  assert.equal(speeches.length, 1);
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { GmailApi, GmailMonitor, gmailMatch, gmailRules, gmailScope } from './gmailMonitor.js';
import { installLocalGmail } from './gmailLocal.js';

const message = (subject, from = 'School <school@example.test>', received = 1100) => ({
  labelIds: ['INBOX'], internalDate: String(received),
  payload: { headers: [{ name: 'Subject', value: subject }, { name: 'From', value: from }] }
});

test('Gmail rule matches display name or subject, including encoded headers, not bare email addresses', () => {
  assert.equal(gmailMatch(message('News', '"BAVERSTOCK OAKS School" <school@example.test>')).matches, true);
  assert.equal(gmailMatch(message('News from Baverstock Oaks')).matches, true);
  assert.equal(gmailMatch(message('News', '"Different School" <baverstock oaks@example.test>')).matches, false);
  assert.equal(gmailMatch(message('News', 'baverstock oaks@example.test')).matches, false);
  assert.equal(gmailMatch(message('=?UTF-8?B?QmF2ZXJzdG9jayBPYWtz?=')).matches, true);
  assert.equal(gmailMatch(message('=?UTF-8?Q?Baverstock_Oaks?=')).matches, true);
  assert.equal(gmailMatch(message('=?UTF-8?Q?Baverstock_?= =?UTF-8?Q?Oaks?=')).matches, true);
  assert.equal(gmailMatch(message('Other news')).matches, false);
});

test('editable Gmail rules use exact addresses or literal text, reject invalid/duplicate rules and honor empty lists', () => {
  const address = gmailRules([{ kind: 'address', value: ' SCHOOL@Example.Test ' }]);
  assert.equal(address[0].value, 'school@example.test');
  assert.equal(gmailMatch(message('Hello'), address).matches, true);
  assert.equal(gmailMatch(message('Hello', 'school@example.test'), address).matches, true);
  assert.equal(gmailMatch(message('school@example.test', 'School <other@example.test>'), address).matches, false);
  assert.equal(gmailMatch(message('Hello', 'School <school@example.test.evil>'), address).matches, false);
  assert.equal(gmailMatch(message('School update'), [{ kind: 'subject', value: 'school' }]).matches, true);
  assert.equal(gmailMatch(message('Other'), [{ kind: 'name', value: 'school' }]).matches, true);
  assert.equal(gmailMatch(message('School update', 'Other <other@example.test>'), [{ kind: 'name', value: 'school' }]).matches, false);
  assert.equal(gmailMatch(message('Baverstock Oaks'), []).matches, false);
  assert.throws(() => gmailRules([{ kind: 'address', value: 'not-an-address' }]), /complete sender email/);
  assert.throws(() => gmailRules([{ kind: 'body', value: 'secret' }]), /supported match type/);
  assert.throws(() => gmailRules([{ kind: 'subject', value: ' ' }]), /plain text/);
  assert.throws(() => gmailRules([{ kind: 'subject', value: 'School' }, { kind: 'subject', value: 'school' }]), /already present/);
  assert.throws(() => gmailRules(Array.from({ length: 21 }, (_, index) => ({ kind: 'subject', value: String(index) }))), /20/);
});

function monitorFixture() {
  let time = 1000;
  const notices = [];
  const messages = new Map([
    ['match', message('Baverstock Oaks news')], ['other', message('Other news')],
    ['old', message('Baverstock Oaks old news', undefined, 900)],
    ['archived', { ...message('Baverstock Oaks archived'), labelIds: [] }]
  ]);
  const pages = [{
    historyId: '11', nextPageToken: 'next',
    history: [{ messagesAdded: ['match', 'other', 'old', 'archived'].map(id => ({ message: { id, labelIds: ['INBOX'] } })) }]
  }, {
    historyId: '12',
    history: [{ messagesAdded: [{ message: { id: 'match', labelIds: ['INBOX'] } }] }]
  }];
  const api = {
    profile: async () => ({ historyId: '10' }),
    history: async (_start, token) => pages[token ? 1 : 0],
    message: async id => messages.get(id)
  };
  let saved;
  const save = async next => { saved = structuredClone(next); };
  const notify = async (title, body) => notices.push({ title, body });
  const monitor = new GmailMonitor({ api, save, notify, now: () => time });
  return { monitor, api, notices, save, notify, saved: () => saved, advance: ms => { time += ms; } };
}

test('Gmail baselines on enable, filters arrivals, paginates, deduplicates and resumes without AI or mailbox writes', async () => {
  const f = monitorFixture();
  await f.monitor.enable(false);
  assert.equal(f.saved().historyId, '10');
  await f.monitor.poll();
  assert.equal(f.notices.length, 1);
  assert.doesNotMatch(f.notices[0].body, /news/);
  assert.equal(f.saved().historyId, '12');
  assert.deepEqual(f.saved().delivered, []);
  await f.monitor.pause();
  f.api.profile = async () => assert.fail('Resume must not discard checkpoint');
  await f.monitor.enable(true);
  f.api.history = async start => {
    assert.equal(start, '12');
    return { historyId: '13' };
  };
  await f.monitor.poll();
  assert.equal(f.saved().preview, true);
  assert.equal(f.notices.length, 1);
  assert.doesNotMatch(JSON.stringify(f.saved()), /School|news|example\.test/);
});

test('notification failure retains checkpoint and delivered IDs survive restart for catch-up', async () => {
  const f = monitorFixture();
  await f.monitor.enable(true);
  let attempts = 0;
  f.api.history = async () => ({ historyId: '12', history: [{ messagesAdded: ['a', 'b'].map(id => ({ message: { id, labelIds: ['INBOX'] } })) }] });
  f.api.message = async () => message('Baverstock Oaks news');
  f.monitor.notify = async (...args) => { if (++attempts === 2) throw new Error('Desktop notification failed'); await f.notify(...args); };
  await assert.rejects(f.monitor.poll(), /Desktop notification failed/);
  assert.equal(f.saved().historyId, '10');
  assert.deepEqual(f.saved().delivered, ['a']);
  const resumed = new GmailMonitor({ api: f.api, state: f.saved(), save: f.save, notify: f.notify });
  await resumed.poll();
  assert.equal(f.notices.length, 2);
  assert.match(f.notices[1].body, /Baverstock Oaks news/);
  assert.equal(f.saved().historyId, '12');
});

test('saving watch rules persists per installation without discarding history or enabling monitoring', async () => {
  const f = monitorFixture();
  await f.monitor.enable(false);
  await f.monitor.pause();
  await f.monitor.setRules([{ kind: 'subject', value: 'Other news' }]);
  assert.equal(f.saved().enabled, false);
  assert.equal(f.saved().historyId, '10');
  await f.monitor.enable(true);
  await f.monitor.poll();
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0].body, /Other news/);
  await f.monitor.setRules([]);
  await f.monitor.poll();
  assert.equal(f.notices.length, 1);
  await assert.rejects(f.monitor.setRules([{ kind: 'address', value: 'invalid' }]));
  assert.deepEqual(f.saved().rules, []);
});

test('expired history pauses visibly; revocation, capacity and concurrent operations never silently reset state', async () => {
  const f = monitorFixture();
  await f.monitor.enable(false);
  f.api.history = async () => { const error = new Error('expired'); error.response = { status: 404 }; throw error; };
  await assert.rejects(f.monitor.poll(), /history expired/);
  assert.equal(f.saved().enabled, false);
  await assert.rejects(f.monitor.enable(false), /Explicitly/);
  await f.monitor.enable(false, true);
  f.api.history = async () => { const error = new Error('credential details'); error.response = { status: 401 }; throw error; };
  await assert.rejects(f.monitor.poll(), /authorization failed/);
  assert.doesNotMatch(f.saved().error, /credential details/);
  f.api.history = async () => ({ historyId: '12', nextPageToken: 'more' });
  await assert.rejects(f.monitor.poll(), /limit exceeded/);
  assert.equal(f.saved().historyId, '10');
  await f.monitor.exclusive(async () => {
    await assert.rejects(f.monitor.exclusive(() => f.monitor.pause()), /busy/);
  });
});

test('Gmail adapter only requests profile, history and selected metadata with repeated header parameters', async () => {
  const calls = [];
  const api = new GmailApi({ request: async options => { calls.push(options); return { data: {} }; } });
  await api.profile();
  await api.history('10');
  await api.message('abc123');
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
  assert.equal(calls[1].params.has('pageToken'), false);
  assert.deepEqual(calls[2].params.getAll('metadataHeaders'), ['From', 'Subject']);
  assert.equal(calls[2].params.get('format'), 'metadata');
  assert.equal(calls.some(call => call.method && call.method !== 'GET'), false);
  assert.throws(() => api.message('../modify'), /Invalid/);
  const failing = new GmailApi({ request: async () => { throw new Error('sensitive upstream message'); } });
  await assert.rejects(failing.profile(), error => !error.message.includes('sensitive'));
});

async function localFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'peppy-gmail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'gmail-client.json'), JSON.stringify({ installed: { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'fixture' } }), { mode: 0o600 });
  let token = '';
  let oauthState;
  let scopes = [gmailScope];
  const notices = [];
  const desktop = {
    read: async () => token, write: async value => { token = value; }, remove: async () => { token = ''; },
    notify: async (title, body) => notices.push({ title, body })
  };
  const oauth = {
    generateCodeVerifierAsync: async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
    generateAuthUrl: options => {
      assert.deepEqual(options.scope, [gmailScope]);
      assert.equal(options.include_granted_scopes, false);
      assert.equal(options.code_challenge_method, 'S256');
      oauthState = options.state;
      return `https://accounts.google.com/test?state=${oauthState}`;
    },
    getToken: async options => {
      assert.equal(options.codeVerifier, 'verifier');
      assert.equal(options.redirect_uri, 'http://127.0.0.1:3030/api/local/gmail/callback');
      return { tokens: { access_token: 'fixture-access', refresh_token: 'fixture-refresh' } };
    },
    getTokenInfo: async () => ({ scopes }),
    setCredentials: credentials => { assert.equal(credentials.refresh_token, 'fixture-refresh'); oauth.credentials = credentials; },
    request: async options => ({ data: options.url.endsWith('profile') ? { historyId: '10' } : { historyId: '11' } }),
    revokeToken: async token => assert.equal(token, 'fixture-refresh')
  };
  const app = express();
  app.use(express.json());
  const control = await installLocalGmail(app, directory, { desktop, makeOauth: () => oauth });
  t.after(() => control.stop());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (kind, body = {}) => fetch(`${base}/api/local/gmail/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const status = async () => (await fetch(base + '/api/local/gmail/status')).json();
  const finish = async () => {
    const begin = await post('connect');
    const cookie = begin.headers.get('set-cookie').split(';')[0];
    return fetch(`${base}/api/local/gmail/callback?state=${oauthState}&code=fixture`, { headers: { cookie }, redirect: 'manual' });
  };
  return { app, base, post, status, finish, notices, directory, oauth, desktop, control, token: () => token, scopes: value => { scopes = value; } };
}

test('local Gmail OAuth binds cookie/state and PKCE, grants only metadata, persists no plaintext token and disconnects', async t => {
  const f = await localFixture(t);
  assert.equal((await f.status()).connected, false);
  const begin = await f.post('connect');
  const url = new URL((await begin.json()).url);
  const cookie = begin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${f.base}/api/local/gmail/callback?state=${url.searchParams.get('state')}&code=x`)).status, 400);
  assert.equal((await fetch(`${f.base}/api/local/gmail/callback?state=wrong&code=x`, { headers: { cookie } })).status, 400);
  assert.equal((await f.finish()).status, 302);
  assert.equal((await fetch(`${f.base}/api/local/gmail/callback?state=${url.searchParams.get('state')}&code=x`, { headers: { cookie } })).status, 400);
  assert.equal(f.token(), 'fixture-refresh');
  assert.equal((await f.status()).enabled, false);
  assert.equal((await f.post('rules', { rules: [{ kind: 'address', value: 'school@example.test' }] })).status, 200);
  assert.equal((await f.status()).rules[0].value, 'school@example.test');
  assert.equal((await f.post('rules', { rules: [{ kind: 'address', value: 'invalid' }] })).status, 400);
  assert.equal((await f.post('enable', { preview: false })).status, 200);
  assert.equal((await f.post('check')).status, 200);
  const disk = await fs.readFile(path.join(f.directory, 'gmail-state.json'), 'utf8');
  assert.doesNotMatch(disk, /fixture-refresh|fixture-access/);
  assert.equal((await f.post('pause')).status, 200);
  assert.equal((await f.post('test-notification')).status, 200);
  assert.equal(f.notices.length, 1);
  assert.equal((await f.post('disconnect')).status, 200);
  assert.equal(f.token(), '');
  assert.equal((await f.status()).connected, false);
  f.scopes([gmailScope, 'https://mail.google.com/']);
  await f.finish();
  assert.equal((await f.status()).connected, false);
  assert.match((await f.status()).error, /connection failed/);
  assert.equal(f.token(), '');
});

test('disconnect reports unconfirmed Google revocation while removing local credentials', async t => {
  const f = await localFixture(t);
  await f.finish();
  f.oauth.revokeToken = async () => { throw new Error('Remote unavailable'); };
  const result = await f.post('disconnect');
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /Remote revocation was not confirmed/);
  assert.equal(f.token(), '');
  assert.equal((await f.status()).connected, false);
  assert.equal((await f.post('disconnect')).status, 200);
});

test('local restart preserves monitoring checkpoints; malformed state is rejected rather than reset', async t => {
  const f = await localFixture(t);
  await f.finish();
  await f.post('enable', { preview: false });
  await f.post('check');
  f.control.stop();
  const restart = express();
  const control = await installLocalGmail(restart, f.directory, { desktop: f.desktop, makeOauth: () => f.oauth });
  t.after(() => control.stop());
  const state = JSON.parse(await fs.readFile(path.join(f.directory, 'gmail-state.json'), 'utf8'));
  assert.equal(state.historyId, '11');
  assert.equal(state.enabled, true);
  control.stop();
  await fs.writeFile(path.join(f.directory, 'gmail-state.json'), JSON.stringify({ ...state, historyId: 'invalid' }), { mode: 0o600 });
  await assert.rejects(installLocalGmail(express(), f.directory, { desktop: f.desktop }), /checkpoint is invalid/);
});

test('built Gmail UI requires separate consent, previews choice, pause, test and disconnect', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const f = await localFixture(t);
  await f.finish();
  f.app.get('/api/status', (_req, res) => res.json({ configured: true, localAssistant: true }));
  f.app.get('/api/local/config', (_req, res) => res.json({ roots: [], origins: [] }));
  f.app.use(express.static(path.join(process.cwd(), 'dist')));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(f.base) ? route.continue() : route.abort());
  await page.goto(f.base);
  await page.getByText('Gmail desktop notifications — this computer only', { exact: true }).click();
  await page.getByText('Connected, paused', { exact: false }).waitFor();
  await page.getByLabel('Gmail rule value', { exact: true }).fill('school@example.test');
  await page.getByRole('button', { name: 'Add Gmail watch rule', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Gmail rule school@example.test', exact: true }).waitFor();
  assert.equal((await f.status()).rules.length, 2);
  await page.getByRole('button', { name: 'Remove Gmail rule Baverstock Oaks', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Gmail rule Baverstock Oaks', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual((await f.status()).rules, [{ kind: 'address', value: 'school@example.test' }]);
  await page.getByRole('button', { name: 'Send fictional desktop notification test' }).click();
  await page.getByText('Notification submitted to this desktop.', { exact: false }).waitFor();
  assert.equal(f.notices.length, 1);
  await page.getByLabel('Allow sender and subject in desktop notifications (otherwise generic alerts)').check();
  await page.getByRole('button', { name: 'Enable / resume Gmail monitoring' }).click();
  await page.getByText('Monitoring enabled', { exact: false }).waitFor();
  assert.equal((await f.status()).preview, true);
  await page.getByRole('button', { name: 'Check Gmail now' }).click();
  await page.getByText('Last successful check:', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Pause Gmail monitoring' }).click();
  await page.getByText('Connected, paused', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Disconnect Gmail and remove local authorization' }).click();
  await page.getByText('Status: Disconnected.', { exact: false }).waitFor();
  assert.equal(f.token(), '');
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
});

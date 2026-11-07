import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { installSuno, installSunoCallback, sunoSongs } from './sunoApi.js';

const draft = { title: 'Adventure', lyrics: '[Verse]\nWe start again', style: 'Warm acoustic pop' };
const songs = [{ id: 'song1', title: 'Adventure', audio_url: 'https://cdn.example.com/song.mp3' }];

test('SunoAPI approval, idempotency, ownership and safe result validation', async t => {
  const app = express();
  app.use(express.json());
  installSunoCallback(app);
  let generates = 0;
  let uncertain = false;
  installSuno(app, { getKey: () => 'test-placeholder', fetchImpl: async (url, options) => {
    assert.ok(url.startsWith('https://api.sunoapi.org/api/v1/'));
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') {
      generates++;
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'V4_5PLUS');
      assert.equal(body.customMode, true);
      assert.equal(body.prompt, draft.lyrics);
      assert.equal(body.callBackUrl, 'https://peppy-pocket-pal.onrender.com/api/music/suno/callback');
      if (uncertain) throw new Error('Provider timeout');
      return Response.json({ code: 200, data: { taskId: 'task1' } });
    }
    assert.ok(url.includes('record-info?taskId=task1'));
    return Response.json({ code: 200, data: { taskId: 'task1', status: 'SUCCESS', response: { sunoData: songs } } });
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestId = '11111111-1111-4111-8111-111111111111';
  const send = (body, cookie = 'owner=a') => fetch(`${base}/api/music/suno/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify(body)
  });
  assert.equal((await send({ draft, requestId })).status, 400);
  assert.equal(generates, 0);
  const approval = { draft, requestId, approved: true };
  const responses = await Promise.all([send(approval), send(approval)]);
  assert.deepEqual(responses.map(response => response.status), [202, 202]);
  assert.equal(generates, 1);
  assert.equal((await send({ ...approval, draft: { ...draft, title: 'Changed' } })).status, 409);
  const result = await fetch(`${base}/api/music/suno/tasks/${requestId}`, { headers: { Cookie: 'owner=a' } });
  assert.equal((await result.json()).task.songs[0].url, songs[0].audio_url);
  assert.equal((await fetch(`${base}/api/music/suno/tasks/${requestId}`, { headers: { Cookie: 'owner=b' } })).status, 404);
  assert.equal((await fetch(`${base}/api/music/suno/callback`, { method: 'POST' })).status, 204);
  uncertain = true;
  const second = { ...approval, requestId: '22222222-2222-4222-8222-222222222222' };
  assert.equal((await send(second)).status, 502);
  assert.equal((await send(second)).status, 502);
  assert.equal(generates, 2, 'Uncertain submissions must not be repeated');
  for (const audio_url of ['javascript:alert(1)', 'http://cdn.example.com/song', 'https://127.0.0.1/song', 'https://user:password@example.com/song']) {
    assert.throws(() => sunoSongs({ response: { data: [{ ...songs[0], audio_url }] } }));
  }
});

test('chat drafts require separate approval and show generated song links without automatic playback', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  app.get('/api/music/suno/config', (_req, res) => res.json({ configured: true }));
  app.post('/api/music/draft', (_req, res) => res.json({ draft }));
  let submissions = 0;
  app.post('/api/music/suno/generate', (req, res) => {
    assert.equal(req.body.approved, true);
    assert.deepEqual(req.body.draft, draft);
    submissions++;
    res.status(202).json({ task: { requestId: req.body.requestId, status: 'PENDING', songs: [] } });
  });
  app.get('/api/music/suno/tasks/:id', (req, res) => res.json({ task: { requestId: req.params.id, status: 'SUCCESS',
    songs: [{ id: 'song1', title: 'Adventure', url: songs[0].audio_url }] } }));
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base);
    const before = submissions;
    const input = page.getByRole('textbox', { name: 'Your message', exact: true });
    await input.fill('Peppy, write a song about a new adventure');
    await input.press('Enter');
    await page.getByLabel('Original lyrics', { exact: true }).waitFor();
    assert.equal(submissions, before);
    const generate = page.getByRole('button', { name: 'Generate song — uses paid credits', exact: true });
    assert.equal(await generate.isDisabled(), true);
    await page.getByLabel(/I approve sending this draft/).check();
    await generate.click();
    await page.getByRole('status').filter({ hasText: 'Song generation: PENDING' }).waitFor();
    assert.equal(await generate.isDisabled(), true);
    await page.getByRole('button', { name: 'Refresh song status', exact: true }).click();
    const link = page.getByRole('link', { name: 'Open generated song: Adventure', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), songs[0].audio_url);
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(submissions, before + 1);
    assert.equal(await page.locator('audio,video').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
});

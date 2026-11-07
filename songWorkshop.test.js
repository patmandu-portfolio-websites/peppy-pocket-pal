import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { songWorkshopHandler, validateSongDraft } from './songWorkshop.js';

const draft = { title: 'New Horizons', lyrics: '[Verse]\nA new morning lights the way\n\n[Chorus]\nWe go forward every day',
  style: 'Warm acoustic pop, 100 BPM, guitar and piano, gentle original vocals.' };

test('song drafts require complete bounded strings', () => {
  assert.deepEqual(validateSongDraft(draft), draft);
  for (const value of [null, [], {}, { ...draft, lyrics: '' }, { ...draft, title: 5 },
    { ...draft, style: 'x'.repeat(1001) }, { ...draft, lyrics: 'x'.repeat(8001) }]) assert.throws(() => validateSongDraft(value));
});

test('song route validates input and returns structured original drafts with explicit provider failures', async t => {
  const app = express();
  app.use(express.json());
  let calls = 0;
  let output = { output_text: JSON.stringify(draft), status: 'completed' };
  app.post('/api/music/draft', songWorkshopHandler(() => ({ responses: { create: async (request, options) => {
    calls++;
    assert.deepEqual(JSON.parse(request.input), { brief: 'A new adventure', genre: 'Pop', mood: 'Hopeful' });
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.match(request.instructions, /original/i);
    assert.equal(request.tools, undefined);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.timeout, 60000);
    return output;
  } } })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/music/draft`;
  const send = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const brief = { brief: 'A new adventure', genre: 'Pop', mood: 'Hopeful' };
  for (const body of [{}, { ...brief, brief: ' ' }, { ...brief, brief: 'x'.repeat(2001) },
    { ...brief, genre: 'x'.repeat(101) }, { ...brief, mood: null }]) assert.equal((await send(body)).status, 400);
  assert.equal(calls, 0);
  const response = await send({ ...brief, messages: [{ content: 'Private chat' }], memory: 'Private memory' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { draft });
  for (const bad of [{ output_text: 'not json' }, { output_text: '{}' }, { status: 'incomplete', output_text: JSON.stringify(draft) }, { output: [{ type: 'refusal' }] }]) {
    output = bad;
    const failure = await send(brief);
    assert.equal(failure.status, 502);
    assert.match((await failure.json()).error, /No song was sent to Suno/);
  }
});

test('Song workshop generates, edits and copies drafts with manual Suno handoff on desktop and phone', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  const requests = [];
  let fail = false;
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  app.get('/api/music/suno/config', (_req, res) => res.json({ configured: false }));
  app.post('/api/music/draft', (req, res) => {
    requests.push(req.body);
    if (fail) return res.status(502).json({ error: 'Provider unavailable. No song was sent to Suno.' });
    res.json({ draft });
  });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [1280, 390]) {
    fail = false;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => console.error('Workshop browser error:', error.message));
    await page.addInitScript(() => {
      window.copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
        if (window.copyFails) throw new Error('Clipboard blocked');
        window.copied.push(text);
      } } });
    });
    const outside = [];
    await page.route('**/*', route => {
      if (route.request().url().startsWith(base)) return route.continue();
      outside.push(route.request().url());
      return route.abort();
    });
    await page.goto(base);
    await page.getByText('Song workshop - lyrics and music prompt', { exact: true }).click();
    const generate = page.getByRole('button', { name: 'Generate song draft', exact: true });
    assert.equal(await generate.isDisabled(), true);
    await page.getByLabel('Song idea', { exact: true }).fill('A new adventure');
    await generate.click();
    await page.getByRole('status').filter({ hasText: 'Draft ready for review.' }).waitFor();
    const lyrics = page.getByLabel('Original lyrics', { exact: true });
    await lyrics.waitFor();
    assert.equal(await lyrics.inputValue(), draft.lyrics);
    assert.deepEqual(requests.at(-1), { brief: 'A new adventure', genre: 'Acoustic pop', mood: 'Warm and uplifting' });
    await lyrics.fill(`${draft.lyrics}\nMy new line`);
    await page.getByRole('button', { name: 'Copy lyrics', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Lyrics copied.' }).waitFor();
    await page.getByRole('button', { name: 'Copy style prompt', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Style prompt copied.' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copied), [`${draft.lyrics}\nMy new line`, draft.style]);
    await page.evaluate(() => { window.copyFails = true; });
    await page.getByRole('button', { name: 'Copy lyrics', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Clipboard blocked' }).waitFor();
    fail = true;
    await generate.click();
    await page.getByRole('alert').filter({ hasText: 'Provider unavailable' }).waitFor();
    assert.equal(await lyrics.inputValue(), `${draft.lyrics}\nMy new line`);
    const link = page.getByRole('link', { name: 'Open Suno', exact: true });
    assert.equal(await link.getAttribute('href'), 'https://suno.com/create');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(outside.some(url => url.includes('suno.com')), false);
    assert.equal(await page.locator('audio,video').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.reload();
    assert.equal(await page.getByLabel('Original lyrics', { exact: true }).count(), 0);
    await page.close();
  }
});

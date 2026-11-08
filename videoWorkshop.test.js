import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseVideoCommand, validateVideoDraft, videoWorkshopHandler } from './videoWorkshop.js';

const draft = { title: 'Ocean Sunrise', storyboard: '0-5s: A slow aerial shot of a sunrise over gentle ocean waves.',
  prompt: 'A warm cinematic sunrise over the ocean, slow aerial camera movement, golden light, 5 seconds, 16:9.' };
const input = { brief: 'Ocean sunrise', style: 'Warm cinematic', duration: 5, aspect: '16:9' };

test('video commands are explicit and drafts require bounded complete strings', () => {
  for (const verb of ['create', 'write', 'make', 'draft', 'plan']) {
    assert.deepEqual(parseVideoCommand(`Peppy, ${verb} a video about ocean sunrise`), { brief: 'ocean sunrise' });
  }
  for (const text of ['Find a video on YouTube', 'Peppy, play a video about the ocean', 'Peppy create a song about sunrise']) {
    assert.equal(parseVideoCommand(text), null);
  }
  assert.deepEqual(validateVideoDraft(draft), draft);
  for (const bad of [null, [], {}, { ...draft, title: 5 }, { ...draft, prompt: '' },
    { ...draft, storyboard: 'x'.repeat(6001) }, { ...draft, prompt: 'x'.repeat(2001) }]) assert.throws(() => validateVideoDraft(bad));
});

test('video planning validates settings and isolates input, with explicit provider failures', async t => {
  const app = express();
  app.use(express.json());
  let calls = 0;
  let output = { output_text: JSON.stringify(draft), status: 'completed' };
  app.post('/api/video/draft', videoWorkshopHandler(() => ({ responses: { create: async (request, options) => {
    calls++;
    assert.deepEqual(JSON.parse(request.input), input);
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.deepEqual(request.text.format.schema.required, ['title', 'storyboard', 'prompt']);
    assert.equal(request.tools, undefined);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.timeout, 60000);
    return output;
  } } })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/video/draft`;
  const send = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const bad of [{}, { ...input, brief: ' ' }, { ...input, brief: 'x'.repeat(2001) },
    { ...input, style: null }, { ...input, style: 'x'.repeat(151) }, { ...input, duration: '5' },
    { ...input, duration: 60 }, { ...input, aspect: '4:3' }]) assert.equal((await send(bad)).status, 400);
  assert.equal(calls, 0);
  const response = await send({ ...input, memory: 'Private memory', messages: [{ content: 'Private chat' }] });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { draft });
  for (const bad of [{ output_text: 'not json' }, { output_text: '{}' },
    { status: 'incomplete', output_text: JSON.stringify(draft) }, { output: [{ type: 'refusal' }] }]) {
    output = bad;
    const failure = await send(input);
    assert.equal(failure.status, 502);
    assert.match((await failure.json()).error, /Nothing was sent to Pika or Runway/);
  }
});

test('desktop, phone and local chat prepare editable video plans and manual links without generating media', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  let local = false;
  let fail = false;
  const plans = [];
  const chats = [];
  app.get('/api/status', (_req, res) => res.json({ configured: true, localAssistant: local }));
  app.get('/api/local/config', (_req, res) => res.json({ roots: [], origins: [] }));
  app.get('/api/local/gmail/status', (_req, res) => res.json({ connected: false, enabled: false, preview: false }));
  app.post('/api/video/draft', (req, res) => {
    plans.push(req.body);
    if (fail) return res.status(502).json({ error: 'Planning unavailable. Nothing was sent to Pika or Runway.' });
    res.json({ draft });
  });
  for (const route of ['/api/chat', '/api/local/chat']) {
    app.post(route, (req, res) => { chats.push(req.body); res.json({ reply: 'Normal reply' }); });
  }
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [width, companion] of [[1280, false], [390, false], [1280, true]]) {
    local = companion; fail = false;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const outside = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
        if (window.copyFails) throw new Error('Clipboard blocked');
        window.copied.push(text);
      } } });
    });
    await page.route('**/*', route => {
      if (route.request().url().startsWith(base)) return route.continue();
      outside.push(route.request().url());
      return route.abort();
    });
    await page.goto(base);
    if (companion) await page.getByLabel('Local assistant — files and websites', { exact: true }).check();
    const chat = page.getByRole('textbox', { name: 'Your message', exact: true });
    await chat.fill('Peppy, create a video about Ocean sunrise');
    await chat.press('Enter');
    const prompt = page.getByLabel('Video prompt', { exact: true });
    await prompt.waitFor();
    assert.equal(await prompt.inputValue(), draft.prompt);
    assert.deepEqual(plans.at(-1), input);
    assert.equal(chats.length, 0);
    assert.ok((await page.getByLabel('Storyboard', { exact: true }).inputValue()).includes('0-5s'));
    await prompt.fill('My edited video prompt');
    await page.getByRole('button', { name: 'Copy video prompt', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Video prompt copied.' }).waitFor();
    await page.getByRole('button', { name: 'Copy storyboard', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Storyboard copied.' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copied), ['My edited video prompt', draft.storyboard]);
    await page.evaluate(() => { window.copyFails = true; });
    await page.getByRole('button', { name: 'Copy video prompt', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Clipboard blocked' }).waitFor();
    await page.getByLabel('Planned duration', { exact: true }).selectOption('10');
    await page.getByLabel('Aspect ratio', { exact: true }).selectOption('9:16');
    fail = true;
    await page.getByRole('button', { name: 'Draft video plan', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Planning unavailable' }).waitFor();
    assert.equal(await prompt.inputValue(), 'My edited video prompt');
    assert.equal(plans.at(-1).duration, 10);
    assert.equal(plans.at(-1).aspect, '9:16');
    for (const [name, url] of [['Open Pika', 'https://pika.art/'], ['Open Runway', 'https://app.runwayml.com/']]) {
      const link = page.getByRole('link', { name, exact: true });
      assert.equal(await link.getAttribute('href'), url);
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    }
    assert.equal(outside.some(url => /pika\.art|runwayml\.com/.test(url)), false);
    assert.equal(await page.locator('audio,video').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.reload();
    assert.equal(await prompt.count(), 0);
    if (companion) await page.getByLabel('Local assistant — files and websites', { exact: true }).check();
    await chat.fill('Hi Peppy');
    await chat.press('Enter');
    await page.getByText('Normal reply', { exact: true }).waitFor();
    assert.deepEqual(chats.pop().messages, [{ role: 'user', content: 'Hi Peppy' }]);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

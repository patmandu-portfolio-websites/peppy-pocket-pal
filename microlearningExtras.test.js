import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { discoveryHandler } from './microlearningDiscoveryApi.js';
import { microlearningMediaHandler } from './microlearningMediaApi.js';

const source = { title: 'A research source', url: 'https://example.org/research' };
const topicCards = [
  { title: 'First insight', content: 'First supported idea.', source },
  { title: 'Second insight', content: 'Second supported idea.', source }
];
const commons = {
  pageid: 42, title: 'File:Example.jpg', index: 1, imageinfo: [{
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/500px-Example.jpg',
    extmetadata: {
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
      Artist: { value: '<a href="/wiki/User:Example">Example artist</a>' }
    }
  }]
};
const credit = {
  kind: 'commons', pageId: 42, title: 'Example.jpg', creator: 'Example artist',
  license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg'
};
const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');

test('topic discovery accepts only URLs actually cited by the web search', async t => {
  const calls = [];
  let cited = true;
  let selectedUrl = source.url;
  const createClient = () => ({ responses: { create: async request => {
    calls.push(request);
    if (request.tools) return {
      status: 'completed', output_text: 'Research-based overview.',
      output: [{ type: 'message', content: [{ annotations: cited ? [{ type: 'url_citation', ...source }] : [] }] }]
    };
    return { status: 'completed', output_text: JSON.stringify({ cards: [{ title: 'Insight', content: 'An idea.', sourceUrl: selectedUrl }] }) };
  } } });
  const app = express(); app.use(express.json()); app.post('/discovery', discoveryHandler(createClient));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = () => fetch(`http://127.0.0.1:${server.address().port}/discovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'topic-web', topic: 'Habits', memory: 'private' }) });
  let response = await send();
  assert.deepEqual(await response.json(), { cards: [{ title: 'Insight', content: 'An idea.', source }] });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].input), { topic: 'Habits' });
  assert.equal(JSON.stringify(calls).includes('private'), false);
  selectedUrl = 'https://invented.example/';
  assert.equal((await send()).status, 502);
  cited = false;
  const count = calls.length;
  response = await send();
  assert.deepEqual(await response.json(), { cards: [] });
  assert.equal(calls.length, count + 1);
});

test('image search and selection verify licences, attribution and safe hosts; generation is explicit', async t => {
  let page = commons;
  let fetchCalls = 0;
  let aiCalls = 0;
  const fetchImpl = async (url, options) => {
    fetchCalls++;
    assert.equal(options.redirect, 'error');
    if (url.startsWith('https://commons.wikimedia.org/w/api.php?')) return Response.json({ query: { pages: { '42': page } } });
    if (url.startsWith('https://thumb.wikimedia.org/wikipedia/commons/thumb/')) return new Response(fakePng);
    throw new Error('Unexpected image host.');
  };
  const app = express(); app.use(express.json());
  app.post('/media', microlearningMediaHandler(() => ({ responses: { create: async request => {
    aiCalls++;
    assert.equal(request.tools[0].type, 'image_generation');
    assert.deepEqual(JSON.parse(request.input), { title: 'Idea', content: 'Useful idea', topic: 'Habits' });
    return { output: [{ type: 'image_generation_call', result: fakePng.toString('base64') }] };
  } } }), fetchImpl));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = body => fetch(`http://127.0.0.1:${server.address().port}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ operation: 'select', pageId: '../42' })).status, 400);
  assert.equal(fetchCalls, 0);
  let response = await send({ operation: 'search', query: 'habit' });
  assert.deepEqual((await response.json()).images, [Object.fromEntries(Object.entries(credit).filter(([key]) => key !== 'kind'))]);
  assert.equal(aiCalls, 0);
  response = await send({ operation: 'select', pageId: 42 });
  assert.deepEqual((await response.json()).image, { ...credit, data: `data:image/png;base64,${fakePng.toString('base64')}` });
  page = { ...commons, imageinfo: [{ ...commons.imageinfo[0], thumburl: 'https://thumb.wikimedia.org.attacker.test/wikipedia/commons/thumb/a' }] };
  assert.equal((await send({ operation: 'select', pageId: 42 })).status, 422);
  page = { ...commons, imageinfo: [{ ...commons.imageinfo[0], extmetadata: { ...commons.imageinfo[0].extmetadata, LicenseUrl: { value: 'https://example.org/false-license' } } }] };
  assert.equal((await send({ operation: 'select', pageId: 42 })).status, 422);
  assert.equal((await send({ operation: 'generate', title: '', content: 'x', topic: 'Habits' })).status, 400);
  response = await send({ operation: 'generate', title: 'Idea', content: 'Useful idea', topic: 'Habits', memory: 'private' });
  assert.equal((await response.json()).image.kind, 'ai');
  assert.equal(aiCalls, 1);
});

test('web concepts, image choices and saved card swiping work on desktop and phone', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express(); app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  const requests = [];
  let picture;
  let fail = false;
  app.post('/api/microlearning/discovery', (req, res) => {
    requests.push(req.body);
    res.json(req.body.operation === 'books' ? { books: [], hasNext: false } : { cards: topicCards });
  });
  app.post('/api/microlearning/media', (req, res) => {
    requests.push(req.body);
    if (fail) return res.status(502).json({ error: 'Image unavailable.' });
    if (req.body.operation === 'search') return res.json({ images: [credit] });
    if (req.body.operation === 'select') return res.json({ image: { ...credit, data: picture } });
    res.json({ image: { kind: 'ai', data: picture } });
  });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [1280, 390]) {
    const generationCallsBefore = requests.filter(item => item.operation === 'generate').length;
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(base) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await page.goto(base);
    picture = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
      canvas.getContext('2d').fillRect(0, 0, 80, 60); return canvas.toDataURL('image/png');
    });
    await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Microlearning' });
    await panel.getByText('Show or hide topics and browse books').click();
    await panel.getByRole('button', { name: 'Habits', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Habits books' });
    await dialog.getByText('No eligible books found on this page.').waitFor();
    await dialog.getByRole('button', { name: 'Find cited topic concepts on the web' }).click();
    const deck = dialog.getByRole('region', { name: 'topic concept' });
    await deck.getByText('First insight').waitFor();
    assert.equal(await deck.getByRole('link', { name: 'A research source' }).getAttribute('href'), source.url);
    await deck.getByRole('button', { name: 'Review and save this topic concept' }).click();
    await panel.getByText('Optional card image').click();
    await panel.getByLabel('Image search terms').fill('habit');
    await panel.getByRole('button', { name: 'Find images on Wikimedia Commons' }).click();
    await panel.getByRole('button', { name: 'Preview and use Example.jpg' }).click();
    await panel.getByText('Example artist').first().waitFor();
    await panel.getByRole('img', { name: 'Illustration for First insight' }).waitFor();
    assert.equal(requests.filter(item => item.operation === 'generate').length, generationCallsBefore);
    await panel.getByRole('button', { name: 'Save idea card' }).click();
    await page.reload();
    await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
    await panel.getByRole('img', { name: 'Illustration for First insight' }).waitFor();
    assert.equal(await panel.getByRole('link', { name: source.url }).getAttribute('href'), source.url);
    await panel.getByLabel('Card title').fill('Another idea');
    await panel.locator('textarea[maxlength="1200"]').fill('Another idea text');
    await panel.getByLabel('Card source (title, author and optional link)').fill('My own note');
    await panel.getByText('Optional card image').click();
    await panel.getByRole('button', { name: 'Create card image with AI — paid' }).click();
    await panel.getByRole('img', { name: 'Illustration for Another idea' }).waitFor();
    fail = true;
    await panel.getByRole('button', { name: 'Create card image with AI — paid' }).click();
    await panel.getByRole('alert').getByText('Image unavailable.').waitFor();
    assert.equal(await panel.getByRole('img', { name: 'Illustration for Another idea' }).count(), 1);
    fail = false;
    await panel.getByRole('button', { name: 'Save idea card' }).click();
    await panel.getByRole('button', { name: 'Swipe through saved cards' }).click();
    const saved = panel.getByRole('region', { name: 'saved card' });
    await saved.getByText('First supported idea.').waitFor();
    await saved.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 100 });
    await saved.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100, clientY: 105 });
    await saved.getByText('Another idea text').waitFor();
    await saved.focus(); await page.keyboard.press('ArrowLeft');
    await saved.getByText('First supported idea.').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

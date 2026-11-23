import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { discoveryHandler, youtubeVideos } from './microlearningDiscoveryApi.js';

const catalogBook = {
  identifier: 'meditations02680gut', title: 'Meditations', creator: 'Marcus Aurelius', subject: ['Stoics'],
  collection: 'gutenberg', mediatype: 'texts', language: 'eng', rights: 'Public domain in the USA.',
  source: 'https://www.gutenberg.org/ebooks/2680'
};
const book = { id: 2680, archiveId: 'meditations02680gut', title: 'Meditations', author: 'Marcus Aurelius', url: 'https://www.gutenberg.org/ebooks/2680' };
const concepts = [{ title: 'Consider your actions', content: 'Reflect carefully on your actions.' }, { title: 'Look inward', content: 'Examine your own judgment.' }];
const videoAnnotations = [
  { type: 'url_citation', title: 'Stoicism explained', url: 'https://www.youtube.com/watch?v=abcdefghijk&feature=share' },
  { type: 'url_citation', title: 'Duplicate', url: 'https://youtu.be/abcdefghijk' },
  { type: 'url_citation', title: 'Bad domain', url: 'https://youtube.com.attacker.test/watch?v=abcdefghijk' },
  { type: 'url_citation', title: 'Not a video', url: 'https://www.youtube.com/results?search_query=stoicism' },
  { type: 'url_citation', title: 'Another video', url: 'https://youtu.be/ZYXWVUTSRQP' }
];
const searchResponse = { status: 'completed', output: [{ type: 'message', content: [{ annotations: videoAnnotations }] }] };

test('only cited direct YouTube video URLs are shown, deduplicated and normalized', () => {
  assert.deepEqual(youtubeVideos(searchResponse), [
    { title: 'Stoicism explained', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
    { title: 'Another video', url: 'https://www.youtube.com/watch?v=ZYXWVUTSRQP' }
  ]);
  assert.deepEqual(youtubeVideos({ output_text: 'Invented video https://youtu.be/abcdefghijk' }), []);
});

test('discovery validates catalog, grounds cards in a bounded excerpt and returns only cited videos', async t => {
  const urls = [];
  let text = `*** START OF THE PROJECT GUTENBERG EBOOK MEDITATIONS ***\n${'A substantive opening reflection. '.repeat(1000)}`;
  let modelRequest;
  let modelOutput = { status: 'completed', output_text: JSON.stringify({ cards: concepts }) };
  let metadata = catalogBook;
  const fetchImpl = async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'error');
    if (url.startsWith('https://archive.org/advancedsearch.php?')) {
      return Response.json({ response: { docs: [catalogBook, { ...catalogBook, identifier: 'another00003gut', subject: ['Fantasy fiction'] }], numFound: 65 } });
    }
    if (url === 'https://archive.org/metadata/meditations02680gut/metadata') return Response.json({ result: metadata });
    if (url === 'https://gutenberg.pglaf.org/2/6/8/2680/2680-0.txt') return new Response(text);
    throw new Error(`Unexpected URL ${url}`);
  };
  const app = express();
  app.use(express.json());
  app.post('/api/microlearning/discovery', discoveryHandler(() => ({ responses: { create: async (request, options) => {
    modelRequest = request;
    assert.equal(options.maxRetries, 0);
    return modelOutput;
  } } }), fetchImpl));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = body => fetch(`http://127.0.0.1:${server.address().port}/api/microlearning/discovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await send({ operation: 'books', topic: 'Invalid' })).status, 400);
  assert.equal((await send({ operation: 'concepts', topic: 'Philosophy', id: '../../etc' })).status, 400);
  assert.equal((await send({ operation: 'book', topic: 'Philosophy', id: 2680, archiveId: '../meditations02680gut' })).status, 400);
  assert.equal(urls.length, 0);
  let response = await send({ operation: 'books', topic: 'Philosophy', page: 2 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { books: [book], hasNext: true });
  assert.match(urls[0], /page=2/);
  response = await send({ operation: 'book', topic: 'Philosophy', id: 2680, archiveId: book.archiveId });
  assert.deepEqual(await response.json(), { book });
  response = await send({ operation: 'concepts', topic: 'Philosophy', id: 2680, archiveId: book.archiveId, memory: 'private' });
  assert.deepEqual(await response.json(), { book, cards: concepts });
  assert.equal(modelRequest.tools, undefined);
  assert.equal(modelRequest.text.format.strict, true);
  const input = JSON.parse(modelRequest.input);
  assert.equal(input.book, book.title);
  assert.ok(input.excerpt.length <= 18000);
  assert.match(input.excerpt, /\[Sample 3, character offset/);
  assert.equal(JSON.stringify(modelRequest).includes('private'), false);
  modelOutput = searchResponse;
  response = await send({ operation: 'videos', topic: 'Philosophy', id: 2680, archiveId: book.archiveId, memory: 'private' });
  assert.deepEqual((await response.json()).videos, youtubeVideos(searchResponse));
  assert.deepEqual(JSON.parse(modelRequest.input), { book: book.title, author: book.author, topic: 'Philosophy' });
  assert.deepEqual(modelRequest.tools, [{ type: 'web_search' }]);
  metadata = { ...catalogBook, rights: 'In copyright' };
  assert.equal((await send({ operation: 'concepts', topic: 'Philosophy', id: 2680, archiveId: book.archiveId })).status, 422);
  metadata = catalogBook;
  text = 'no recognizable book content';
  assert.equal((await send({ operation: 'concepts', topic: 'Philosophy', id: 2680, archiveId: book.archiveId })).status, 502);
  text = `*** START OF THE PROJECT GUTENBERG EBOOK MEDITATIONS ***\n${'text '.repeat(300)}`;
  modelOutput = { output_text: JSON.stringify({ cards: [{ title: '', content: 'Invalid' }] }) };
  assert.equal((await send({ operation: 'concepts', topic: 'Philosophy', id: 2680, archiveId: book.archiveId })).status, 502);
});

test('topic popup and swipe decks work on desktop and phone without losing card drafts', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  const requests = [];
  let fail = false;
  app.post('/api/microlearning/discovery', (req, res) => {
    requests.push(req.body);
    if (fail) return res.status(502).json({ error: 'Service unavailable.' });
    if (req.body.operation === 'books') return res.json({ books: [book], hasNext: false });
    if (req.body.operation === 'book') return res.json({ book });
    if (req.body.operation === 'concepts') return res.json({ book, cards: concepts });
    res.json({ book, videos: youtubeVideos(searchResponse) });
  });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    const errors = [];
    const outside = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith(base)) return route.continue();
      outside.push(route.request().url());
      return route.abort();
    });
    await page.goto(base);
    await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Microlearning' });
    await panel.getByLabel('New stash name').fill('Favorites');
    await panel.getByRole('button', { name: 'Create stash' }).click();
    await panel.getByLabel('Card title').fill('Existing draft');
    await panel.getByText('Show or hide topics and browse books').click();
    await panel.getByRole('button', { name: 'Philosophy', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Philosophy books' });
    await dialog.getByRole('button', { name: 'Meditations', exact: true }).click();
    await dialog.getByRole('button', { name: 'Generate book concepts with AI' }).click();
    const deck = dialog.getByRole('region', { name: 'concept' });
    await deck.getByText('Consider your actions').waitFor();
    assert.equal(await deck.getByRole('button', { name: 'Review and save this concept' }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Close book browser' }).click();
    assert.equal(await panel.getByLabel('Card title').inputValue(), 'Existing draft');
    await panel.getByRole('button', { name: 'Clear card draft' }).click();
    await panel.getByRole('button', { name: 'Philosophy', exact: true }).click();
    await dialog.getByRole('button', { name: 'Meditations', exact: true }).click();
    await dialog.getByRole('button', { name: 'Generate book concepts with AI' }).click();
    await deck.getByText('Consider your actions').waitFor();
    await deck.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 100 });
    await deck.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100, clientY: 105 });
    await deck.getByText('Look inward').waitFor();
    await deck.focus();
    await page.keyboard.press('ArrowLeft');
    await deck.getByText('Consider your actions').waitFor();
    await dialog.getByRole('button', { name: 'Find related YouTube videos' }).click();
    const videos = dialog.getByRole('region', { name: 'video' });
    await videos.getByText('Stoicism explained').waitFor();
    await videos.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 100 });
    await videos.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100, clientY: 105 });
    assert.equal(await videos.getByRole('link', { name: 'Watch on YouTube' }).getAttribute('href'), 'https://www.youtube.com/watch?v=ZYXWVUTSRQP');
    assert.equal(outside.some(url => url.includes('youtube.com')), false);
    fail = true;
    await dialog.getByRole('button', { name: 'Generate book concepts with AI' }).click();
    await dialog.getByRole('alert').getByText('Service unavailable.').waitFor();
    assert.equal(await deck.getByText('Consider your actions').count(), 1);
    fail = false;
    await deck.getByRole('button', { name: 'Review and save this concept' }).click();
    assert.equal(await panel.getByLabel('Card title').inputValue(), 'Consider your actions');
    await panel.getByRole('group', { name: 'Add to stashes' }).getByLabel('Favorites').check();
    await panel.getByRole('button', { name: 'Save idea card' }).click();
    await page.reload();
    await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
    assert.equal(await panel.getByText('Reflect carefully on your actions.').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.ok(requests.some(item => item.operation === 'concepts'));
  assert.ok(requests.some(item => item.operation === 'videos'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { emptyMicrolearning, microlearningKey, readMicrolearning, validateCard } from './microlearning.js';
import { microlearningHandler } from './microlearningApi.js';

const card = { id: 'one', title: 'Small steps', content: 'Start with one small action.', source: 'Example book, author', topic: 'Habits', stashIds: [] };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9kAAAAASUVORK5CYII=';

test('cards require an attributed bounded idea and stored data is validated', () => {
  assert.deepEqual(readMicrolearning(null), emptyMicrolearning());
  assert.deepEqual(validateCard({ ...card, title: '  Small steps  ' }).title, 'Small steps');
  for (const bad of [{ ...card, source: '' }, { ...card, content: 'x'.repeat(1201) }, { ...card, topic: 'Unknown' }]) {
    assert.throws(() => validateCard(bad));
  }
  assert.throws(() => readMicrolearning('{"cards":{},"stashes":[],"plan":null}'));
  assert.throws(() => readMicrolearning(JSON.stringify({ cards: [card], stashes: [], plan: { goal: 'X', interests: [], cardIds: [null], actions: [] } })));
  assert.throws(() => validateCard({ ...card, image: { kind: 'ai', data: 'javascript:alert(1)' } }));
  assert.throws(() => readMicrolearning(JSON.stringify({ cards: [{ ...card, image: { kind: 'ai', data: `data:image/jpeg;base64,${'A'.repeat(200001)}` } }], stashes: [], plan: null })));
});

test('AI operations isolate inputs, validate images and reject invalid or invented results', async t => {
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  let request;
  let output;
  app.post('/api/microlearning', microlearningHandler(() => ({ responses: { create: async (value, options) => {
    request = value;
    assert.equal(options.maxRetries, 0);
    assert.equal(value.text.format.strict, true);
    assert.equal(value.tools, undefined);
    return output;
  } } })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = body => fetch(`http://127.0.0.1:${server.address().port}/api/microlearning`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await send({ operation: 'scan', image: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await send({ operation: 'draft', evidence: '', source: 'Book' })).status, 400);
  assert.equal((await send({ operation: 'plan', goal: 'Grow', interests: ['Habits'], cards: [{ ...card, topic: 'Health' }] })).status, 400);
  output = { status: 'completed', output_text: JSON.stringify({ transcription: 'Read [unclear].' }) };
  let response = await send({ operation: 'scan', image: png, memory: 'private' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(request.input[0].content[1].image_url, png);
  assert.equal(JSON.stringify(request).includes('private'), false);

  output = { output_text: JSON.stringify({ title: 'Try small steps', content: 'Begin with one action.' }) };
  response = await send({ operation: 'draft', evidence: 'Reviewed text', source: 'Book', messages: 'private' });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(request.input), { evidence: 'Reviewed text', source: 'Book' });
  output = { output_text: JSON.stringify({ cardIds: ['one'], actions: ['Try one step.'] }) };
  response = await send({ operation: 'plan', goal: 'Grow', interests: ['Habits'], cards: [card], memory: 'private' });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(request.input).cards, [{ id: 'one', title: card.title, content: card.content, topic: 'Habits' }]);
  output = { output_text: JSON.stringify({ cardIds: ['invented'], actions: ['Try it'] }) };
  assert.equal((await send({ operation: 'plan', goal: 'Grow', interests: ['Habits'], cards: [card] })).status, 502);
  output = { status: 'incomplete', output_text: '{}' };
  assert.equal((await send({ operation: 'draft', evidence: 'Text', source: 'Book' })).status, 502);
});

test('microlearning persists editable cards, stashes, reviewed scan and growth plan on desktop and phone', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  const requests = [];
  let fail = false;
  app.post('/api/microlearning', (req, res) => {
    requests.push(req.body);
    if (fail) return res.status(502).json({ error: 'AI unavailable' });
    if (req.body.operation === 'scan') return res.json({ result: { transcription: 'A small step builds a habit.' } });
    if (req.body.operation === 'draft') return res.json({ result: { title: 'Small steps', content: 'Begin with a small step.' } });
    res.json({ result: { cardIds: [req.body.cards[0].id], actions: ['Try one small step.'] } });
  });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'Microlearning' });
    await panel.getByLabel('New stash name').fill('Daily');
    await panel.getByRole('button', { name: 'Create stash' }).click();
    const imageBytes = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 100; canvas.height = 40;
      canvas.getContext('2d').fillText('Example', 5, 20);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await panel.getByLabel('Book page image').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: imageBytes });
    await panel.getByRole('button', { name: 'Send page to AI for transcription' }).click();
    await panel.getByLabel('Reviewed page text or authorized excerpt').fill('Corrected: a small step builds a habit.');
    await panel.getByLabel('Card source (title, author and optional link)').fill('Example book, author');
    await panel.getByRole('button', { name: 'Draft card from reviewed text with AI' }).click();
    await panel.locator('textarea[maxlength="1200"]').fill('My edited idea.');
    await panel.getByLabel('Card topic').selectOption('Habits');
    await panel.getByRole('group', { name: 'Add to stashes' }).getByLabel('Daily').check();
    await panel.getByRole('button', { name: 'Save idea card' }).click();
    assert.equal(requests.at(-1).evidence, 'Corrected: a small step builds a habit.');
    await panel.getByLabel('Growth goal').fill('Build a habit');
    await panel.getByRole('group', { name: 'Interests' }).getByLabel('Habits', { exact: true }).check();
    await panel.getByRole('button', { name: 'Suggest and save growth plan' }).click();
    await panel.getByText('Try one small step.').waitFor();
    assert.equal(requests.at(-1).cards[0].content, 'My edited idea.');
    fail = true;
    await panel.getByRole('button', { name: 'Suggest and save growth plan' }).click();
    await panel.getByRole('alert').getByText('AI unavailable').waitFor();
    assert.equal(await panel.getByText('Try one small step.').count(), 1);
    fail = false;
    await page.reload();
    await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
    assert.equal(await panel.getByText('My edited idea.').count(), 1);
    assert.equal(await panel.getByText('Try one small step.').count(), 1);
    await panel.getByLabel('Filter by topic').selectOption('Health');
    assert.equal(await panel.getByText('My edited idea.').count(), 0);
    await panel.getByLabel('Filter by topic').selectOption('Habits');
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), microlearningKey);
    await panel.getByLabel('Filter by stash').selectOption(stored.stashes[0].id);
    await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('Existing draft');
    await panel.getByRole('button', { name: 'Discuss Small steps in chat' }).click();
    assert.match(await page.getByRole('textbox', { name: 'Your message', exact: true }).inputValue(), /Existing draft[\s\S]*My edited idea\.[\s\S]*Example book, author/);
    await panel.getByRole('button', { name: 'Edit Small steps' }).click();
    await panel.getByLabel('Card title').fill('Better steps');
    await panel.getByRole('button', { name: 'Save card changes' }).click();
    assert.equal(await panel.getByText('Better steps', { exact: true }).count(), 2);
    await panel.getByRole('button', { name: 'Delete stash Daily' }).click();
    assert.equal(await panel.getByText('My edited idea.').count(), 1);
    await panel.getByRole('button', { name: 'Delete Better steps' }).click();
    assert.equal(await panel.getByRole('listitem').getByText('Card deleted', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(key => localStorage.setItem(key, '{"cards":"invalid"}'), microlearningKey);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('Microlearning - idea cards and growth plans', { exact: true }).click();
  await page.getByRole('alert').getByText(/has not been overwritten/).waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), microlearningKey), '{"cards":"invalid"}');
  await page.close();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { amazonSearchLink, parseAmazonCommand } from './amazonLinks.js';
import { parseMusicCommand } from './appleMusic.js';

test('Amazon search links encode queries on a fixed HTTPS origin', () => {
  for (const query of ['wireless headphones', 'cafe \u00e9', 'https://evil.example/?k=x&redirect=y', '<script>#?&k=other']) {
    const url = new URL(amazonSearchLink(` ${query} `));
    assert.equal(url.origin, 'https://www.amazon.com.au');
    assert.equal(url.pathname, '/s');
    assert.deepEqual([...url.searchParams], [['k', query]]);
    assert.equal(url.hash, '');
  }
  assert.equal(new URL(amazonSearchLink('x'.repeat(300))).searchParams.get('k').length, 300);
  for (const query of ['', '  ', null, undefined, 5, 'x'.repeat(301)]) {
    assert.throws(() => amazonSearchLink(query), /1-300/);
  }
});

test('Amazon commands are explicit and take precedence over general music searches', () => {
  for (const text of ['Peppy, find headphones on Amazon.', 'PEPPY search for headphones in Amazon Australia!',
    'Peppy, search Amazon for headphones', 'Peppy search Amazon Australia for headphones']) {
    assert.deepEqual(parseAmazonCommand(text), { query: 'headphones' });
  }
  assert.deepEqual(parseAmazonCommand('Peppy, search Amazon for'), { query: '' });
  for (const text of ['Find headphones on Amazon', 'Peppy find Hello on Apple Music', 'Peppy buy headphones on Amazon',
    'Peppy add headphones to my Amazon cart', 'Tell me about Amazon']) assert.equal(parseAmazonCommand(text), null);
  assert.deepEqual(parseMusicCommand('Peppy, find Hello by Adele on Apple Music'), { action: 'search', query: 'Hello Adele' });
});

test('desktop, phone and local companion prepare clickable Amazon links without shopping requests', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  let local = false;
  const chats = [];
  app.get('/api/status', (_req, res) => res.json({ configured: true, localAssistant: local }));
  app.get('/api/local/config', (_req, res) => res.json({ roots: [], origins: [] }));
  app.get('/api/local/gmail/status', (_req, res) => res.json({ connected: false, enabled: false, preview: false }));
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
    local = companion;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base);
    const input = page.getByRole('textbox', { name: 'Your message', exact: true });
    if (companion) await page.getByLabel('Local assistant — files and websites', { exact: true }).check();
    await input.fill('Peppy, find headphones on Amazon');
    await input.press('Enter');
    const url = amazonSearchLink('headphones');
    const chatLink = page.getByRole('link', { name: url, exact: true });
    await chatLink.waitFor();
    assert.equal(await chatLink.getAttribute('href'), url);
    assert.equal(await chatLink.getAttribute('target'), '_blank');
    assert.equal(await chatLink.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(chats.length, 0, 'Search commands must not call AI or cart tools');
    await page.reload();
    await page.getByRole('link', { name: url, exact: true }).waitFor();
    if (companion) await page.getByLabel('Local assistant — files and websites', { exact: true }).check();
    await page.getByText('Amazon Australia - search links', { exact: true }).click();
    await page.getByRole('button', { name: 'Prepare Amazon search link', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '1-300' }).waitFor();
    await page.getByLabel('Amazon product search', { exact: true }).fill('tea & coffee');
    await page.getByRole('button', { name: 'Prepare Amazon search link', exact: true }).click();
    const panelLink = page.getByRole('link', { name: 'Open search on Amazon Australia', exact: true });
    assert.equal(await panelLink.getAttribute('href'), amazonSearchLink('tea & coffee'));
    assert.equal(await panelLink.getAttribute('target'), '_blank');
    assert.equal(await panelLink.getAttribute('rel'), 'noopener noreferrer');
    await page.getByLabel('Amazon product search', { exact: true }).fill('changed query');
    assert.equal(await panelLink.count(), 0, 'Editing clears stale links');
    assert.equal(requests.some(url => /amazon|\/api\/music\//.test(url)), false);
    await input.fill('Hi Peppy');
    await input.press('Enter');
    await page.getByText('Normal reply', { exact: true }).waitFor();
    assert.deepEqual(chats.pop().messages, [{ role: 'user', content: 'Hi Peppy' }]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
});

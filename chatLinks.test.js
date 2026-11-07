import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { chatLinks } from './chatLinks.js';

test('chat URLs are clickable without changing text, whitespace or punctuation', () => {
  const text = 'Hours: https://example.com/hours?day=Monday&branch=1.\nVisit www.example.org!';
  const parts = chatLinks(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.url), [
    { text: 'https://example.com/hours?day=Monday&branch=1', url: 'https://example.com/hours?day=Monday&branch=1' },
    { text: 'www.example.org', url: 'https://www.example.org/' }
  ]);
  assert.deepEqual(chatLinks('Hello\nfriend!'), [{ text: 'Hello\nfriend!' }]);
  assert.deepEqual(chatLinks(''), []);
});

test('Markdown website links display labels and preserve balanced URL parentheses', () => {
  assert.deepEqual(chatLinks('[Opening hours](https://example.com/hours_(city))'), [
    { text: 'Opening hours', url: 'https://example.com/hours_(city)' }
  ]);
  const text = '(https://example.com/hours_(city)).';
  const parts = chatLinks(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.equal(parts.find(part => part.url).url, 'https://example.com/hours_(city)');
});

test('unsafe schemes, credentials, invalid URLs and email domains remain plain text', () => {
  for (const text of [
    '[Click](javascript:alert(1))',
    '[Click](data:text/html,bad)',
    '[File](file:///C:/private)',
    'https://user:password@example.com/',
    'http://',
    'hello@www.example.com',
    '[Invalid](https://)'
  ]) {
    assert.equal(chatLinks(text).some(part => part.url), false, text);
    assert.equal(chatLinks(text).map(part => part.text).join(''), text);
  }
});

test('chat website links render safely in saved and new messages on desktop and phone', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  app.post('/api/chat', (_req, res) => res.json({ reply: 'See [Hours](https://example.org/hours).' }));
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
    await page.addInitScript(() => localStorage.setItem('peppy-state-v1', JSON.stringify({
      messages: [
        { role: 'user', content: 'Visit www.example.com.' },
        { role: 'assistant', content: 'Try [Website](https://example.com/hours).\n<img src=x onerror=alert(1)> [Bad](javascript:alert(1))' }
      ]
    })));
    await page.goto(base);
    const link = page.getByRole('link', { name: 'Website', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), 'https://example.com/hours');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await page.getByRole('link', { name: 'www.example.com', exact: true }).count(), 1);
    assert.equal(await page.locator('.message-content img').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Bad', exact: true }).count(), 0);
    assert.match(await page.locator('.message.assistant p').innerText(), /<img src=x onerror=alert\(1\)>/);
    await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('Check https://example.org.');
    await page.getByRole('textbox', { name: 'Your message', exact: true }).press('Enter');
    await page.getByRole('link', { name: 'Hours', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Hours', exact: true }).getAttribute('href'), 'https://example.org/hours');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
});

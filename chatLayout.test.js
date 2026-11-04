import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';

test('phone reply composer follows short and long chats without a viewport-sized gap', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [320, 390, 700]) {
    for (const content of ['Hello!', 'A longer reply that wraps on a phone. '.repeat(80)]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await page.addInitScript(text => localStorage.setItem('peppy-state-v1', JSON.stringify({
        messages: [{ role: 'user', content: 'Hi Peppy' }, { role: 'assistant', content: text }]
      })), content);
      await page.goto(base);
      await page.locator('.message.assistant').waitFor();
      const layout = await page.evaluate(() => {
        const reply = document.querySelector('.message.assistant');
        const composer = document.querySelector('.composer');
        const panels = document.querySelector('.companion-panels');
        return {
          gap: composer.getBoundingClientRect().top - reply.getBoundingClientRect().bottom,
          ordered: Boolean(reply.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING),
          panelsAfter: Boolean(composer.compareDocumentPosition(panels) & Node.DOCUMENT_POSITION_FOLLOWING),
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          fontSize: getComputedStyle(reply.querySelector('p')).fontSize
        };
      });
      assert.equal(layout.ordered, true);
      assert.equal(layout.panelsAfter, true);
      assert.ok(layout.gap >= 0 && layout.gap <= 50, `Reply-to-composer gap at ${width}px: ${layout.gap}`);
      assert.equal(layout.overflow, false);
      assert.equal(layout.fontSize, '16px');
      await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('My reply');
      assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled(), true);
      await page.close();
    }
  }
});

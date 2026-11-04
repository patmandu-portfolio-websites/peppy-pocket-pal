import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { chatInput, maxChatImageBytes } from './chatInput.js';
import { LocalAssistant } from './localAssistant.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0AAAAABJRU5ErkJggg==';

test('image chat validates inline image type, size, role and latest-message scope', () => {
  assert.deepEqual(chatInput([{ role: 'user', content: 'Hello' }]), [{ role: 'user', content: 'Hello' }]);
  const result = chatInput([{ role: 'user', content: 'Read this', image: png }]);
  assert.equal(result[0].content[0].text, 'Read this');
  assert.deepEqual(result[0].content[1], { type: 'input_image', image_url: png, detail: 'auto' });
  for (const image of ['https://example.org/a.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA',
    `data:image/png;base64,${Buffer.alloc(maxChatImageBytes + 1).toString('base64')}`]) {
    assert.throws(() => chatInput([{ role: 'user', content: 'Read', image }]));
  }
  assert.throws(() => chatInput([{ role: 'assistant', content: 'Bad', image: png }]), /latest user/);
  assert.throws(() => chatInput([{ role: 'user', content: '', image: png }, { role: 'user', content: 'Later' }]), /latest user/);
  assert.throws(() => chatInput([null]), /valid chat/);
});

test('local tool assistant receives image content without bypassing action approvals', async () => {
  let sent;
  const tools = { policy: { roots: [], origins: [] }, amazon: { phase: 'closed' }, pdf: {} };
  const assistant = new LocalAssistant(tools, () => ({ responses: { create: async request => {
    sent = request;
    return { output: [], output_text: 'Visible text, uncertain.' };
  } } }));
  const result = await assistant.start([{ role: 'user', content: 'Transcribe', image: png }], '');
  assert.equal(sent.input[1].content[1].type, 'input_image');
  assert.equal(sent.tools[0].name, 'propose_action');
  assert.equal(result.pending, null);
});

test('composer supports selected and pasted images, explicit send, removal and text-only persistence', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  const requests = [];
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  app.post('/api/chat', (req, res) => {
    requests.push(req.body);
    chatInput(req.body.messages);
    res.json({ reply: 'The image shows an example.' });
  });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  const bytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 40;
    canvas.getContext('2d').fillText('Example', 5, 20);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const picker = page.getByLabel('Select chat image', { exact: true });
  await picker.setInputFiles({ name: 'example.png', mimeType: 'image/png', buffer: bytes });
  await page.getByAltText('Image attached for review').waitFor();
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Remove image', exact: true }).click();
  assert.equal(await page.getByAltText('Image attached for review').count(), 0);
  await page.getByRole('textbox', { name: 'Your message', exact: true }).evaluate((element, base64) => {
    const binary = atob(base64);
    const file = new File([Uint8Array.from(binary, char => char.charCodeAt(0))], 'pasted.png', { type: 'image/png' });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(file);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, bytes.toString('base64'));
  await page.getByAltText('Image attached for review').waitFor();
  assert.equal(requests.length, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('The image shows an example.', { exact: true }).waitFor();
  assert.ok(requests[0].messages.at(-1).image.startsWith('data:image/png;base64,'));
  const stored = await page.evaluate(() => localStorage.getItem('peppy-state-v1'));
  assert.ok(!stored.includes('base64'));
  assert.ok(!stored.includes('data:image'));
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('Thanks');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 2);
  assert.ok(requests[1].messages.every(message => message.image === undefined));
  await picker.setInputFiles({ name: 'not-image.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await page.getByRole('alert').filter({ hasText: 'Choose a PNG' }).waitFor();
});

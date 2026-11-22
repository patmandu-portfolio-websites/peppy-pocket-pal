import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';

test('reply box shows three lines and follows typed, pasted and dictated text on desktop and phone', async t => {
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
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.addInitScript(() => {
      window.SpeechRecognition = class {
        start() { window.testRecognition = this; }
        abort() {}
      };
    });
    await page.goto(base);
    const input = page.getByRole('textbox', { name: 'Your message', exact: true });
    await input.waitFor();
    const size = await input.evaluate(element => ({
      height: element.clientHeight, line: parseFloat(getComputedStyle(element).lineHeight)
    }));
    assert.ok(size.height >= size.line * 3, `Three visible lines at ${width}px`);
    const draft = Array.from({ length: 15 }, (_, index) => `Draft line ${index}`).join('\n');
    await input.fill(draft);
    const atBottom = () => input.evaluate(element =>
      element.scrollHeight > element.clientHeight &&
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 2);
    await page.waitForFunction(() => {
      const element = document.querySelector('.composer textarea');
      return element.scrollHeight > element.clientHeight &&
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 2;
    });
    await input.press('Control+End');
    await input.press('Shift+Enter');
    await input.pressSequentially('Latest typed line');
    assert.equal(await atBottom(), true);
    assert.equal(await input.inputValue(), `${draft}\nLatest typed line`);
    assert.equal(await page.locator('.message.user').count(), 0, 'Shift+Enter must not send');

    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await input.evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => window.testRecognition.onresult({
      results: [Object.assign([{ transcript: 'Dictated words. '.repeat(40) }], { isFinal: false })]
    }));
    await page.waitForFunction(() => document.querySelector('.composer textarea').value.endsWith('Dictated words.'));
    assert.equal(await atBottom(), true, 'Interim dictation must reveal the latest line');
    assert.equal(await input.evaluate(element => document.activeElement === element), false, 'Dictation must not steal focus');
    await page.evaluate(() => window.testRecognition.onresult({
      results: [Object.assign([{ transcript: 'Final dictated words. '.repeat(45) }], { isFinal: true })]
    }));
    await page.waitForFunction(() => document.querySelector('.composer textarea').value.endsWith('Final dictated words.'));
    assert.equal(await atBottom(), true, 'Final dictation must reveal the latest line');
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    await input.fill('');
    assert.equal(await input.evaluate(element => element.scrollTop), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
});

test('local assistant approval and result popups support task-scoped allow-all safely', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  const approvals = [];
  let continuations = 0;
  app.get('/api/status', (_req, res) => res.json({ configured: true, localAssistant: true }));
  app.get('/api/local/config', (_req, res) => res.json({ roots: ['D:\\PeppyWorkspace'], origins: [] }));
  app.post('/api/local/chat', (_req, res) => res.json({ reply: 'Review this file action.', sessionId: 'session-1',
    pending: {
      id: 'approval-1',
      action: { kind: 'write_file', path: 'D:\\PeppyWorkspace\\hello.js', text: 'console.log("hello");' }
    }
  }));
  app.post('/api/local/approval', (req, res) => {
    approvals.push({ id: req.body.approvalId, approved: req.body.approved });
    res.json({
      sessionId: 'session-1',
      reply: `Action ${approvals.length} completed.`,
      result: { path: approvals.length === 1 ? 'D:\\PeppyWorkspace\\hello.js' : 'D:\\PeppyWorkspace\\next.js' },
      canContinue: true
    });
  });
  app.post('/api/local/continue', (_req, res) => {
    continuations++;
    res.json(continuations === 1 ? {
      sessionId: 'session-1',
      reply: 'Review the next file action.',
      pending: {
        id: 'approval-2',
        action: { kind: 'write_file', path: 'D:\\PeppyWorkspace\\next.js', text: 'export const next = true;' }
      }
    } : { sessionId: 'session-1', reply: 'Task complete.', pending: null });
  });
  app.get('/test-state', (_req, res) => res.json({ approvals, continuations }));
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  await page.getByLabel('Local assistant — files and websites').check();
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('Create hello.js in my workspace.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review before execution' });
  await dialog.waitFor();
  assert.equal(await dialog.getByText('hello.js').count(), 1);
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight };
  });
  assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewport);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'Escape must not dismiss an unresolved approval');
  await dialog.getByRole('button', { name: 'Allow all for this task' }).click();
  const resultDialog = page.getByRole('dialog', { name: 'Review result before sending' });
  await resultDialog.waitFor();
  assert.match(await resultDialog.locator('pre').textContent(), /hello\.js/);
  assert.deepEqual(await (await page.request.get(`${base}/test-state`)).json(), {
    approvals: [{ id: 'approval-1', approved: true }],
    continuations: 0
  }, 'Action result must not be sent before explicit confirmation');
  await resultDialog.getByRole('button', { name: 'Close for now' }).click();
  await resultDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Review result and continue' }).click();
  await resultDialog.getByRole('button', { name: 'Send result to AI and continue' }).click();
  await page.waitForFunction(() => document.querySelector('.result-dialog pre')?.textContent.includes('next.js'));
  let state = await (await page.request.get(`${base}/test-state`)).json();
  assert.equal(state.approvals.length, 2, 'Allow all should approve the next action in this task');
  assert.equal(state.approvals[1].id, 'approval-2');
  await resultDialog.getByRole('button', { name: 'Send result to AI and continue' }).click();
  await page.getByText('Task complete.', { exact: true }).waitFor();
  state = await (await page.request.get(`${base}/test-state`)).json();
  assert.equal(state.continuations, 2);
  assert.equal(await page.getByLabel('Allow all Local assistant actions for this task').isChecked(), false,
    'Allow all should reset when the task completes');
  await page.close();
});

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

test('saved chat scrolls to the latest message after server readiness on startup and refresh', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.get('/api/status', (_req, res) => setTimeout(() => res.json({ configured: true }), 150));
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.addInitScript(() => localStorage.setItem('peppy-state-v1', JSON.stringify({
      messages: Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user', content: `Message ${index}: ${'Saved conversation text. '.repeat(20)}`
      }))
    })));
    await page.goto(base);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.waitForFunction(() => {
        const last = document.querySelector('.message-list')?.lastElementChild;
        if (!last) return false;
        const bounds = last.getBoundingClientRect();
        return window.scrollY > 0 && bounds.bottom <= innerHeight + 2 && bounds.bottom >= innerHeight - 80;
      }, undefined, { timeout: 10000 });
      assert.equal(await page.locator('.message').count(), 30);
      if (attempt === 0) await page.reload();
    }
    await page.close();
  }
});

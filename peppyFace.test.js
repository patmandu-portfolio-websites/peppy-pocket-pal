import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { replyExpression } from './peppyExpression.js';

test('reply expressions use opening tone cues conservatively', () => {
  for (const [text, expression] of [
    ['Wonderful! That worked.', 'happy'], ['Congratulations on your win!', 'happy'],
    ["Hooray! That's exciting!", 'excited'], ["I can't wait!", 'excited'],
    ['Wow, what a surprise!', 'surprised'], ['That is surprising.', 'surprised'],
    ['Here is your answer.', 'neutral'], ['Sorry, that failed.', 'neutral'],
    ["Great, but that is not safe.", 'neutral'], ['The article says "Wow!"', 'neutral'],
    ["I can't wait, but unfortunately it failed.", 'neutral'],
    ['Here are the results.\nHooray!', 'neutral'], ['', 'neutral']
  ]) assert.equal(replyExpression(text), expression, text);
  assert.equal(replyExpression(), 'neutral');
});

test('Peppy face follows chat and voice states and respects motion preferences on desktop and phone', async t => {
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
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.SpeechRecognition = class {
        start() { window.testRecognition = this; }
        abort() { this.onend?.(); }
      };
      window.Audio = class {
        constructor() { window.testAudio = this; }
        async play() {}
        pause() {}
      };
    });
    let finishChat;
    let finishSpeech;
    let reply = 'Hello from Peppy';
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url === `${base}/api/chat`) {
        await new Promise(resolve => { finishChat = resolve; });
        return route.fulfill({ json: { reply } });
      }
      if (url === `${base}/api/speech`) {
        await new Promise(resolve => { finishSpeech = resolve; });
        return route.fulfill({ contentType: 'audio/mpeg', body: 'mock audio' });
      }
      return url.startsWith(base) ? route.continue() : route.abort();
    });
    await page.goto(base);
    const face = page.locator('.peppy-presence .peppy-face');
    const preference = page.getByLabel("Animate Peppy's face", { exact: true });
    async function state(value) {
      await page.locator(`.peppy-presence .peppy-face[data-state="${value}"]`).waitFor();
      assert.equal(await face.getAttribute('aria-label'), `Peppy is ${value === 'idle' ? 'here with you' : value}`);
    }
    async function animationNames() {
      return face.evaluate(node => [...node.querySelectorAll('.face-eyes,.face-gaze,.face-mouth')].map(part => getComputedStyle(part).animationName));
    }
    await state('idle');
    assert.ok((await animationNames()).includes('peppy-blink'));
    assert.equal(await page.locator('.hello-illustration .peppy-face[aria-hidden=true]').count(), 1);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await state('listening');
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    await state('idle');
    const input = page.getByRole('textbox', { name: 'Your message', exact: true });
    const chatRequest = page.waitForRequest(`${base}/api/chat`);
    await input.fill('Hello Peppy');
    await input.press('Enter');
    await state('thinking');
    await chatRequest;
    finishChat();
    await page.getByText('Hello from Peppy', { exact: true }).waitFor();
    await state('idle');
    assert.equal(await page.locator('.hello-illustration').count(), 0);
    let speechRequest = page.waitForRequest(`${base}/api/speech`);
    await page.getByRole('button', { name: 'Read last reply', exact: true }).click();
    await state('thinking');
    await speechRequest;
    finishSpeech();
    await state('speaking');
    assert.ok((await animationNames()).includes('peppy-talk'));
    await page.getByLabel("Animate Peppy's face", { exact: true }).uncheck();
    assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
    await page.getByLabel("Animate Peppy's face", { exact: true }).check();
    await page.evaluate(() => window.testAudio.onended());
    await state('idle');
    speechRequest = page.waitForRequest(`${base}/api/speech`);
    await page.getByRole('button', { name: 'Read last reply', exact: true }).click();
    await state('thinking');
    await speechRequest;
    finishSpeech();
    await state('speaking');
    await page.getByRole('button', { name: 'Stop speaking', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [text, expression] of [['Wonderful! Nice work.', 'happy'], ['Hooray! We did it!', 'excited'], ['Wow, what a surprise!', 'surprised']]) {
      reply = text;
      const request = page.waitForRequest(`${base}/api/chat`);
      await input.fill('Tell me more');
      await input.press('Enter');
      await state('thinking');
      assert.equal(await face.getAttribute('data-expression'), 'neutral');
      await request;
      finishChat();
      await page.getByText(text, { exact: true }).waitFor();
      await page.locator(`.peppy-presence .peppy-face[data-expression="${expression}"]`).waitFor();
      assert.equal(await face.getAttribute('aria-label'), `Peppy is ${expression}`);
      speechRequest = page.waitForRequest(`${base}/api/speech`);
      await page.getByRole('button', { name: 'Read last reply', exact: true }).click();
      await speechRequest;
      finishSpeech();
      await page.locator(`.peppy-presence .peppy-face[data-state=speaking][data-expression="${expression}"]`).waitFor();
      assert.equal(await face.getAttribute('aria-label'), `Peppy is speaking (${expression})`);
      await preference.uncheck();
      assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
      await preference.check();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
      await page.getByRole('button', { name: 'Stop speaking', exact: true }).click();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    await page.reload();
    await page.locator('.peppy-presence .peppy-face[data-expression=surprised]').waitFor();
    await page.clock.install();
    await input.fill('draft');
    await page.clock.runFor(25000);
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    await input.fill('');
    await page.clock.runFor(20000);
    assert.equal(await face.getAttribute('data-expression'), 'winking');
    await page.clock.runFor(2500);
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    await page.clock.runFor(20000);
    assert.equal(await face.getAttribute('data-expression'), 'cheeky');
    await page.evaluate(() => {
      window.testHidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(25000);
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(19000);
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    await page.clock.runFor(1000);
    assert.equal(await face.getAttribute('data-expression'), 'winking');
    await preference.uncheck();
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    await page.clock.runFor(25000);
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    await preference.check();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(25000);
    assert.equal(await face.getAttribute('data-expression'), 'surprised');
    if (width < 701) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'New chat', exact: true }).filter({ visible: true }).click();
    assert.equal(await face.getAttribute('data-expression'), 'neutral');
    await state('idle');
    await preference.uncheck();
    assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
    await page.reload();
    await state('idle');
    assert.equal(await preference.isChecked(), false);
    assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
    await preference.check();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await state('listening');
    assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    speechRequest = page.waitForRequest(`${base}/api/speech`);
    await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
    await state('thinking');
    await speechRequest;
    finishSpeech();
    await state('speaking');
    assert.deepEqual(await animationNames(), ['none', 'none', 'none']);
    await page.getByRole('button', { name: 'Stop speaking', exact: true }).click();
    await face.scrollIntoViewIfNeeded();
    assert.equal(await face.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

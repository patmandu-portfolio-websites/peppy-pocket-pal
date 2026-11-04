import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { adjustImageCrop } from './imageEditing.js';

test('crop resizing and movement clamp to the original and retain minimum dimensions', () => {
  const crop = { left: 20, top: 20, width: 60, height: 60 };
  assert.deepEqual(adjustImageCrop(crop, 'nw', -50, -50), { left: 0, top: 0, width: 80, height: 80 });
  assert.deepEqual(adjustImageCrop(crop, 'se', 50, 50), { left: 20, top: 20, width: 80, height: 80 });
  assert.deepEqual(adjustImageCrop(crop, 'move', 100, -100), { left: 40, top: 0, width: 60, height: 60 });
  assert.equal(adjustImageCrop(crop, 'w', 100, 0).width, 1);
  assert.equal(adjustImageCrop(crop, 'n', 0, 100).height, 1);
  assert.equal(adjustImageCrop(crop, 'e', -100, 0).width, 1);
  assert.equal(adjustImageCrop(crop, 's', 0, -100).height, 1);
});

test('browser editor crops, rotates, removes background, applies effects and exports without uploads', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const uploads = [];
  page.on('request', request => { if (request.method() !== 'GET') uploads.push(request.url()); });
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 100, 80);
    context.fillStyle = '#f00'; context.fillRect(20, 20, 20, 20);
    return canvas.toDataURL();
  });
  await page.getByLabel('Select chat image', { exact: true }).setInputFiles({
    name: 'colours.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64')
  });
  await page.getByRole('button', { name: 'Edit image', exact: true }).click();
  const use = page.getByRole('button', { name: 'Use edited image in chat', exact: true });
  await use.waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Use edited image in chat').disabled);
  const sample = () => page.getByLabel('Edited image preview', { exact: true }).evaluate(canvas => {
    const context = canvas.getContext('2d');
    return { width: canvas.width, height: canvas.height,
      corner: [...context.getImageData(0, 0, 1, 1).data],
      subject: [...context.getImageData(25, 25, 1, 1).data] };
  });
  assert.deepEqual((await sample()).corner, [255, 255, 255, 255]);
  assert.equal(await page.getByRole('button', { name: /^Resize crop/ }).count(), 8);
  const cropArea = page.getByLabel('Original image crop area', { exact: true });
  await cropArea.scrollIntoViewIfNeeded();
  const cropBounds = await cropArea.boundingBox();
  const corner = page.getByRole('button', { name: 'Resize crop bottom right', exact: true });
  const cornerBounds = await corner.boundingBox();
  await page.mouse.move(cornerBounds.x + cornerBounds.width / 2, cornerBounds.y + cornerBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(cornerBounds.x + cornerBounds.width / 2 - cropBounds.width * 0.25,
    cornerBounds.y + cornerBounds.height / 2 - cropBounds.height * 0.25, { steps: 5 });
  await page.mouse.up();
  assert.ok(Math.abs(Number(await page.getByLabel('Crop width (%)', { exact: true }).inputValue()) - 75) < 1);
  assert.ok(Math.abs(Number(await page.getByLabel('Crop height (%)', { exact: true }).inputValue()) - 75) < 1);
  await page.waitForFunction(() => document.querySelector('.image-editor canvas').width === 75);
  await corner.focus();
  await page.keyboard.press('ArrowLeft');
  assert.ok(Math.abs(Number(await page.getByLabel('Crop width (%)', { exact: true }).inputValue()) - 74) < 1);
  const moveSelection = page.getByRole('button', { name: 'Move crop selection', exact: true });
  await moveSelection.focus();
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(Number(await page.getByLabel('Crop left (%)', { exact: true }).inputValue()), 10);
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click();
  // Dispatch genuine touch events so pointer capture and touch-action are exercised.
  await cropArea.scrollIntoViewIfNeeded();
  const touchBounds = await cropArea.boundingBox();
  const touchHandle = await page.getByRole('button', { name: 'Resize crop bottom right', exact: true }).boundingBox();
  const touch = await page.context().newCDPSession(page);
  const start = { x: touchHandle.x + touchHandle.width / 2, y: touchHandle.y + touchHandle.height / 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
    x: start.x - touchBounds.width * 0.2, y: start.y - touchBounds.height * 0.2
  }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  assert.ok(Math.abs(Number(await page.getByLabel('Crop width (%)', { exact: true }).inputValue()) - 80) < 1);
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.image-editor canvas').width === 100);
  await page.getByLabel('Remove matching background colour', { exact: true }).check();
  await page.waitForFunction(() => document.querySelector('.image-editor canvas').getContext('2d').getImageData(0, 0, 1, 1).data[3] === 0);
  assert.deepEqual((await sample()).subject, [255, 0, 0, 255]);
  await page.getByLabel('Crop width (%)', { exact: true }).fill('50');
  await page.getByLabel('Rotation', { exact: true }).selectOption('90');
  await page.waitForFunction(() => document.querySelector('.image-editor canvas').height === 50);
  assert.equal((await sample()).width, 80);
  await page.getByLabel('Crop left (%)', { exact: true }).fill('90');
  await page.getByRole('alert').filter({ hasText: 'Crop must stay' }).waitFor();
  assert.equal(await use.isDisabled(), true);
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click();
  await page.getByLabel('Grayscale (%)', { exact: true }).fill('100');
  await page.waitForFunction(() => {
    const pixel = document.querySelector('.image-editor canvas').getContext('2d').getImageData(25, 25, 1, 1).data;
    return pixel[0] === pixel[1] && pixel[1] === pixel[2];
  });
  await page.getByLabel('Flip horizontally', { exact: true }).check();
  await page.waitForFunction(() => document.querySelector('.image-editor canvas').getContext('2d').getImageData(65, 25, 1, 1).data[0] < 200);
  for (const [label, value] of [['Brightness (%)', '120'], ['Contrast (%)', '110'], ['Sepia (%)', '30'], ['Blur (pixels)', '2']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Use edited image in chat').disabled);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download edited PNG', exact: true }).click();
  assert.equal((await downloadEvent).suggestedFilename(), 'peppy-edited.png');
  await use.click();
  await page.getByRole('region', { name: 'Image editor', exact: true }).waitFor({ state: 'detached' });
  const edited = await page.getByAltText('Image attached for review').getAttribute('src');
  assert.notEqual(edited, data);
  assert.deepEqual(uploads, []);
  await page.getByRole('button', { name: 'Edit image', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel image editing', exact: true }).click();
  assert.equal(await page.getByAltText('Image attached for review').getAttribute('src'), edited);
});

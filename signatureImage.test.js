import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transparentSignature } from './signatureImage.js';

test('signature background removal preserves dark ink and existing alpha', () => {
  const image = { width: 3, height: 1, data: new Uint8ClampedArray([
    255, 255, 255, 255, 20, 30, 40, 255, 30, 40, 120, 128
  ]) };
  const bounds = transparentSignature(image, 200);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[7], 255);
  assert.equal(image.data[11], 128);
  assert.deepEqual(bounds, { left: 0, top: 0, right: 2, bottom: 0 });
});

test('signature cropping, threshold and blank-image failures', () => {
  const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  const i = (10 * 20 + 10) * 4;
  data[i] = data[i + 1] = data[i + 2] = 0;
  assert.deepEqual(transparentSignature({ width: 20, height: 20, data }), { left: 6, top: 6, right: 14, bottom: 14 });
  assert.throws(() => transparentSignature({ width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }), /No signature ink/);
  for (const threshold of [0, 251, NaN, 180.5]) assert.throws(() => transparentSignature({}, threshold), /threshold/);
});

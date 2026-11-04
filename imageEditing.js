export const defaultImageEdits = {
  left: 0, top: 0, width: 100, height: 100, rotation: 0, flipX: false, flipY: false,
  brightness: 100, contrast: 100, grayscale: 0, sepia: 0, blur: 0,
  transparent: false, colour: '#ffffff', tolerance: 30
};

export function adjustImageCrop(crop, handle, dx, dy) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  if (handle === 'move') return {
    left: clamp(crop.left + dx, 0, 100 - crop.width),
    top: clamp(crop.top + dy, 0, 100 - crop.height),
    width: crop.width, height: crop.height
  };
  let left = crop.left, top = crop.top;
  let right = left + crop.width, bottom = top + crop.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - 1);
  if (handle.includes('e')) right = clamp(right + dx, left + 1, 100);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - 1);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + 1, 100);
  return { left, top, width: right - left, height: bottom - top };
}

export function renderImageEdit(source, canvas, edits) {
  for (const [key, minimum, maximum] of [
    ['left', 0, 99], ['top', 0, 99], ['width', 1, 100], ['height', 1, 100],
    ['brightness', 0, 200], ['contrast', 0, 200], ['grayscale', 0, 100], ['sepia', 0, 100],
    ['blur', 0, 20], ['tolerance', 0, 255]
  ]) {
    if (!Number.isFinite(edits[key]) || edits[key] < minimum || edits[key] > maximum) throw new Error(`Invalid ${key} setting.`);
  }
  if (edits.left + edits.width > 100 || edits.top + edits.height > 100) throw new Error('Crop must stay inside the image. Reduce its width/height or starting position.');
  if (![0, 90, 180, 270].includes(edits.rotation) || !/^#[0-9a-f]{6}$/i.test(edits.colour)) throw new Error('Invalid rotation or background colour.');
  const sx = Math.floor(source.width * edits.left / 100);
  const sy = Math.floor(source.height * edits.top / 100);
  const width = Math.max(1, Math.floor(source.width * edits.width / 100));
  const height = Math.max(1, Math.floor(source.height * edits.height / 100));
  canvas.width = edits.rotation % 180 ? height : width;
  canvas.height = edits.rotation % 180 ? width : height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image editing is unavailable in this browser.');
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(edits.flipX ? -1 : 1, edits.flipY ? -1 : 1);
  context.rotate(edits.rotation * Math.PI / 180);
  context.drawImage(source, sx, sy, width, height, -width / 2, -height / 2, width, height);
  context.restore();
  if (edits.transparent) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const colour = [1, 3, 5].map(start => parseInt(edits.colour.slice(start, start + 2), 16));
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (Math.max(...colour.map((value, channel) => Math.abs(pixels.data[i + channel] - value))) <= edits.tolerance) pixels.data[i + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
  }
  const filter = `brightness(${edits.brightness}%) contrast(${edits.contrast}%) grayscale(${edits.grayscale}%) sepia(${edits.sepia}%) blur(${edits.blur}px)`;
  const needsEffects = ['brightness', 'contrast', 'grayscale', 'sepia', 'blur'].some(key => edits[key] !== defaultImageEdits[key]);
  if (needsEffects) {
    if (!('filter' in context)) throw new Error('This browser does not support image effects. Reset the effects or use a supported browser.');
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.filter = filter;
    context.drawImage(copy, 0, 0);
    context.filter = 'none';
  }
}

export function imageEditBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('Could not export the edited image.')), 'image/png'));
}

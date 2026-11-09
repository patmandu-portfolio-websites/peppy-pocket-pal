export function transparentSignature(image, threshold = 200) {
  if (!Number.isInteger(threshold) || threshold < 120 || threshold > 250) throw new Error('Choose a background threshold from 120 to 250.');
  const { width, height, data } = image;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const light = Math.min(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, (threshold - light) / 40)));
    if (data[i + 3] > 8) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('No signature ink found. Lower the threshold or choose a clearer image.');
  return { left: Math.max(0, left - 4), top: Math.max(0, top - 4),
    right: Math.min(width - 1, right + 4), bottom: Math.min(height - 1, bottom + 4) };
}

export async function prepareSignature(file, threshold) {
  if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 4 * 1024 * 1024) throw new Error('Choose a PNG/JPEG signature photo up to 4 MiB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 16000000) throw new Error('Signature photo exceeds 16 megapixels.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Signature image processing is unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = transparentSignature(pixels, threshold);
    context.putImageData(pixels, 0, 0);
    const cropped = document.createElement('canvas');
    cropped.width = bounds.right - bounds.left + 1;
    cropped.height = bounds.bottom - bounds.top + 1;
    const output = cropped.getContext('2d');
    if (!output) throw new Error('Signature image processing is unavailable.');
    output.drawImage(canvas, bounds.left, bounds.top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    const blob = await new Promise(resolve => cropped.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > 512 * 1024) throw new Error('Prepared signature exceeds 512 KiB. Crop or simplify the photo first.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read prepared signature.'));
      reader.readAsDataURL(blob);
    });
    return { data, ratio: cropped.height / cropped.width, name: 'Transparent signature' };
  } finally { bitmap.close(); }
}

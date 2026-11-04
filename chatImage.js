export async function readChatImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024 || !file.size) {
    throw new Error('Choose a PNG, JPEG or WebP image up to 4 MiB. Convert HEIC images to JPEG first.');
  }
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 16000000) throw new Error('Image exceeds 16 megapixels. Resize it before attaching.');
  } finally { image.close(); }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The image could not be read. Please select it again.'));
    reader.readAsDataURL(file);
  });
}

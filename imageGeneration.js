export function isImageGenerationRequest(value) {
  const prompt = /^\s*(?:(?:hey\s+)?peppy[,\s]*)?(?:(?:please|can you|could you|would you|i want you to|i'd like you to)\s+)?/i;
  const request = value.replace(prompt, '');
  if (/^(?:draw|paint|illustrate)\b/i.test(request)) return true;
  return /^(?:generate|create|make|design)\b.{0,80}\b(?:image|picture|illustration|artwork|photo|drawing|painting|portrait|logo|icon|wallpaper|poster|graphic|banner|sticker|thumbnail|diagram|comic|cover|card)\b/i.test(request);
}

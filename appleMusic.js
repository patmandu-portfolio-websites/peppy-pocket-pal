export function parseMusicCommand(text) {
  const match = /^peppy[\s,]+(play|find|search(?:\s+for)?|resume|pause|skip|next)\b(.*)$/i.exec(text.trim());
  if (!match) return null;
  const action = match[1].toLowerCase();
  const query = match[2].trim().replace(/\s+(?:on|in)\s+apple\s+music[.!?]*$/i, '').replace(/[.!?]+$/, '').trim();
  if (['play', 'find', 'search', 'search for'].includes(action) && query && !/^(?:music|apple music|the music)$/i.test(query)) {
    return { action: 'search', query: query.replace(/\s+by\s+/i, ' ') };
  }
  if (query && !/^(?:music|apple music|the music|song|track|the song|the track)$/i.test(query)) return null;
  return { action: 'manual' };
}

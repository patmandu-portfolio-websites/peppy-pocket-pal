export function amazonSearchLink(query) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 300) {
    throw new Error('Enter an Amazon search query of 1-300 characters.');
  }
  const url = new URL('https://www.amazon.com.au/s');
  url.searchParams.set('k', query.trim());
  return url.href;
}

export function parseAmazonCommand(text) {
  const match = /^peppy[\s,]+(?:find|search(?:\s+for)?)\s+(.*?)\s+(?:on|in)\s+amazon(?:\s+australia)?[.!?]*$/i.exec(text.trim()) ||
    /^peppy[\s,]+search\s+amazon(?:\s+australia)?\s+for\s*(.*)$/i.exec(text.trim());
  return match ? { query: match[1].replace(/[.!?]+$/, '').trim() } : null;
}

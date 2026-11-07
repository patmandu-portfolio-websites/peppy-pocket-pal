export async function findAppleSongs(query, country, fetchImpl = fetch) {
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: query, country, entity: 'song', limit: '10' }).toString();
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`Apple catalog search failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.results)) throw new Error('Apple returned an invalid catalog response.');
  return data.results.map(song => {
    if (!Number.isSafeInteger(song.trackId) || typeof song.trackName !== 'string' ||
        typeof song.artistName !== 'string' || typeof song.collectionName !== 'string') {
      throw new Error('Apple returned invalid song details.');
    }
    const link = new URL(song.trackViewUrl);
    if (link.protocol !== 'https:' || link.hostname !== 'music.apple.com' || link.username || link.password || link.port) {
      throw new Error('Apple returned an unsupported song link.');
    }
    return { id: String(song.trackId), name: song.trackName, artist: song.artistName, album: song.collectionName, url: link.href };
  });
}

export function installAppleMusic(app, { fetchImpl = fetch } = {}) {
  app.get('/api/music/search', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : '';
    if (!query || query.length > 300 || !/^[A-Z]{2}$/.test(country)) {
      console.error('Apple song search rejected invalid query or country.');
      return res.status(400).json({ error: 'Enter a song/artist query of 1–300 characters and a two-letter country code.' });
    }
    try { res.json({ songs: await findAppleSongs(query, country, fetchImpl) }); }
    catch {
      console.error('Apple catalog search failed. Check the connection or retry later.');
      res.status(502).json({ error: 'Apple song search is unavailable. Check your connection or try again later.' });
    }
  });
}

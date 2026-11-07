import React, { useEffect, useRef, useState } from 'react';

export function useAppleMusic() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [country, setCountry] = useState('NZ');
  const locked = useRef(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function command({ action, query }) {
    if (action !== 'search') return 'Peppy cannot control Apple Music playback. Open a song link below and use Apple Music to play, pause or skip manually.';
    if (locked.current) throw new Error('An Apple Music song search is already in progress. Please wait.');
    if (!query.trim() || query.trim().length > 300 || !/^[a-z]{2}$/i.test(country)) {
      throw new Error('Enter a song/artist query of 1–300 characters and a two-letter country code.');
    }
    locked.current = true;
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setError(''); setResults([]);
    try {
      const params = new URLSearchParams({ q: query.trim(), country: country.toUpperCase() });
      const response = await fetch(`/api/music/search?${params}`, { signal: active.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Apple song search failed.');
      if (!Array.isArray(data.songs)) throw new Error('Apple song search returned an invalid response.');
      setResults(data.songs);
      return data.songs.length ? `Found ${data.songs.length} song(s). Open a song link in the Apple Music panel below and play manually. Nothing has started playing.` :
        'No matching songs were found. Try another song/artist or country.';
    } catch (cause) {
      if (!active.signal.aborted) setError(cause.message);
      throw cause;
    } finally {
      locked.current = false;
      if (!active.signal.aborted) setBusy(false);
    }
  }
  return { busy, error, results, country, setCountry, command };
}

export default function AppleMusicPanel({ music, stopVoice }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (music.results.length) setOpen(true); }, [music.results]);
  async function search() {
    stopVoice(); setNotice('');
    try { setNotice(await music.command({ action: 'search', query })); }
    catch (cause) { setNotice(cause.message); }
  }
  return <details className="feature-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Apple Music — song links</summary>
    <div className="feature-panel-body">
      <p>Find songs using Apple's public catalog search, then open a link and play manually in Apple Music. No Apple Developer membership, key, or sign-in to Peppy is needed. Apple Music handles its own sign-in and any subscription required for listening.</p>
      <p>Searching sends only the query and selected country to Apple's catalog, not OpenAI. Peppy cannot play, pause, skip, buy, or download songs.</p>
      <label>Song or artist <input value={query} maxLength={300} disabled={music.busy} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }}/></label>
      <label>Catalog country (two-letter code) <input value={music.country} maxLength={2} disabled={music.busy}
        onChange={event => music.setCountry(event.target.value.toUpperCase())}/></label>
      <button type="button" disabled={music.busy || !query.trim()} onClick={search}>Find songs on Apple Music</button>
      <p>Type “Peppy, find Hello by Adele on Apple Music”, or dictate it with the microphone and Send. “Peppy, play…” also finds links; it never starts playback.</p>
      {music.results.length > 0 && <section aria-label="Apple Music song results">
        <h3>Choose a song</h3>
        <p>Review the artist and album; availability can differ from the Apple Music catalog.</p>
        <ul className="music-results">{music.results.map(song => <li key={song.id}>
          <strong>{song.name}</strong> — {song.artist}<br/><small>{song.album}</small><br/>
          <a href={song.url} target="_blank" rel="noopener noreferrer">Open {song.name} in Apple Music</a>
        </li>)}</ul>
      </section>}
      {notice && <p role="status">{notice}</p>}
      {music.error && <p role="alert">{music.error}</p>}
    </div>
  </details>;
}

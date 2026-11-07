import React, { useState } from 'react';
import { amazonSearchLink } from './amazonLinks.js';

export default function AmazonLinksPanel({ stopVoice }) {
  const [query, setQuery] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  function search() {
    stopVoice(); setLink(''); setError('');
    try { setLink(amazonSearchLink(query)); }
    catch (cause) { setError(cause.message); }
  }
  return <details className="feature-panel">
    <summary>Amazon Australia - search links</summary>
    <div className="feature-panel-body">
      <p>Prepare a search link, then open Amazon to choose products and shop manually. Peppy does not retrieve product listings, prices or availability, sign in, add items to your cart, or buy anything through this feature.</p>
      <p>No API key is needed. Your query is sent to Amazon only when you open the link, not to OpenAI. Keep credentials and payment details out of Peppy chat.</p>
      <label>Amazon product search <input value={query} maxLength={300} onChange={event => { setQuery(event.target.value); setLink(''); setError(''); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}/></label>
      <button type="button" onClick={search}>Prepare Amazon search link</button>
      {link && <p><a href={link} target="_blank" rel="noopener noreferrer">Open search on Amazon Australia</a></p>}
      {error && <p role="alert">{error}</p>}
      <p>Type "Peppy, find wireless headphones on Amazon", or dictate it with the microphone and Send. Sign-in, cart changes and purchases happen only on Amazon, under your control.</p>
    </div>
  </details>;
}

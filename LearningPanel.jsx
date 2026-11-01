import React, { useState } from 'react';
import { approveProposal, checkedText, correctEntry, learningContext, suggestionStatus, validateProposal } from './learning.js';

export function LearningPanel({ state, save }) {
  const [kind, setKind] = useState('memory');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState({});
  function change(fn) {
    setError('');
    try { save(fn(state)); } catch (cause) { setError(cause.message); }
  }
  function manual() {
    setError('');
    try {
      setPending(validateProposal({ kind, title, content, source, certainty: 'uncertain', benefit: content, risks: 'Not assessed; investigation required.', testPlan: 'Review and test separately before installation.', rollbackPlan: 'No installation authorized; define rollback during investigation.' }));
    } catch (cause) { setError(cause.message); }
  }
  async function propose() {
    setBusy(true); setError('');
    try {
      const evidence = checkedText(content, 'Selected evidence', 6000);
      const response = await fetch('/api/learning/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, evidence: `${evidence}\nSource: ${source}` }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPending(validateProposal(data.proposal));
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  let context = '';
  try { context = learningContext(state); } catch (cause) { context = cause.message; }
  return <section aria-label="Learning and suggestions">
    <h3>Approved learning and suggestions</h3>
    <p>Stored in this browser only, not encrypted or synchronized. This is saved context, not model training. No automatic email/PDF ingestion or self-updates.</p>
    <label><input type="checkbox" checked={state.enabled} onChange={event => change(value => ({ ...value, enabled: event.target.checked }))}/> Include selected entries in AI requests</label>
    <label><input type="checkbox" checked={state.suggestionsEnabled} onChange={event => change(value => ({ ...value, suggestionsEnabled: event.target.checked }))}/> Enable suggestion queue</label>
    <label>Proposal type <select value={kind} onChange={event => { setKind(event.target.value); setPending(null); }}><option value="memory">Personal memory</option><option value="knowledge">Sourced knowledge</option><option value="suggestion">Improvement suggestion</option></select></label>
    <label>Proposal title <input value={title} onChange={event => setTitle(event.target.value)}/></label>
    <label>Selected evidence or note <textarea value={content} onChange={event => setContent(event.target.value)}/></label>
    <label>Source (HTTPS URL for knowledge) <input value={source} onChange={event => setSource(event.target.value)}/></label>
    <button type="button" disabled={busy || (kind === 'suggestion' && !state.suggestionsEnabled)} onClick={manual}>Preview my proposed entry</button>
    <p>The following button sends only the entered evidence/source to OpenAI, with API charges. It does not save the result automatically.</p>
    <button type="button" disabled={busy || (kind === 'suggestion' && !state.suggestionsEnabled)} onClick={propose}>Send selected evidence to AI and propose</button>
    {pending && <div><h4>Review exact proposal</h4><pre>{JSON.stringify(pending, null, 2)}</pre>
      <label><input type="checkbox" checked={pending.certainty === 'confirmed'} onChange={event => setPending({ ...pending, certainty: event.target.checked ? 'confirmed' : 'uncertain' })}/> I confirm this information (otherwise uncertain)</label>
      <button type="button" onClick={() => {
        try { save(approveProposal(state, pending, crypto.randomUUID())); setPending(null); setError(''); }
        catch (cause) { setError(cause.message); }
      }}>Approve saving locally</button>
      <button type="button" onClick={() => setPending(null)}>Decline</button>
    </div>}
    <label>Search saved entries <input value={query} onChange={event => setQuery(event.target.value)}/></label>
    {state.entries.filter(item => `${item.title} ${item.content} ${item.source}`.toLowerCase().includes(query.toLowerCase())).map(item => <article key={item.id}>
      <h4>{item.title} ({item.kind}, {item.certainty})</h4>
      <p>Source: {item.source}. Last corrected/saved: {item.updated}. Source may be stale; conflicting entries are not automatically resolved.</p>
      <textarea aria-label={`Correct ${item.title}`} value={edits[item.id] ?? item.content} onChange={event => setEdits({ ...edits, [item.id]: event.target.value })}/>
      <button type="button" onClick={() => change(value => correctEntry(value, item.id, edits[item.id] ?? item.content))}>Approve correction</button>
      <label><input type="checkbox" checked={item.included} onChange={event => change(value => {
        const next = { ...value, entries: value.entries.map(entry => entry.id === item.id ? { ...entry, included: event.target.checked } : entry) };
        learningContext(next); return next;
      })}/> Authorize this entry in AI chat context</label>
      <details><summary>Correction history</summary><pre>{JSON.stringify(item.history, null, 2)}</pre></details>
      <button type="button" onClick={() => change(value => ({ ...value, entries: value.entries.filter(entry => entry.id !== item.id) }))}>Delete entry and history</button>
    </article>)}
    <details><summary>Exact additional context sent with chat</summary><pre>{context || 'None'}</pre></details>
    <p>Deleting/ disabling entries affects future requests, not old chat messages or data already sent to OpenAI. Clear legacy notes separately.</p>
    <h4>Suggestion queue</h4>
    {state.suggestions.map(item => <article key={item.id}><pre>{JSON.stringify(item, null, 2)}</pre>
      <button type="button" disabled={!state.suggestionsEnabled || item.status !== 'pending'} onClick={() => change(value => suggestionStatus(value, item.id, 'investigate'))}>Accept for investigation only</button>
      <button type="button" disabled={item.status === 'dismissed'} onClick={() => change(value => suggestionStatus(value, item.id, 'dismissed'))}>Dismiss</button>
    </article>)}
    <p>Accepting records your decision only. It cannot write code, install updates or change permissions.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}

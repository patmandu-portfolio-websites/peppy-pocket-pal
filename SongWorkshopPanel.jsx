import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { validateSongDraft } from './songWorkshop.js';

export default forwardRef(function SongWorkshopPanel({ stopVoice, onBusyChange }, ref) {
  const [brief, setBrief] = useState('');
  const [genre, setGenre] = useState('Acoustic pop');
  const [mood, setMood] = useState('Warm and uplifting');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [task, setTask] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [approved, setApproved] = useState(false);
  const [checking, setChecking] = useState(false);
  const paidLock = useRef(false);
  const taskRef = useRef(null);
  const pollStarted = useRef(0);
  const active = useRef(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch('/api/music/suno/config', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('SunoAPI configuration unavailable.');
      setConfig(await response.json());
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  async function draftSong(songBrief = brief) {
    if (active.current || paidLock.current) throw new Error('Wait for the current song request.');
    stopVoice(); setError(''); setNotice(''); setBusy(true);
    const controller = new AbortController();
    active.current = controller;
    try {
      const response = await fetch('/api/music/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: songBrief, genre, mood }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Song generation failed.');
      const result = validateSongDraft(data.draft);
      setDraft(result); setSubmitted(false); setApproved(false); setTask(null); taskRef.current = null;
      setNotice('Draft ready for review. No audio was generated and nothing was sent to Suno.');
      return result;
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'Song generation failed.');
      throw cause;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      active.current = null;
    }
  }
  async function generate(event) {
    event.preventDefault();
    try { await draftSong(); } catch { /* The request error is shown in the panel. */ }
  }
  useImperativeHandle(ref, () => ({
    async draftFromChat(songBrief) {
      setOpen(true); setBrief(songBrief);
      return draftSong(songBrief);
    }
  }));
  async function checkTask(id) {
    setChecking(true); setError('');
    try {
      const response = await fetch(`/api/music/suno/tasks/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Song status unavailable.');
      if (taskRef.current === id) setTask(data.task);
    } catch (cause) { if (taskRef.current === id) setError(cause.message); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    if (!task || !['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS'].includes(task.status) || error) return;
    const timer = setTimeout(() => {
      if (Date.now() - pollStarted.current > 10 * 60 * 1000) setError('Automatic checks stopped after 10 minutes. Check the provider dashboard or refresh song status; do not regenerate automatically.');
      else if (document.hidden) setError('Automatic status checks paused. Refresh song status when ready.');
      else void checkTask(task.requestId);
    }, 10000);
    return () => clearTimeout(timer);
  }, [task, error]);
  async function createAudio() {
    if (paidLock.current || submitted || !approved) return;
    paidLock.current = true;
    setSubmitted(true); setBusy(true); setError(''); setNotice(''); stopVoice();
    try {
      const id = crypto.randomUUID();
      taskRef.current = id;
      const response = await fetch('/api/music/suno/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, approved: true, requestId: id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Submission outcome unknown. Check your provider dashboard before approving another generation.');
      setTask(data.task);
      pollStarted.current = Date.now();
      setNotice('Paid generation submitted. Songs open only when you click their links.');
    } catch (cause) { setError(cause.message || 'Submission outcome unknown. Check your provider dashboard before retrying.'); }
    finally { setBusy(false); paidLock.current = false; }
  }
  async function copy(field) {
    setError(''); setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Select and copy the text manually.');
      await navigator.clipboard.writeText(draft[field]);
      setNotice(field === 'lyrics' ? 'Lyrics copied.' : 'Style prompt copied.');
    } catch (cause) { setError(`Could not copy: ${cause.message}. Select the text and copy manually if needed.`); }
  }
  function edit(field, value) { setDraft(previous => ({ ...previous, [field]: value })); setNotice(''); setApproved(false); }
  return <details className="feature-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Song workshop - lyrics and music prompt</summary>
    <div className="feature-panel-body">
      <p>Create original lyrics and a music-style prompt with your existing OpenAI connection. Generating a draft sends only the fields below to OpenAI and incurs API charges; your chat history and memories are not included.</p>
      <p>Copy the draft for manual use on Suno, or separately approve paid audio generation through SunoAPI.org (a third-party provider). Only the reviewed title, lyrics and style are sent to that provider. Keep credentials and private details out of your brief.</p>
      <p>In chat, type or dictate "Peppy, write a song about a new adventure". This drafts lyrics only; audio always needs the separate approval below.</p>
      <form onSubmit={generate}>
        <label>Song idea <textarea value={brief} required maxLength={2000} disabled={busy} rows={3}
          onChange={event => setBrief(event.target.value)} placeholder="A hopeful song about starting a new adventure"/></label>
        <label>Musical genre <input value={genre} required maxLength={100} disabled={busy} onChange={event => setGenre(event.target.value)}/></label>
        <label>Song mood <input value={mood} required maxLength={100} disabled={busy} onChange={event => setMood(event.target.value)}/></label>
        <button type="submit" disabled={busy || !brief.trim() || !genre.trim() || !mood.trim()}>Generate song draft</button>
      </form>
      {busy && <p role="status">Drafting lyrics and a style prompt...</p>}
      {draft && <section aria-label="Song draft">
        <p>Editable draft. This workshop is not saved automatically; copy anything you want to keep before reloading. Regenerating replaces the draft only on success.</p>
        <label>Song title <input value={draft.title} maxLength={160} disabled={busy} onChange={event => edit('title', event.target.value)}/></label>
        <label htmlFor="song-lyrics">Original lyrics</label>
        <textarea id="song-lyrics" value={draft.lyrics} maxLength={8000} rows={10} disabled={busy} onChange={event => edit('lyrics', event.target.value)}/>
        <button type="button" disabled={busy || !draft.lyrics.trim()} onClick={() => copy('lyrics')}>Copy lyrics</button>
        <label htmlFor="song-style">Music style prompt</label>
        <textarea id="song-style" value={draft.style} maxLength={1000} rows={3} disabled={busy} onChange={event => edit('style', event.target.value)}/>
        <button type="button" disabled={busy || !draft.style.trim()} onClick={() => copy('style')}>Copy style prompt</button>
        <section aria-label="Approve paid song generation">
          <h3>SunoAPI.org audio generation</h3>
          <p>Model: V4_5PLUS (deprecated; retained by the provider for compatibility). Cost unavailable — generation uses paid provider credits. OpenAI lyric-drafting charges are separate. The provider may generate multiple variations; check its dashboard for actual billing and licensing.</p>
          <p>For this model, shorten the title to 80 characters and lyrics to 5000 before approval. Deploy Peppy to Render first so the provider can reach its callback. Song links are temporary; provider documentation states files are retained for 14 days.</p>
          {!config?.configured && <p role="alert">SunoAPI audio generation is unavailable. Configure SUNO_API_KEY and restart the server, or use the manual Suno link.</p>}
          <label><input type="checkbox" checked={approved} disabled={busy || submitted} onChange={event => setApproved(event.target.checked)}/> I approve sending this draft to SunoAPI.org and using paid credits; the cost is unavailable.</label>
          <button type="button" disabled={busy || submitted || !approved || !config?.configured || draft.title.length > 80 || draft.lyrics.length > 5000 ||
            !draft.title.trim() || !draft.lyrics.trim() || !draft.style.trim()} onClick={createAudio}>Generate song — uses paid credits</button>
          {submitted && <p>Approval has been used. Do not regenerate an uncertain submission; check your SunoAPI dashboard first.</p>}
        </section>
      </section>}
      {task && <section aria-label="Generated songs">
        <p role="status">Song generation: {task.status}</p>
        {!['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS', 'SUCCESS'].includes(task.status) && <p role="alert">The provider reported a generation failure. Check your dashboard for details and billing before trying again.</p>}
        <button type="button" disabled={checking} onClick={() => checkTask(task.requestId)}>Refresh song status</button>
        <ul>{task.songs.map(song => <li key={song.id}><a href={song.url} target="_blank" rel="noopener noreferrer">Open generated song: {song.title}</a></li>)}</ul>
        <p>Tasks are tracked temporarily in this server process. Copy finished links before reloading; after a restart or lost task, use the provider dashboard. Windows and Render do not sync tasks.</p>
      </section>}
      <p><a href="https://suno.com/create" target="_blank" rel="noopener noreferrer">Open Suno</a></p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
});

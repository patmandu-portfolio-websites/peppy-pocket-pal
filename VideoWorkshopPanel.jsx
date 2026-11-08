import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { validateVideoDraft } from './videoWorkshop.js';

export default forwardRef(function VideoWorkshopPanel({ stopVoice, onBusyChange }, ref) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [style, setStyle] = useState('Warm cinematic');
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState('16:9');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  async function plan(videoBrief = brief) {
    if (active.current) throw new Error('A video plan is already in progress. Please wait.');
    stopVoice(); setError(''); setNotice(''); setBusy(true);
    const controller = new AbortController();
    active.current = controller;
    try {
      const response = await fetch('/api/video/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: videoBrief, style, duration, aspect }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Video planning failed.');
      const result = validateVideoDraft(data.draft);
      setDraft(result);
      setNotice('Video plan ready for review. No video was generated or sent to Pika or Runway.');
      return result;
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'Video planning failed.');
      throw cause;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (active.current === controller) active.current = null;
    }
  }
  useImperativeHandle(ref, () => ({
    async draftFromChat(videoBrief) {
      setOpen(true); setBrief(videoBrief);
      return plan(videoBrief);
    }
  }));
  async function submit(event) {
    event.preventDefault();
    try { await plan(); } catch { /* Planning errors are displayed in the panel. */ }
  }
  async function copy(field) {
    setError(''); setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText(draft[field]);
      setNotice(field === 'prompt' ? 'Video prompt copied.' : 'Storyboard copied.');
    } catch (cause) { setError(`Could not copy: ${cause.message}. Select the text and copy manually if needed.`); }
  }
  function edit(field, value) { setDraft(previous => ({ ...previous, [field]: value })); setNotice(''); }
  return <details className="feature-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Video workshop - storyboard and prompt</summary>
    <div className="feature-panel-body">
      <p>Plan an original short video with Peppy, then generate it manually on Pika or Runway. Planning sends only the idea and settings below to OpenAI and incurs API charges, not your chat history or memories. No video-generation API key is needed.</p>
      <p>Pika advertises a $0 plan, but a free-generation allowance is not guaranteed here. Runway advertises 125 one-time free credits, not recurring credits. Availability, models, watermarks, downloads and licensing depend on the provider's current terms and your account. Website free tiers do not include a free Peppy API.</p>
      <p>Type or dictate "Peppy, create a video about a sunrise over the ocean" and Send. This prepares a plan only. Keep credentials and private details out of your idea.</p>
      <form onSubmit={submit}>
        <label htmlFor="video-idea">Video idea</label>
        <textarea id="video-idea" value={brief} required maxLength={2000} rows={3} disabled={busy} onChange={event => setBrief(event.target.value)}/>
        <label htmlFor="video-visual-style">Visual style</label>
        <input id="video-visual-style" value={style} required maxLength={150} disabled={busy} onChange={event => setStyle(event.target.value)}/>
        <label htmlFor="video-duration">Planned duration</label>
        <select id="video-duration" value={duration} disabled={busy} onChange={event => setDuration(Number(event.target.value))}>
          <option value={5}>5 seconds</option><option value={10}>10 seconds</option>
        </select>
        <label htmlFor="video-aspect">Aspect ratio</label>
        <select id="video-aspect" value={aspect} disabled={busy} onChange={event => setAspect(event.target.value)}>
          <option value="16:9">16:9 landscape</option><option value="9:16">9:16 portrait</option><option value="1:1">1:1 square</option>
        </select>
        <button type="submit" disabled={busy || !brief.trim() || !style.trim()}>Draft video plan</button>
      </form>
      {busy && <p role="status">Planning a storyboard and video prompt...</p>}
      {draft && <section aria-label="Video draft">
        <p>Review and edit before copying. Drafts are temporary; copy them before reloading. Failed regeneration keeps your draft; successful regeneration replaces it. The provider may require a reference image or different settings; this plan does not guarantee support.</p>
        <label htmlFor="video-title">Video title</label>
        <input id="video-title" value={draft.title} maxLength={160} disabled={busy} onChange={event => edit('title', event.target.value)}/>
        <label htmlFor="video-storyboard">Storyboard</label>
        <textarea id="video-storyboard" value={draft.storyboard} maxLength={6000} rows={6} disabled={busy} onChange={event => edit('storyboard', event.target.value)}/>
        <button type="button" disabled={busy || !draft.storyboard.trim()} onClick={() => copy('storyboard')}>Copy storyboard</button>
        <label htmlFor="video-prompt">Video prompt</label>
        <textarea id="video-prompt" value={draft.prompt} maxLength={2000} rows={5} disabled={busy} onChange={event => edit('prompt', event.target.value)}/>
        <button type="button" disabled={busy || !draft.prompt.trim()} onClick={() => copy('prompt')}>Copy video prompt</button>
      </section>}
      <p><a href="https://pika.art/" target="_blank" rel="noopener noreferrer">Open Pika</a> · <a href="https://app.runwayml.com/" target="_blank" rel="noopener noreferrer">Open Runway</a></p>
      <p>Sign in and paste your prompt yourself, review any charges, then generate on the provider's website. Peppy does not submit prompts, generate/play videos or access either account. Opening these links sends no draft text.</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
});

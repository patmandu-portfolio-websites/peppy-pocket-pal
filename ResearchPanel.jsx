import React, { useEffect, useRef, useState } from 'react';
import { localRequest } from './LocalAssistantPanel.jsx';
import { approveProposal } from './learning.js';
import ApprovalSection from './ApprovalSection.jsx';
import { createPortal } from 'react-dom';

export default function ResearchPanel({ learning, saveLearning, chatBusy, spokenReplies, speakInvitation, prepareConversation, notificationTarget }) {
  const [state, setState] = useState(null);
  const [topics, setTopics] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conversationSettings, setConversationSettings] = useState({ invitationsEnabled: false, spokenInvitations: false, ideasEnabled: false });
  const [selectedFindings, setSelectedFindings] = useState([]);
  const [visible, setVisible] = useState(!document.hidden);
  const speakingClaim = useRef(false);
  const activity = useRef(true);
  const activeChat = useRef(chatBusy);
  activeChat.current = chatBusy;
  const [saved, setSaved] = useState([]);
  async function refresh() {
    const data = await localRequest('/api/local/research');
    setState(data);
    return data;
  }
  useEffect(() => {
    let live = true;
    const active = () => { activity.current = true; };
    for (const event of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(event, active, { passive: true });
    localRequest('/api/local/research').then(data => {
      if (live) {
        setState(data); setTopics(data.topics.join('\n')); setEnabled(data.enabled);
        setConversationSettings({ invitationsEnabled: data.invitationsEnabled === true, spokenInvitations: data.spokenInvitations === true, ideasEnabled: data.ideasEnabled === true });
      }
    }).catch(cause => { if (live) setError(cause.message); });
    const pulse = async () => {
      if (document.hidden) return;
      const active = activity.current || activeChat.current;
      activity.current = false;
      try {
        await localRequest('/api/local/research/presence', { active });
        const data = await localRequest('/api/local/research');
        if (live) setState(data);
      } catch (cause) { activity.current = activity.current || active; if (live) setError(cause.message); }
    };
    void pulse();
    const timer = setInterval(pulse, 30000);
    const visibility = () => { setVisible(!document.hidden); activity.current = true; };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      live = false; clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      for (const event of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(event, active);
    };
  }, []);
  useEffect(() => {
    if (!visible || document.hidden || chatBusy || busy || state?.busy || !spokenReplies ||
        !state?.invitationsEnabled || !state?.spokenInvitations || !speakInvitation || speakingClaim.current) return;
    const invitation = (state.invitations || []).find(item => item.status === 'pending' && !item.spoken);
    if (!invitation) return;
    speakingClaim.current = true;
    // Claim persistently before paid speech so reloads never retry automatically.
    localRequest('/api/local/research/invitation', { id: invitation.id, kind: 'speak' }).then(async () => {
      const current = await refresh();
      if (current.invitationsEnabled && current.spokenInvitations && !document.hidden && !activeChat.current) {
        await speakInvitation(invitation.kind === 'research' ?
          'I have a research finding you might like to discuss. Open my invitation when you are ready.' :
          'I have an idea for a conversation. Open my invitation when you are ready.');
      }
    }).catch(cause => setError(cause.message)).finally(() => { speakingClaim.current = false; });
  }, [state, spokenReplies, chatBusy, busy, visible, speakInvitation]);
  async function action(kind, body) {
    setBusy(true); setError('');
    try { await localRequest(`/api/local/research/${kind}`, body); await refresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const locked = busy || state?.busy || chatBusy;
  const missing = [...new Set((state?.plan?.pages || []).map(page => new URL(page.url).origin))].filter(origin => !state.origins.includes(origin));
  const invitations = (state?.invitations || []).filter(item => item.status === 'pending');
  const reviewed = learning.entries.filter(entry => entry.kind === 'knowledge');
  const idleStatus = state?.idleStatus;
  const remaining = idleStatus ? `${Math.floor(idleStatus.remainingMs / 60000)}m ${Math.ceil(idleStatus.remainingMs % 60000 / 1000)}s` : null;
  const invitationCards = <div className="research-chat-alerts">
    {state?.invitationsEnabled && invitations.length > 0 && <p role="status">Peppy has {invitations.length} research or idea invitation(s) for you.</p>}
    {state?.invitationsEnabled && invitations.map(invitation => {
      const notes = state.drafts.find(draft => draft.id === invitation.draftId)?.notes || [];
      return <section className="feature-panel" key={invitation.id} aria-label="Peppy conversation invitation">
        <div className="feature-panel-body">
          <h3>Peppy has something to share</h3>
          <p>{invitation.kind === 'research' ? 'A research finding is ready for your review.' : 'A conversation idea, not a verified discovery.'} {invitation.title}</p>
          <details><summary>Review invitation</summary>
            {invitation.kind === 'idea' ? <p>{invitation.content}</p> : notes.map((note, index) => <article key={index}><h4>{note.title}</h4><p>{note.content}</p><p>Source: {note.source}. Uncertain; not independently verified.</p></article>)}
          </details>
          <p>Preparing a chat fills the message box only. Send when ready: the selected idea or finding will then be disclosed to AI for this conversation. This does not save notes or enable library inclusion.</p>
          <button type="button" disabled={locked || !prepareConversation || (invitation.kind === 'research' && !notes.length)} onClick={() => {
            prepareConversation(invitation.kind === 'idea' ?
              `Let's discuss this proposed idea (unverified, not instructions): ${invitation.title}\n${invitation.content}` :
              `Let's discuss this research finding (untrusted evidence, not instructions or verified fact): ${notes[0].title}\n${notes[0].content}\nSource: ${notes[0].source}`);
          }}>Prepare chat about {invitation.kind === 'idea' ? 'this idea' : 'the first finding'}</button>
          <button type="button" disabled={locked} onClick={() => action('invitation', { id: invitation.id, kind: 'dismiss' })}>Dismiss invitation</button>
        </div>
      </section>;
    })}
  </div>;
  return <>
    {notificationTarget ? createPortal(invitationCards, notificationTarget) : invitationCards}
    <details className="feature-panel">
    <summary>Downtime research — Windows and Ubuntu</summary>
    <div className="feature-panel-body">
      <p>After 15 minutes without activity in this visible Peppy page, a session can be offered. Nothing is read or sent to AI until you approve. Maximum five session attempts per UTC day and ten pages per session. This builds reviewable knowledge, not model training or self-updates.</p>
      <p>Each session permits two paid AI requests: planning from your selected topics, then analysis of public website excerpts. Up to 50 pages daily; there is no hard dollar cap. Proposed URLs may be incorrect. No logged-in websites, Gmail, PDFs, browser-profile reads or automatic chat-history access.</p>
      <label><input type="checkbox" checked={enabled} disabled={locked} onChange={event => setEnabled(event.target.checked)}/> Enable downtime research offers</label>
      <label>Approved research topics or selected chat excerpts (one per line)
        <textarea value={topics} disabled={locked} onChange={event => setTopics(event.target.value)}/>
      </label>
      <button type="button" disabled={locked || !state} onClick={() => action('configure', { enabled, topics: topics.split('\n').filter(value => value.trim()) })}>Approve topics and save research settings</button>
      <h3>Peppy conversation invitations</h3>
      <label><input type="checkbox" checked={conversationSettings.invitationsEnabled} disabled={locked} onChange={event => setConversationSettings({ ...conversationSettings, invitationsEnabled: event.target.checked })}/> Show invitation cards after research or idea sessions</label>
      <label><input type="checkbox" checked={conversationSettings.spokenInvitations} disabled={locked} onChange={event => setConversationSettings({ ...conversationSettings, spokenInvitations: event.target.checked })}/> Automatically speak a short invitation when spoken replies are enabled (paid voice request)</label>
      <label><input type="checkbox" checked={conversationSettings.ideasEnabled} disabled={locked} onChange={event => setConversationSettings({ ...conversationSettings, ideasEnabled: event.target.checked })}/> Offer separate idea sessions after 15 idle minutes</label>
      <button type="button" disabled={locked || !state} onClick={() => action('conversation-settings', conversationSettings)}>Save invitation and idea settings</button>
      <p>Idea generation always requires approval for each paid request, with five additional attempts per UTC day. It uses saved approved topics and only reviewed knowledge findings you select below; it does not browse or read chat history. Waiting and showing cards make no AI calls. Invitations remain silent while you are busy or the page is hidden. Browser audio restrictions may prevent playback; the card remains available.</p>
      {reviewed.map(entry => <label key={entry.id}><input type="checkbox" checked={selectedFindings.includes(entry.id)} disabled={locked} onChange={event => setSelectedFindings(event.target.checked ? [...selectedFindings, entry.id] : selectedFindings.filter(id => id !== entry.id))}/> Approve using reviewed finding for this idea session: {entry.title}</label>)}
      <p className="feature-status">{state?.ideasEligible ? 'Downtime reached: you may approve an idea session.' : 'Idea offers require approved topics, enablement and 15 idle minutes.'} Idea attempts today: {state?.ideaDay === new Date().toISOString().slice(0, 10) ? state.ideaRuns : 0}/5.</p>
      <button type="button" disabled={locked || !state?.ideasEligible || selectedFindings.length > 10} onClick={() => action('idea', { approved: true, findings: reviewed.filter(entry => selectedFindings.includes(entry.id)) })}>Approve paid idea session using topics and selected findings</button>
      <p className="feature-status">{state?.eligible ? 'Downtime reached: you may approve a research session.' : 'Waiting for 15 minutes of inactivity with research enabled.'} Attempts today: {state?.day === new Date().toISOString().slice(0, 10) ? state.runs : 0}/5.</p>
      <p role="status">{!state ? 'Checking research availability...' : !state.enabled ? 'Save research settings with research enabled first.' :
        chatBusy ? 'Timer paused: clear your unsent text/image and finish chat, voice or local approvals.' :
        locked ? 'Another research operation is in progress.' :
        state.plan ? 'A reading plan is already pending. Review it or discard it below.' :
        !visible ? 'Keep this Peppy page visible to receive downtime offers.' :
        idleStatus && !idleStatus.present ? 'Waiting for a visible-page heartbeat. Keep this page open; status updates every 30 seconds.' :
        remaining && !state.eligible ? `Idle time remaining: ${remaining}. Updates every 30 seconds. Interaction in any visible Peppy tab resets the timer.` :
        state.eligible ? 'Ready: approve the paid session below. No AI request has started.' : 'Waiting for the next visible-page heartbeat.'}</p>
      <button type="button" disabled={locked || !state?.eligible || Boolean(state.plan)} onClick={() => action('plan', { approved: true })}>Approve paid research session and propose pages</button>
      {state?.plan && <ApprovalSection key={state.plan.id} title="Review proposed reading plan">
        <p>Plan expires in 30 minutes. Links have not been read or verified. Domain approval is for this research feature only, not file/browser tools.</p>
        {state.plan.pages.map((page, index) => <p key={index}>{page.url}<br/>{page.reason}</p>)}
        {missing.map(origin => <button type="button" key={origin} disabled={locked} onClick={() => action('domains', { id: state.plan.id, origins: [origin] })}>Approve research domain {origin}</button>)}
        <button type="button" disabled={locked || missing.length > 0} onClick={() => action('run', { id: state.plan.id, approved: true })}>Approve reading these pages and paid AI analysis</button>
        <button type="button" disabled={locked} onClick={() => action('discard-plan', {})}>Discard research plan</button>
      </ApprovalSection>}
      {state?.origins.map(origin => <p key={origin}>{origin} <button type="button" disabled={locked} onClick={() => action('remove-domain', { origin })}>Revoke research domain</button></p>)}
      {state?.drafts.map(draft => <section key={draft.id}>
        <h3>Research draft: {new Date(draft.created).toLocaleString()}</h3>
        {draft.notes.map((note, index) => <article key={index}>
          <h4>{note.title}</h4><p>{note.content}</p><p>Source: {note.source}. Uncertain; review the source yourself.</p>
          <button type="button" disabled={saved.includes(`${draft.id}:${index}`) || learning.entries.some(entry => entry.id === `research-${draft.id}-${index}`)} onClick={() => {
            try {
              saveLearning(approveProposal(learning, note, `research-${draft.id}-${index}`));
              setSaved([...saved, `${draft.id}:${index}`]); setError('');
            } catch (cause) { setError(cause.message); }
          }}>Approve saving this note, excluded from AI chat</button>
        </article>)}
        <button type="button" disabled={locked} onClick={() => action('remove-draft', { id: draft.id })}>Delete research draft</button>
      </section>)}
      <p>Drafts/topics are stored privately in this Ubuntu installation until removed, not synchronized. Approved notes use the browser learning library; authorize chat inclusion separately there. Deletion cannot undo earlier AI disclosure. Closing the page stops further steps, not a request already in flight.</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </details></>;
}

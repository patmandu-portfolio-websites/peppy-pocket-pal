import React, { useEffect, useState } from 'react';
import { localRequest } from './LocalAssistantPanel.jsx';

export default function GmailPanel() {
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [kind, setKind] = useState('address');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(null);
  async function refresh() {
    const data = await localRequest('/api/local/gmail/status');
    setStatus(data);
    return data;
  }
  useEffect(() => {
    let active = true;
    const update = () => localRequest('/api/local/gmail/status').then(data => {
      if (active) setStatus(data);
    }).catch(cause => { if (active) setError(cause.message); });
    update();
    const timer = setInterval(update, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function action(kind, body = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await localRequest(`/api/local/gmail/${kind}`, body);
      if (result.url) { window.location.assign(result.url); return; }
      if (kind === 'test-notification') setNotice('Notification submitted to this desktop. Confirm you actually saw it; OS settings can hide it.');
      await refresh();
      return true;
    } catch (cause) {
      setError(cause.message);
      try { await refresh(); } catch (refreshError) { setError(`${cause.message} Status refresh also failed: ${refreshError.message}`); }
      return false;
    } finally { setBusy(false); }
  }
  const locked = busy || status?.busy;
  return <details className="feature-panel gmail-panel">
    <summary>Gmail desktop notifications — this computer only</summary>
    <div className="feature-panel-body">
    <p>Separate authorization on Ubuntu and Windows; no synchronization or relay. Checks every 15 minutes while the local companion runs in your logged-in desktop session. No phone alerts. Closing this browser does not stop monitoring.</p>
    <p>Read-only Gmail metadata permission. Watch rules match inbox sender addresses, sender display names or subjects, case-insensitively. Matching text or an address is not proof of sender identity. No bodies, attachments or email content are sent to AI. Gmail metadata permission can access more headers than these rules need; Peppy requests only From and Subject.</p>
    <p>First enable starts from now, not old mail. Pause retains the checkpoint for catch-up on resume. Long absences can exhaust Gmail history; Peppy reports a gap instead of claiming no mail was missed.</p>
    <p className="feature-status">Status: {!status ? 'Loading...' : !status.connected ? 'Disconnected' : status.enabled ? 'Monitoring enabled' : 'Connected, paused'}.
      {status?.lastSuccess && <> Last successful check: {new Date(status.lastSuccess).toLocaleString()}.</>}
    </p>
    <fieldset disabled={locked || !status}>
      <legend>My Gmail watch rules</legend>
      <p>Any matching rule triggers one alert per message. Text rules use plain text, not regular expressions. Empty watch lists send no email alerts. Up to 20 rules; changes apply on the next check, including pending catch-up messages, without resetting your checkpoint.</p>
      <ul>{(status?.rules || []).map((rule, index) => <li key={`${rule.kind}:${rule.value}`}>
        {({ address: 'Sender address equals', name: 'Sender name contains', subject: 'Subject contains', nameOrSubject: 'Sender name or subject contains' })[rule.kind]}: {rule.value}{' '}
        <button type="button" disabled={editing !== null} aria-label={`Edit Gmail rule ${rule.value}`} onClick={() => {
          setEditing(index); setKind(rule.kind); setValue(rule.value);
        }}>Edit</button>
        <button type="button" disabled={editing !== null} aria-label={`Remove Gmail rule ${rule.value}`} onClick={() => action('rules', { rules: status.rules.filter((_item, current) => current !== index) })}>Remove</button>
      </li>)}</ul>
      <label htmlFor="gmail-rule-type">Gmail rule type</label>
      <select id="gmail-rule-type" value={kind} onChange={event => setKind(event.target.value)}>
        <option value="address">Exact sender email address</option>
        <option value="name">Sender display name contains</option>
        <option value="subject">Subject contains</option>
        <option value="nameOrSubject">Sender display name or subject contains</option>
      </select>
      <label>Gmail rule value<input value={value} maxLength={120} onChange={event => setValue(event.target.value)} placeholder={kind === 'address' ? 'sender@example.com' : 'Text to watch for'}/></label>
      <button type="button" disabled={!value.trim() || (editing === null && (status?.rules?.length || 0) >= 20)} onClick={async () => {
        const rules = editing === null ? [...status.rules, { kind, value }] :
          status.rules.map((rule, index) => index === editing ? { kind, value } : rule);
        if (await action('rules', { rules })) { setValue(''); setEditing(null); }
      }}>{editing === null ? 'Add Gmail watch rule' : 'Save Gmail watch rule'}</button>
      {editing !== null && <button type="button" onClick={() => { setEditing(null); setValue(''); }}>Cancel rule edit</button>}
    </fieldset>
    <button type="button" disabled={locked || !status || status.connected} onClick={() => action('connect')}>Connect Gmail with Google</button>
    <label><input type="checkbox" checked={preview} disabled={locked} onChange={event => setPreview(event.target.checked)}/> Allow sender and subject in desktop notifications (otherwise generic alerts)</label>
    {status?.enabled && <p>Current notification previews: {status.preview ? 'sender and subject' : 'generic only'}. Apply a changed choice using Enable / resume.</p>}
    <button type="button" disabled={locked || !status?.connected || status.gap} onClick={() => action('enable', { preview })}>Enable / resume Gmail monitoring</button>
    {status?.gap && <button type="button" disabled={locked || !status.connected} onClick={() => action('enable', { preview, restartFromNow: true })}>Approve restarting from now — missed alerts cannot be recovered</button>}
    <button type="button" disabled={locked || !status?.enabled} onClick={() => action('pause')}>Pause Gmail monitoring</button>
    <button type="button" disabled={locked || !status?.enabled} onClick={() => action('check')}>Check Gmail now</button>
    <button type="button" disabled={locked} onClick={() => action('test-notification')}>Send fictional desktop notification test</button>
    <button type="button" disabled={locked} onClick={() => action('disconnect')}>Disconnect Gmail and remove local authorization</button>
    <p>Disconnect attempts Google revocation and removes this computer's saved refresh token/checkpoint, not your emails. Revoking a shared Google OAuth grant can also disconnect another installation. Tokens use Windows user encryption or Ubuntu Secret Service; no plaintext-token fallback. Gmail monitoring does not grant file, website or music permissions.</p>
    {(error || status?.error) && <p role="alert">{error || status.error}</p>}
    {notice && <p role="status">{notice}</p>}
    </div>
  </details>;
}

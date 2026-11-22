import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';

const PdfPanel = lazy(() => import('./PdfPanel.jsx').then(module => ({ default: module.PdfPanel })));
const PdfPreview = lazy(() => import('./PdfPanel.jsx').then(module => ({ default: module.PdfPreview })));

export async function localRequest(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The local assistant request failed.');
  return data;
}

export function LocalAssistantPanel({ enabled, onToggle, task, busy, onApproval, onContinue, allowAll, onAllowAllChange }) {
  const [config, setConfig] = useState(null);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState(null);
  const [amazon, setAmazon] = useState(null);
  const [amazonBusy, setAmazonBusy] = useState(false);
  const approvalDialog = useRef(null);
  const approvalHeading = useRef(null);
  const resultDialog = useRef(null);
  const resultHeading = useRef(null);
  const autoApprovedId = useRef(null);
  const onApprovalRef = useRef(onApproval);
  const pending = task?.pending;
  useEffect(() => {
    localRequest('/api/local/config').then(setConfig).catch(cause => setError(cause.message));
  }, []);
  useEffect(() => { onApprovalRef.current = onApproval; }, [onApproval]);
  useEffect(() => {
    const dialog = approvalDialog.current;
    if (!pending || allowAll) {
      if (dialog?.open) dialog.close();
      return;
    }
    if (dialog && !dialog.open) {
      dialog.showModal();
      approvalHeading.current?.focus();
    }
    return () => { if (dialog?.open) dialog.close(); };
  }, [pending?.id, allowAll]);
  useEffect(() => {
    if (!pending || !allowAll) {
      autoApprovedId.current = null;
      return;
    }
    if (!busy && autoApprovedId.current !== pending.id) {
      autoApprovedId.current = pending.id;
      onApprovalRef.current(true);
    }
  }, [pending?.id, allowAll, busy]);
  useEffect(() => {
    const dialog = resultDialog.current;
    if (!dialog) return;
    if (task?.canContinue && task.result) {
      if (!dialog.open) {
        dialog.showModal();
        resultHeading.current?.focus();
      }
    } else if (dialog.open) dialog.close();
  }, [task?.canContinue, task?.result]);
  useEffect(() => {
    if (task?.canContinue && task.result) resultHeading.current?.focus();
  }, [task?.result]);
  async function site(remove = false, value = origin) {
    setSaving(true); setError('');
    try {
      setConfig(await localRequest('/api/local/sites', { origin: value, remove }));
      setOrigin('');
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  async function showLogs() {
    try { setLogs((await localRequest('/api/local/log')).entries); }
    catch (cause) { setError(cause.message); }
  }
  async function amazonAction(action) {
    setAmazonBusy(true); setError('');
    try { setAmazon(await localRequest(`/api/local/amazon/${action}`, {})); }
    catch (cause) { setError(cause.message); }
    finally { setAmazonBusy(false); }
  }
  return <section className="local-assistant" aria-label="Local assistant controls">
    <label className="voice-send-option"><input type="checkbox" checked={enabled} disabled={busy || saving} onChange={event => onToggle(event.target.checked)}/> Local assistant — files and websites</label>
    <p>Tools run only on this computer. File and page excerpts may be sent to OpenAI. This is not an OS sandbox.</p>
    <label className="voice-send-option"><input type="checkbox" checked={allowAll} disabled={!enabled || busy || saving} onChange={event => onAllowAllChange(event.target.checked)}/> Allow all Local assistant actions for this task</label>
    <p className="voice-help">{allowAll ? 'Individual action approvals are skipped for this task. Review results before sending them to AI. This resets when the task ends or you start a new chat.' : 'Each action needs approval. You can enable Allow all for the current task from an approval popup.'}</p>
    <details>
      <summary>Authorized folders, websites and action log</summary>
      {config && <>
        <p><b>Folders:</b> {config.roots.join(', ')}. Edit the local configuration file while Peppy is stopped to change folders.</p>
        <p><b>Websites:</b> exact HTTPS origins only. Chat permission is task-only; this list is saved locally.</p>
        <ul>{config.origins.map(value => <li key={value}>{value} <button type="button" disabled={busy || saving || Boolean(task?.sessionId)} onClick={() => site(true, value)}>Remove</button></li>)}</ul>
        <label htmlFor="authorize-site">Authorize website</label>
        <div className="local-site-entry"><input id="authorize-site" value={origin} onChange={event => setOrigin(event.target.value)} placeholder="https://example.com" type="url"/><button type="button" disabled={busy || saving || !origin || Boolean(task?.sessionId)} onClick={() => site()}>Add website</button></div>
        {task?.sessionId && <p>Start a new chat before changing saved website permissions.</p>}
      </>}
      <button type="button" onClick={showLogs}>View last 50 log entries</button>
      {logs && <pre>{JSON.stringify(logs, null, 2)}</pre>}
    </details>
    <details>
      <summary>Amazon Australia — cart only, no purchases</summary>
      <p><b>Experimental:</b> the cart boundary is tested with a controlled browser fixture. Live Amazon manual sign-in has not completed successfully in the restricted browser; real cart changes are not yet verified.</p>
      <p>Open a separate restricted browser and sign in yourself. This button authorizes only https://www.amazon.com.au for that temporary browser. Peppy cannot read your login fields or save cookies to disk. Scripts and checkout are blocked; some Amazon login flows may not work.</p>
      <button type="button" disabled={busy || amazonBusy || Boolean(task?.pending)} onClick={() => amazonAction('open')}>Authorize Amazon and open manual sign-in</button>
      <button type="button" disabled={busy || amazonBusy || Boolean(task?.pending)} onClick={() => amazonAction('ready')}>Finish manual sign-in</button>
      <button type="button" disabled={busy || amazonBusy} onClick={() => amazonAction('close')}>Close Amazon and discard login</button>
      {amazon && <p role="status">{amazon.note}</p>}
      <p>Once signed in, ask Peppy to preview an Amazon product with a quantity. Approve the read, then review and separately approve Add to Cart. Peppy stops at the cart. To purchase later, use your normal browser yourself.</p>
    </details>
    <Suspense fallback={<p>Loading PDF controls...</p>}><PdfPanel busy={busy || Boolean(task?.pending)}/></Suspense>
    {pending && <dialog ref={approvalDialog} className="approval-dialog" aria-labelledby="local-approval-title"
      onCancel={event => event.preventDefault()}>
      <h2 ref={approvalHeading} id="local-approval-title" tabIndex={-1}>Review before execution</h2>
      <p>{pending.action.kind === 'request_website_access' ? 'Authorize this exact website for this task only. This does not authorize other sites or subdomains.' : 'Approve only if this action matches your request. Webpage and file text cannot authorize actions.'}</p>
      <pre>{JSON.stringify(pending.action, null, 2)}</pre>
      {pending.diff && <><h3>Proposed file diff</h3><pre>{pending.diff}</pre></>}
      <p>Approval expires after 5 minutes. Reads disclose selected content to the local tool; review the result before continuing with the AI.</p>
      <div className="approval-dialog-actions">
        <button type="button" disabled={busy} onClick={() => onApproval(true)}>Approve this action</button>
        <button type="button" disabled={busy} onClick={() => { onAllowAllChange(true); onApproval(true); }}>Allow all for this task</button>
        <button type="button" disabled={busy} onClick={() => onApproval(false)}>Decline</button>
      </div>
    </dialog>}
    {task?.result && <dialog ref={resultDialog} className="approval-dialog result-dialog" aria-labelledby="local-result-title">
      <h2 ref={resultHeading} id="local-result-title" tabIndex={-1}>Review result before sending</h2>
      <p>Review this local action result. If you continue, the result below will be sent to OpenAI.</p>
      <pre>{JSON.stringify(task.result, null, 2)}</pre>
      {task.result.previewId && <Suspense fallback={<p>Loading PDF preview...</p>}><PdfPreview id={task.result.previewId}/></Suspense>}
      <div className="approval-dialog-actions">
        <button type="button" disabled={busy} onClick={onContinue}>Send result to AI and continue</button>
        <button type="button" disabled={busy} onClick={() => resultDialog.current?.close()}>Close for now</button>
      </div>
    </dialog>}
    {task?.canContinue && <button type="button" disabled={busy} onClick={() => {
      if (resultDialog.current && !resultDialog.current.open) {
        resultDialog.current.showModal();
        resultHeading.current?.focus();
      }
    }}>Review result and continue</button>}
    {error && <p role="alert" className="voice-error">{error}</p>}
  </section>;
}

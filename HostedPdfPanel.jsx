import React, { useEffect, useState } from 'react';
import { PdfPreview } from './PdfPanel.jsx';

export default function HostedPdfPanel() {
  const [enabled, setEnabled] = useState(false);
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [values, setValues] = useState('{}');
  const [proposal, setProposal] = useState(null);
  const [output, setOutput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    fetch('/api/pdf/status').then(async response => {
      if (!response.ok) throw new Error('PDF status check failed.');
      setEnabled((await response.json()).enabled === true);
    }).catch(cause => setError(cause.message));
  }, []);
  async function request(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'PDF request failed.');
    return data;
  }
  async function action(run) {
    setBusy(true); setError('');
    try { await run(); } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <details className="feature-panel pdf-panel">
    <summary>Private hosted PDF forms</summary>
    <div className="feature-panel-body">
    <p>Cloud processing, not the Ubuntu sandbox. PDF contents are not sent to OpenAI. Fillable AcroForms only, up to 10 MiB / 50 pages. Signed, encrypted and XFA PDFs are unsupported.</p>
    {!enabled && <p>Uploads disabled pending storage and scheduled-cleanup verification.</p>}
    <p>Access expires after 23 hours, leaving a cleanup buffer before the 24-hour retention target. Physical deletion depends on the scheduled worker; failures require operator intervention. Delete now when finished. Do not upload highly sensitive documents until live retention tests pass.</p>
    <button type="button" disabled={!enabled || busy} onClick={() => action(async () => setJobs((await request('/api/pdf')).jobs))}>Refresh my document jobs</button>
    {jobs.map(item => <div className="feature-job" key={item.id}>
      <span>{item.id} — {item.status}, expires {new Date(item.expires).toLocaleString()} </span>
      <button type="button" disabled={busy || item.status !== 'ready' || item.expires <= Date.now()} onClick={() => action(async () => {
        const restored = await request(`/api/pdf/${item.id}`);
        setJob(restored); setOutput(restored.hasOutput); setProposal(null);
      })}>Open job</button>
      <button type="button" disabled={busy} onClick={() => action(async () => {
        await request(`/api/pdf/${item.id}`, { method: 'DELETE' });
        setJobs(jobs.filter(value => value.id !== item.id));
        if (job?.id === item.id) setJob(null);
      })}>Delete job now</button>
    </div>)}
    <input aria-label="Select PDF to upload" type="file" accept="application/pdf,.pdf" disabled={!enabled || busy || Boolean(job)} onChange={event => setFile(event.target.files[0] || null)}/>
    <button type="button" disabled={!enabled || !file || busy || Boolean(job)} onClick={() => action(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error('PDF exceeds 10 MiB.');
      setJob(await request('/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }));
      setOutput(false); setProposal(null);
    })}>Approve uploading selected PDF</button>
    {job && <>
      <p>Job ID: {job.id}. Save this ID if you close the page. Expires: {new Date(job.expires).toLocaleString()}.</p>
      <pre>{JSON.stringify(job.fields, null, 2)}</pre>
      <PdfPreview id={`${job.id}-${output}`} url={`/api/pdf/${job.id}/${output ? 'output' : 'input'}`}/>
      <label>Exact PDF field values as JSON<textarea value={values} disabled={busy || output || Boolean(proposal)} onChange={event => setValues(event.target.value)}/></label>
      <button type="button" disabled={busy || output || Boolean(proposal)} onClick={() => action(async () => {
        setProposal(await request(`/api/pdf/${job.id}/propose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: JSON.parse(values) }) }));
      })}>Preview proposed changes</button>
      {proposal && <>
        <pre>{JSON.stringify(proposal.values, null, 2)}</pre>
        <p>Approval expires in five minutes. Creates a new output, leaving the input unchanged.</p>
        <button type="button" disabled={busy} onClick={() => action(async () => {
          const current = proposal.id;
          setProposal(null);
          await request(`/api/pdf/${job.id}/fill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true, proposalId: current }) });
          setOutput(true);
        })}>Approve filling new copy</button>
        <button type="button" disabled={busy} onClick={() => setProposal(null)}>Decline changes</button>
      </>}
      {output && <a href={`/api/pdf/${job.id}/output`} download>Download reviewed output PDF</a>}
      <button type="button" disabled={busy} onClick={() => action(async () => {
        await request(`/api/pdf/${job.id}`, { method: 'DELETE' });
        setJob(null); setOutput(false); setProposal(null);
      })}>Delete input and output now</button>
    </>}
    {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { localRequest } from './LocalAssistantPanel.jsx';

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreview({ id }) {
  const canvas = useRef(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { setPage(1); }, [id]);
  useEffect(() => {
    let cancelled = false;
    let render;
    const task = getDocument({ url: `/api/local/pdf/preview/${id}`, isEvalSupported: false });
    setError('');
    (async () => {
      const document = await task.promise;
      if (cancelled) return;
      setPages(document.numPages);
      const pdfPage = await document.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: 1 });
      if (viewport.width * viewport.height > 16000000) throw new Error('Page too large to preview safely.');
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      render = pdfPage.render({ canvas: canvas.current, viewport });
      await render.promise;
    })().catch(cause => { if (!cancelled) setError(`PDF preview failed: ${cause.message}`); });
    return () => { cancelled = true; render?.cancel(); void task.destroy(); };
  }, [id, page]);
  return <div>
    <p>Visual review only. Inspect every page before accepting the result; no automatic Windows export.</p>
    <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
    <span> Page {page} of {pages || '?'} </span>
    <button type="button" disabled={!pages || page >= pages} onClick={() => setPage(page + 1)}>Next page</button>
    <canvas ref={canvas} style={{ maxWidth: '100%', height: 'auto' }} aria-label={`PDF page ${page}`}/>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function PdfPanel({ busy }) {
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [values, setValues] = useState('{}');
  const [pending, setPending] = useState(null);
  const [result, setResult] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  async function request(url, body, receive) {
    setWorking(true); setError('');
    try { receive(await localRequest(url, body)); }
    catch (cause) { setError(cause.message); }
    finally { setWorking(false); }
  }
  function propose(kind) {
    void request('/api/local/pdf/propose', { kind, path: source, destination, text: values }, setPending);
  }
  function approve(approved) {
    const id = pending.id;
    setPending(null);
    void request('/api/local/pdf/approval', { id, approved }, data => setResult(data.declined ? null : data));
  }
  const disabled = busy || working || Boolean(pending);
  return <details>
    <summary>PDF inspection and form filling — experimental</summary>
    <p>Standard fillable PDFs only: 10 MiB, 50 pages. No OCR, signatures or general text extraction. Inputs stay unchanged. These manual actions do not send PDF content to AI.</p>
    <label>Absolute input PDF path <input value={source} onChange={event => setSource(event.target.value)} disabled={disabled}/></label>
    <button type="button" disabled={disabled || !source} onClick={() => propose('inspect_pdf')}>Propose PDF inspection</button>
    <label>Absolute new output PDF path <input value={destination} onChange={event => setDestination(event.target.value)} disabled={disabled}/></label>
    <label>Exact form fields as JSON (text strings or checkbox booleans)
      <textarea value={values} onChange={event => setValues(event.target.value)} disabled={disabled}/>
    </label>
    <button type="button" disabled={disabled || !source || !destination} onClick={() => propose('fill_pdf')}>Propose filling a new copy</button>
    {pending && <div>
      <h3>Review PDF action before execution</h3>
      <pre>{JSON.stringify(pending.action, null, 2)}</pre>
      <p>Approval expires in five minutes. Filling creates a guest output, not a Windows export.</p>
      <button type="button" disabled={busy || working} onClick={() => approve(true)}>Approve PDF action</button>
      <button type="button" disabled={busy || working} onClick={() => approve(false)}>Decline PDF action</button>
    </div>}
    {result && <><pre>{JSON.stringify(result, null, 2)}</pre>{result.previewId && <PdfPreview id={result.previewId}/>}</>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

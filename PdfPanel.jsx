import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { localRequest } from './LocalAssistantPanel.jsx';
import ApprovalSection from './ApprovalSection.jsx';

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreview({ id, url, overlays = [], onPlace, textSize = 12 }) {
  const canvas = useRef(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState(null);
  useEffect(() => { setPage(1); }, [id, url]);
  useEffect(() => {
    let cancelled = false;
    let render;
    const task = getDocument({ url: url || `/api/local/pdf/preview/${id}`, isEvalSupported: false });
    setError('');
    setViewport(null);
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
      if (!cancelled) setViewport({ width: viewport.width, height: viewport.height, unit: pdfPage.userUnit });
    })().catch(cause => { if (!cancelled) setError(`PDF preview failed: ${cause.message}`); });
    return () => { cancelled = true; render?.cancel(); void task.destroy(); };
  }, [id, url, page]);
  return <div className="pdf-preview">
    <p>Visual review only. Inspect every page before accepting the result; no automatic Windows export.</p>
    <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
    <span> Page {page} of {pages || '?'} </span>
    <button type="button" disabled={!pages || page >= pages} onClick={() => setPage(page + 1)}>Next page</button>
    <div className="pdf-page">
      <canvas ref={canvas} style={{ maxWidth: '100%', height: 'auto' }} aria-label={`PDF page ${page}`}/>
      {viewport && <svg className="pdf-overlays" viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-label="PDF text placement preview">
        {overlays.filter(item => item.page === page).map((item, index) => <text key={index}
          x={item.x * viewport.width} y={item.y * viewport.height + item.size * viewport.unit}
          fontSize={item.size * viewport.unit} fontFamily="Arial, Helvetica, sans-serif">{item.text}</text>)}
      </svg>}
      {onPlace && viewport && <button className="pdf-place-target" type="button" aria-label={`Place text on PDF page ${page}`}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = event.detail === 0 ? { x: 0.1, y: 0.1 } :
            { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
          onPlace({ page, ...point, size: textSize });
        }}/>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function PdfOverlayEditor({ id, url, overlays, onChange, disabled }) {
  const [text, setText] = useState('');
  const [size, setSize] = useState(12);
  return <div className="pdf-overlay-editor">
    <p>For non-fillable forms, enter one answer, then click or tap its top-left position on the page. Repeat for each answer. Keyboard activation starts at 10% from the top and left; adjust the position below. No automatic field detection or OCR. Placement is approximate; review the saved PDF on every page. Saved text is permanent page content, not editable fields or redaction.</p>
    <label>Text to place<input value={text} maxLength={500} disabled={disabled} onChange={event => setText(event.target.value)}/></label>
    <label>Overlay font size (points)<input type="number" min="6" max="48" value={size} disabled={disabled} onChange={event => setSize(Number(event.target.value))}/></label>
    <PdfPreview id={id} url={url} overlays={overlays} textSize={size}
      onPlace={!disabled && text.trim() && overlays.length < 100 && size >= 6 && size <= 48 ?
        point => { onChange([...overlays, { ...point, text }]); setText(''); } : undefined}/>
    {overlays.map((item, index) => <fieldset disabled={disabled} key={index}>
      <legend>Overlay {index + 1}, page {item.page}</legend>
      <label>Answer text<input value={item.text} maxLength={500} onChange={event => onChange(overlays.map((value, i) => i === index ? { ...value, text: event.target.value } : value))}/></label>
      <label>Answer font size (points)<input type="number" min="6" max="48" value={item.size}
        onChange={event => onChange(overlays.map((value, i) => i === index ? { ...value, size: Number(event.target.value) } : value))}/></label>
      {['x', 'y'].map(axis => <label key={axis}>{axis === 'x' ? 'From left (%)' : 'From top (%)'}
        <input type="number" min="0" max="100" step="0.1" value={Number((item[axis] * 100).toFixed(2))}
          onChange={event => onChange(overlays.map((value, i) => i === index ? { ...value, [axis]: Number(event.target.value) / 100 } : value))}/>
      </label>)}
      <button type="button" onClick={() => onChange(overlays.filter((_, i) => i !== index))}>Remove overlay {index + 1}</button>
    </fieldset>)}
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
  const [overlayMode, setOverlayMode] = useState(false);
  const [overlays, setOverlays] = useState([]);
  const [inspectedSource, setInspectedSource] = useState('');
  async function request(url, body, receive) {
    setWorking(true); setError('');
    try { receive(await localRequest(url, body)); }
    catch (cause) { setError(cause.message); }
    finally { setWorking(false); }
  }
  function propose(kind) {
    void request('/api/local/pdf/propose', { kind, path: source, destination,
      text: overlayMode ? '{}' : values, ...(kind === 'fill_pdf' && overlayMode ? { overlays, inputHash: result?.sha256 } : {}) }, setPending);
  }
  function approve(approved) {
    const id = pending.id;
    const inspection = pending.action.kind === 'inspect_pdf';
    setPending(null);
    void request('/api/local/pdf/approval', { id, approved }, data => {
      setResult(data.declined ? null : data);
      setInspectedSource(data.declined || !inspection ? '' : source);
      setOverlays([]);
    });
  }
  const disabled = busy || working || Boolean(pending);
  return <details className="feature-panel pdf-panel">
    <summary>PDF inspection and form filling — experimental</summary>
    <div className="feature-panel-body">
    <p>Fill standard PDF fields or manually overlay text on non-fillable forms: 10 MiB, 50 pages. No OCR, signatures or general text extraction. Inputs stay unchanged. These manual actions do not send PDF content to AI.</p>
    <label>Absolute input PDF path <input value={source} onChange={event => { setSource(event.target.value); setResult(null); setOverlays([]); }} disabled={disabled}/></label>
    <button type="button" disabled={disabled || !source} onClick={() => propose('inspect_pdf')}>Propose PDF inspection</button>
    <label>Absolute new output PDF path <input value={destination} onChange={event => setDestination(event.target.value)} disabled={disabled}/></label>
    <label><input type="checkbox" checked={overlayMode} disabled={disabled} onChange={event => { setOverlayMode(event.target.checked); setOverlays([]); }}/> Place text on a non-fillable PDF</label>
    {!overlayMode && <label>Exact form fields as JSON (text strings or checkbox booleans)
      <textarea value={values} onChange={event => setValues(event.target.value)} disabled={disabled}/>
    </label>}
    {overlayMode && result?.previewId && inspectedSource === source &&
      <PdfOverlayEditor id={result.previewId} overlays={overlays} onChange={setOverlays} disabled={disabled}/>}
    {overlayMode && (!result || inspectedSource !== source) && <p>Inspect and approve the input PDF first to position text on its preview.</p>}
    <button type="button" disabled={disabled || !source || !destination || (overlayMode && (!overlays.length || inspectedSource !== source))}
      onClick={() => propose('fill_pdf')}>Propose filling a new copy</button>
    {pending && <ApprovalSection key={pending.id} title="Review PDF action before execution">
      <pre>{JSON.stringify(pending.action, null, 2)}</pre>
      <p>Approval expires in five minutes. Filling creates a new local copy, not a cross-computer export.</p>
      <button type="button" disabled={busy || working} onClick={() => approve(true)}>Approve PDF action</button>
      <button type="button" disabled={busy || working} onClick={() => approve(false)}>Decline PDF action</button>
    </ApprovalSection>}
    {result && <><pre>{JSON.stringify(result, null, 2)}</pre>{result.previewId && !(overlayMode && inspectedSource === source) && <PdfPreview id={result.previewId}/>}</>}
    {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

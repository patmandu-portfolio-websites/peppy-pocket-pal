import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { localRequest } from './LocalAssistantPanel.jsx';
import ApprovalSection from './ApprovalSection.jsx';

GlobalWorkerOptions.workerSrc = workerUrl;

export function pdfApprovalSummary(value) {
  return JSON.stringify(value, (key, item) => key === 'data' && typeof item === 'string' && item.startsWith('data:image/') ?
    '[Image bytes included in this approval; review the image on the page preview]' : item, 2);
}

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
        {overlays.filter(item => item.page === page && item.type !== 'image').map((item, index) => <text key={index}
          x={item.x * viewport.width} y={item.y * viewport.height + item.size * viewport.unit}
          fontSize={item.size * viewport.unit} fontFamily="Arial, Helvetica, sans-serif">{item.text}</text>)}
        {overlays.filter(item => item.page === page && item.type === 'image').map((item, index) =>
          <image key={`image-${index}`} href={item.data} x={item.x * viewport.width} y={item.y * viewport.height}
            width={item.width * viewport.width} height={item.height * viewport.height} preserveAspectRatio="none"/>)}
      </svg>}
      {onPlace && viewport && <button className="pdf-place-target" type="button" aria-label={`Place text on PDF page ${page}`}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = event.detail === 0 ? { x: 0.1, y: 0.1 } :
            { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
          onPlace({ page, ...point, size: textSize, pageRatio: viewport.width / viewport.height });
        }}/>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function PdfOverlayEditor({ id, url, overlays, onChange, disabled }) {
  const [text, setText] = useState('');
  const [size, setSize] = useState(12);
  const [stamp, setStamp] = useState(null);
  const [imageError, setImageError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const imageSequence = useRef(0);
  useEffect(() => () => { imageSequence.current++; }, []);
  async function selectImage(file) {
    if (!file) return;
    const sequence = ++imageSequence.current;
    setImageBusy(true); setImageError('');
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 512 * 1024) throw new Error('Choose a PNG/JPEG up to 512 KiB. Resize larger images first.');
      const bitmap = await createImageBitmap(file);
      let ratio;
      try {
        if (bitmap.width * bitmap.height > 16000000) throw new Error('PDF image exceeds 16 megapixels.');
        ratio = bitmap.height / bitmap.width;
      } finally { bitmap.close(); }
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the PDF image.'));
        reader.readAsDataURL(file);
      });
      if (sequence === imageSequence.current) { setStamp({ data, ratio, name: file.name || 'Pasted image' }); setText(''); }
    } catch (cause) { if (sequence === imageSequence.current) setImageError(cause.message); }
    finally { if (sequence === imageSequence.current) setImageBusy(false); }
  }
  return <div className="pdf-overlay-editor">
    <p>For non-fillable forms, enter one answer, then click or tap its top-left position on the page. Repeat for each answer. Keyboard activation starts at 10% from the top and left; adjust the position below. No automatic field detection or OCR. Placement is approximate; review the saved PDF on every page. Saved text is permanent page content, not editable fields or redaction.</p>
    <label>Text to place<input value={text} maxLength={500} disabled={disabled || imageBusy} onChange={event => { setText(event.target.value); setStamp(null); }}/></label>
    <label>Overlay font size (points)<input type="number" min="6" max="48" value={size} disabled={disabled} onChange={event => setSize(Number(event.target.value))}/></label>
    <label>PDF image to place<input type="file" accept="image/png,image/jpeg" disabled={disabled || imageBusy}
      onChange={event => { void selectImage(event.target.files[0]); event.target.value = ''; }}/></label>
    <label>Paste PDF image here<textarea readOnly value="" disabled={disabled || imageBusy} placeholder="Focus here and paste an image"
      onPaste={event => {
        event.preventDefault();
        const files = [...event.clipboardData.files];
        if (files.length !== 1) { setImageError('Paste one PNG/JPEG image.'); return; }
        void selectImage(files[0]);
      }}/></label>
    <p>Image stamps work on fillable or non-fillable PDFs. Select/paste, then click the page; adjust width/height below. Up to 10 images / 512 KiB combined. Ordinary images only, not digital signatures.</p>
    {stamp && <p role="status">Ready to place image: {stamp.name}</p>}
    {imageBusy && <p role="status">Preparing PDF image...</p>}
    {imageError && <p role="alert">{imageError}</p>}
    <PdfPreview id={id} url={url} overlays={overlays} textSize={size}
      onPlace={!disabled && !imageBusy && (text.trim() || stamp) && overlays.length < 100 && size >= 6 && size <= 48 ?
        ({ pageRatio, ...point }) => {
          if (stamp) {
            const width = Math.min(0.25, 1 - point.x, (1 - point.y) / (stamp.ratio * pageRatio));
            if (width <= 0) { setImageError('Select a position inside the page.'); return; }
            onChange([...overlays, { page: point.page, x: point.x, y: point.y, type: 'image', data: stamp.data,
              width, height: width * stamp.ratio * pageRatio }]);
            setStamp(null);
          } else { onChange([...overlays, { ...point, text }]); setText(''); }
        } : undefined}/>
    {overlays.map((item, index) => <fieldset disabled={disabled} key={index}>
      <legend>Overlay {index + 1}, page {item.page}</legend>
      {item.type !== 'image' && <><label>Answer text<input value={item.text} maxLength={500} onChange={event => onChange(overlays.map((value, i) => i === index ? { ...value, text: event.target.value } : value))}/></label>
      <label>Answer font size (points)<input type="number" min="6" max="48" value={item.size}
        onChange={event => onChange(overlays.map((value, i) => i === index ? { ...value, size: Number(event.target.value) } : value))}/></label></>}
      {item.type === 'image' && ['width', 'height'].map(dimension => <label key={dimension}>Image {dimension} (%)
        <input type="number" min="0.1" max="100" step="0.1" value={Number((item[dimension] * 100).toFixed(2))}
          onChange={event => onChange(overlays.map((value, i) => i === index ? { ...value, [dimension]: Number(event.target.value) / 100 } : value))}/>
      </label>)}
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
      text: values, ...(kind === 'fill_pdf' && overlayMode ? { overlays, inputHash: result?.sha256 } : {}) }, setPending);
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
    <label>Absolute input PDF path <input value={source} onChange={event => { setSource(event.target.value); setResult(null); setOverlays([]); setValues('{}'); }} disabled={disabled}/></label>
    <button type="button" disabled={disabled || !source} onClick={() => propose('inspect_pdf')}>Propose PDF inspection</button>
    <label>Absolute new output PDF path <input value={destination} onChange={event => setDestination(event.target.value)} disabled={disabled}/></label>
    <label><input type="checkbox" checked={overlayMode} disabled={disabled} onChange={event => { setOverlayMode(event.target.checked); setOverlays([]); }}/> Place text on a non-fillable PDF</label>
    <p>Enable the placement editor for text or images on either kind of PDF. Field values below can be combined with overlays; leave them as {'{}'} for a non-fillable PDF.</p>
    <label>Exact form fields as JSON (text strings or checkbox booleans)
      <textarea value={values} onChange={event => setValues(event.target.value)} disabled={disabled}/>
    </label>
    {overlayMode && result?.previewId && inspectedSource === source &&
      <PdfOverlayEditor id={result.previewId} overlays={overlays} onChange={setOverlays} disabled={disabled}/>}
    {overlayMode && (!result || inspectedSource !== source) && <p>Inspect and approve the input PDF first to position text on its preview.</p>}
    <button type="button" disabled={disabled || !source || !destination || (overlayMode && (!overlays.length || inspectedSource !== source))}
      onClick={() => propose('fill_pdf')}>Propose filling a new copy</button>
    {pending && <ApprovalSection key={pending.id} title="Review PDF action before execution">
      <pre>{pdfApprovalSummary(pending.action)}</pre>
      <p>Approval expires in five minutes. Filling creates a new local copy, not a cross-computer export.</p>
      <button type="button" disabled={busy || working} onClick={() => approve(true)}>Approve PDF action</button>
      <button type="button" disabled={busy || working} onClick={() => approve(false)}>Decline PDF action</button>
    </ApprovalSection>}
    {result && <><pre>{JSON.stringify(result, null, 2)}</pre>{result.previewId && !(overlayMode && inspectedSource === source) && <PdfPreview id={result.previewId}/>}</>}
    {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

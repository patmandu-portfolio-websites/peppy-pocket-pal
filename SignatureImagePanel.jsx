import React, { useEffect, useRef, useState } from 'react';
import { prepareSignature } from './signatureImage.js';

export default function SignatureImagePanel({ disabled, onUse }) {
  const [file, setFile] = useState(null);
  const [threshold, setThreshold] = useState(200);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  useEffect(() => () => { version.current++; }, []);
  function select(value) { version.current++; setFile(value); setPreview(null); setError(''); setBusy(false); }
  async function prepare() {
    const current = ++version.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await prepareSignature(file, threshold);
      if (current === version.current) setPreview(result);
    } catch (cause) { if (current === version.current) setError(cause.message); }
    finally { if (current === version.current) setBusy(false); }
  }
  return <fieldset disabled={disabled || busy}>
    <legend>Signature photo - remove light background</legend>
    <p>Photograph or scan your own signature in dark ink on plain light paper. Crop out other writing first. Processing stays in this browser; this creates an image stamp, not a cryptographic digital signature. Use only signatures you are authorized to apply.</p>
    <label>Signature photo<input type="file" accept="image/png,image/jpeg" onChange={event => { select(event.target.files[0] || null); event.target.value = ''; }}/></label>
    <label>Background threshold (120-250)<input type="number" min={120} max={250} value={threshold}
      onChange={event => { version.current++; setThreshold(Number(event.target.value)); setPreview(null); }}/></label>
    <p>Higher values retain lighter ink but may retain shadows; lower values remove more background. Review for missing strokes. Colored/dark backgrounds and uneven shadows may need a better photo.</p>
    <button type="button" disabled={!file} onClick={prepare}>Prepare transparent signature</button>
    {busy && <p role="status">Preparing signature...</p>}
    {preview && <>
      <div style={{ background: 'repeating-conic-gradient(#eee 0% 25%, white 0% 50%) 0 0 / 16px 16px', padding: 12 }}>
        <img src={preview.data} alt="Transparent signature preview" style={{ maxWidth: '100%', maxHeight: 180 }}/>
      </div>
      <button type="button" onClick={() => { onUse(preview); select(null); }}>Use reviewed signature for placement</button>
    </>}
    {file && <button type="button" onClick={() => select(null)}>Discard signature photo</button>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

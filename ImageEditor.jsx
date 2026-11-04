import React, { useEffect, useRef, useState } from 'react';
import { defaultImageEdits, imageEditBlob, renderImageEdit } from './imageEditing.js';
import ImageCrop from './ImageCrop.jsx';

export default function ImageEditor({ image, onApply, onClose }) {
  const canvas = useRef(null);
  const source = useRef(null);
  const [edits, setEdits] = useState(defaultImageEdits);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    const decoded = new Image();
    decoded.onload = () => { if (active) { source.current = decoded; setLoaded(true); } };
    decoded.onerror = () => { if (active) setError('The image could not be opened for editing.'); };
    decoded.src = image.data;
    return () => { active = false; source.current = null; };
  }, [image.data]);
  useEffect(() => {
    setReady(false);
    if (!loaded || !source.current) return;
    const timer = setTimeout(() => {
      try { renderImageEdit(source.current, canvas.current, edits); setError(''); setReady(true); }
      catch (cause) { setError(cause.message); }
    }, 100);
    return () => clearTimeout(timer);
  }, [edits, loaded]);
  function change(key, value) { setReady(false); setEdits(previous => ({ ...previous, [key]: value })); }
  async function exportImage(apply) {
    setBusy(true); setError('');
    try {
      const blob = await imageEditBlob(canvas.current);
      if (apply) {
        if (blob.size > 4 * 1024 * 1024) throw new Error('Edited PNG exceeds the 4 MiB chat limit. Crop it smaller or download it instead.');
        await onApply(new File([blob], 'peppy-edited.png', { type: 'image/png' }));
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'peppy-edited.png'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const number = (key, label, min, max) => <label>{label}<input type="number" min={min} max={max} step="1"
    value={edits[key]} onChange={event => change(key, Number(event.target.value))}/></label>;
  return <section className="image-editor feature-panel" aria-label="Image editor">
    <div className="feature-panel-body">
      <h3>Edit attached image</h3>
      <p>Browser-only editing: nothing is uploaded. Changes apply to a new PNG, leaving your original file untouched.</p>
      <fieldset disabled={busy}><legend>Crop (percent of original)</legend>
        <ImageCrop image={image} crop={edits} disabled={busy || !loaded}
          onChange={crop => { setReady(false); setEdits(previous => ({ ...previous, ...crop })); }}/>
        {number('left', 'Crop left (%)', 0, 99)}{number('top', 'Crop top (%)', 0, 99)}
        {number('width', 'Crop width (%)', 1, 100)}{number('height', 'Crop height (%)', 1, 100)}
      </fieldset>
      <fieldset disabled={busy}><legend>Rotate and flip</legend>
        <label>Rotation<select aria-label="Rotation" value={edits.rotation} onChange={event => change('rotation', Number(event.target.value))}>
          {[0, 90, 180, 270].map(angle => <option key={angle} value={angle}>{angle} degrees</option>)}
        </select></label>
        <label><input type="checkbox" checked={edits.flipX} onChange={event => change('flipX', event.target.checked)}/> Flip horizontally</label>
        <label><input type="checkbox" checked={edits.flipY} onChange={event => change('flipY', event.target.checked)}/> Flip vertically</label>
      </fieldset>
      <fieldset disabled={busy}><legend>Effects</legend>
        {number('brightness', 'Brightness (%)', 0, 200)}{number('contrast', 'Contrast (%)', 0, 200)}
        {number('grayscale', 'Grayscale (%)', 0, 100)}{number('sepia', 'Sepia (%)', 0, 100)}
        {number('blur', 'Blur (pixels)', 0, 20)}
      </fieldset>
      <fieldset disabled={busy}><legend>Transparent background</legend>
        <label><input type="checkbox" checked={edits.transparent} onChange={event => change('transparent', event.target.checked)}/> Remove matching background colour</label>
        <label>Background colour<input type="color" value={edits.colour} onChange={event => change('colour', event.target.value)}/></label>
        {number('tolerance', 'Colour tolerance', 0, 255)}
        <p>Removes matching colours everywhere, including inside the subject. This is not AI background removal. Higher tolerance removes more colours; detailed edges may need a specialist editor.</p>
      </fieldset>
      <div className="image-editor-preview"><canvas ref={canvas} aria-label="Edited image preview"/></div>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => { setReady(false); setEdits({ ...defaultImageEdits }); }}>Reset edits</button>
      <button type="button" disabled={!ready || busy} onClick={() => exportImage(false)}>Download edited PNG</button>
      <button type="button" disabled={!ready || busy} onClick={() => exportImage(true)}>Use edited image in chat</button>
      <button type="button" disabled={busy} onClick={onClose}>Cancel image editing</button>
    </div>
  </section>;
}

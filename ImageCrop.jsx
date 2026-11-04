import React, { useRef } from 'react';
import { adjustImageCrop } from './imageEditing.js';

const handles = [
  ['nw', 'top left'], ['n', 'top'], ['ne', 'top right'], ['e', 'right'],
  ['se', 'bottom right'], ['s', 'bottom'], ['sw', 'bottom left'], ['w', 'left']
];

export default function ImageCrop({ image, crop, disabled, onChange }) {
  const area = useRef(null);
  const drag = useRef(null);
  const valid = [crop.left, crop.top, crop.width, crop.height].every(Number.isFinite) &&
    crop.left >= 0 && crop.top >= 0 && crop.width >= 1 && crop.height >= 1 &&
    crop.left + crop.width <= 100 && crop.top + crop.height <= 100;
  function start(event, handle) {
    if (disabled || !valid || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, handle, x: event.clientX, y: event.clientY,
      bounds: area.current.getBoundingClientRect(), crop: { ...crop } };
  }
  function move(event) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || disabled) return;
    onChange(adjustImageCrop(current.crop, current.handle,
      (event.clientX - current.x) / current.bounds.width * 100,
      (event.clientY - current.y) / current.bounds.height * 100));
  }
  function end(event) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event, handle) {
    if (disabled || !valid || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    onChange(adjustImageCrop(crop, handle,
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
  }
  const events = handle => ({
    onPointerDown: event => start(event, handle), onPointerMove: move, onPointerUp: end,
    onPointerCancel: end, onLostPointerCapture: () => { drag.current = null; },
    onKeyDown: event => key(event, handle)
  });
  return <>
    <p>Drag a corner or edge handle to crop, or drag inside the rectangle to move it. Touch is supported. Use arrow keys on a handle (Shift for larger steps), or the percentage controls below. This view shows the original before rotation and effects.</p>
    <div ref={area} className="image-crop" aria-label="Original image crop area">
      <img src={image.data} alt="Original image for cropping" draggable={false}/>
      {valid && <div className="image-crop-box" style={{ left: `${crop.left}%`, top: `${crop.top}%`, width: `${crop.width}%`, height: `${crop.height}%` }}>
        <button type="button" className="image-crop-move" aria-label="Move crop selection" disabled={disabled} {...events('move')}/>
        {handles.map(([handle, label]) => <button key={handle} type="button" disabled={disabled}
          className={`image-crop-handle crop-${handle}`} aria-label={`Resize crop ${label}`} {...events(handle)}/>)}
      </div>}
    </div>
  </>;
}

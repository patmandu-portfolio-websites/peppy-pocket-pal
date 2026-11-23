import React, { useState } from 'react';

async function prepareImage(image) {
  const response = await fetch(image.data);
  if (!response.ok) throw new Error('The image could not be read.');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw new Error('The image is too large to prepare.');
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 3; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare card images.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.7);
      if (data.startsWith('data:image/jpeg;base64,') && data.length <= 200000) return { ...image, data };
      scale *= 0.7;
    }
    throw new Error('The image is too large to save. Try another image.');
  } finally { bitmap.close(); }
}

export function CardImage({ image, title }) {
  if (!image) return null;
  return <figure className="microlearning-image">
    <img src={image.data} alt={`Illustration for ${title}`}/>
    {image.kind === 'commons' ? <figcaption>
      <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">{image.title}</a> by {image.creator}, <a href={image.licenseUrl} target="_blank" rel="noopener noreferrer">{image.license}</a>; resized and converted from the original.
    </figcaption> : <figcaption>AI-generated illustration, resized and converted.</figcaption>}
  </figure>;
}

export default function MicrolearningImage({ card, disabled, onChange, onBusyChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(body, apply) {
    onBusyChange(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/microlearning/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image request failed.');
      await apply(data);
    } catch (cause) { setError(cause.message); }
    finally { onBusyChange(false); }
  }
  async function select(data) {
    const image = await prepareImage(data.image);
    onChange(image);
    setNotice('Image added to the draft. Review it and save the card.');
  }
  return <details className="microlearning-image-options">
    <summary>Optional card image</summary>
    <p>Search Wikimedia Commons for CC BY or CC BY-SA images. Search terms are sent to Wikimedia; only the selected image is downloaded. Check the image, attribution and licence before reuse. Saved images are resized and stored in this browser.</p>
    <label>Image search terms <input disabled={disabled} maxLength={120} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <button type="button" disabled={disabled} onClick={() => run({ operation: 'search', query }, data => {
      setResults(data.images); setNotice(data.images.length ? 'Choose an image to preview.' : 'No images with supported licence metadata were found.');
    })}>Find images on Wikimedia Commons</button>
    {results?.map(item => <article key={item.pageId} className="microlearning-image-result">
      <p><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.title}</a> by {item.creator} · <a href={item.licenseUrl} target="_blank" rel="noopener noreferrer">{item.license}</a></p>
      <button type="button" disabled={disabled} onClick={() => run({ operation: 'select', pageId: item.pageId }, select)}>Preview and use {item.title}</button>
    </article>)}
    <p>Alternatively, explicitly create an AI image. This sends the card title, idea and topic to OpenAI and incurs image-generation and AI charges. No image is created automatically.</p>
    <button type="button" disabled={disabled} onClick={() => run({ operation: 'generate', title: card.title, content: card.content, topic: card.topic }, select)}>Create card image with AI — paid</button>
    <CardImage image={card.image} title={card.title || 'this card'}/>
    {card.image && <button type="button" disabled={disabled} onClick={() => onChange(undefined)}>Remove card image</button>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

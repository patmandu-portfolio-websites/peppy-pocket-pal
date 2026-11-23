import React, { useEffect, useRef, useState } from 'react';
import { learningTopics } from './microlearning.js';

function Carousel({ label, items, renderItem }) {
  const [index, setIndex] = useState(0);
  const start = useRef(null);
  function move(delta) { setIndex(value => Math.max(0, Math.min(items.length - 1, value + delta))); }
  if (!items.length) return null;
  return <section className="discovery-carousel" aria-label={label} tabIndex={0}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}
    onPointerDown={event => { if (event.pointerType === 'touch') start.current = { x: event.clientX, y: event.clientY }; }}
    onPointerUp={event => {
      if (!start.current || event.pointerType !== 'touch') return;
      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    }}
    onPointerCancel={() => { start.current = null; }}>
    <p role="status">{index + 1} of {items.length}</p>
    {renderItem(items[index])}
    <div><button type="button" disabled={index === 0} onClick={() => move(-1)}>Previous {label}</button>
      <button type="button" disabled={index === items.length - 1} onClick={() => move(1)}>Next {label}</button></div>
    <p>Swipe left or right, or use the buttons. Focus this carousel and use the arrow keys.</p>
  </section>;
}

export default function MicrolearningDiscovery({ useConcept, canUseConcept }) {
  const dialog = useRef(null);
  const version = useRef(0);
  const controller = useRef(null);
  const [topic, setTopic] = useState('');
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState([]);
  const [hasNext, setHasNext] = useState(false);
  const [book, setBook] = useState(null);
  const [cards, setCards] = useState(null);
  const [videos, setVideos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (topic && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [topic]);
  useEffect(() => () => { version.current++; controller.current?.abort(); }, []);

  function close() {
    version.current++;
    controller.current?.abort();
    setBusy(false); setTopic(''); setBook(null); setCards(null); setVideos(null);
  }
  async function request(body, apply) {
    const current = ++version.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/microlearning/discovery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Discovery request failed.');
      if (version.current === current) apply(data);
    } catch (cause) {
      if (version.current === current) setError(cause.message);
    } finally {
      if (version.current === current) { setBusy(false); controller.current = null; }
    }
  }
  function browse(selected, nextPage = 1) {
    setTopic(selected); setPage(nextPage); setBook(null); setCards(null); setVideos(null); setBooks([]); setHasNext(false);
    request({ operation: 'books', topic: selected, page: nextPage }, data => { setBooks(data.books); setHasNext(data.hasNext); });
  }
  function chooseBook(item) {
    request({ operation: 'book', topic, id: item.id, archiveId: item.archiveId }, data => {
      setBook(data.book); setCards(null); setVideos(null);
    });
  }

  return <>
    <details className="discovery-topics">
      <summary>Show or hide topics and browse books</summary>
      <p>Explore English-language nonfiction from Project Gutenberg. Topic matches are approximate; older titles may contain outdated information. Some topics have few or no matches.</p>
      <div className="discovery-topic-grid">{learningTopics.map(item => <button type="button" key={item} onClick={() => browse(item)}>{item}</button>)}</div>
    </details>
    <dialog ref={dialog} className="discovery-dialog" aria-labelledby="discovery-title" onClose={close}>
      <div className="discovery-header"><h3 id="discovery-title">{topic} books</h3><button type="button" onClick={() => dialog.current.close()}>Close book browser</button></div>
      <p>Catalog data comes from Internet Archive's Project Gutenberg collection. Peppy checks the selected book's US public-domain metadata; check rights in your location and review older material critically. Closing this browser may not cancel an AI request already sent or its charges.</p>
      {!book ? <>
        <p>Page {page}. Select a title to explore it.</p>
        {!busy && !error && !books.length && <p>No eligible books found on this page.</p>}
        <ul>{books.map(item => <li key={item.id}><button type="button" disabled={busy} onClick={() => chooseBook(item)}>{item.title}</button><span> {item.author}</span></li>)}</ul>
        <button type="button" disabled={busy || page === 1} onClick={() => browse(topic, page - 1)}>Previous book page</button>
        <button type="button" disabled={busy || !hasNext} onClick={() => browse(topic, page + 1)}>Next book page</button>
      </> : <>
        <button type="button" disabled={busy} onClick={() => { setBook(null); setCards(null); setVideos(null); setError(''); setNotice(''); }}>Back to book titles</button>
        <h4>{book.title}</h4><p>By {book.author} · <a href={book.url} target="_blank" rel="noopener noreferrer">Read the original on Project Gutenberg</a></p>
        <p>Generating concepts sends sampled passages from the first portion of this book to OpenAI and incurs API charges. Results cover those passages, not necessarily the whole book. Review for accuracy and outdated claims.</p>
        <button type="button" disabled={busy} onClick={() => request({ operation: 'concepts', topic, id: book.id, archiveId: book.archiveId }, data => {
          setCards(data.cards); setNotice(data.cards.length ? 'Concept cards ready to review.' : 'No substantive concepts found in this excerpt.');
        })}>Generate book concepts with AI</button>
        {cards?.length > 0 && <Carousel key={`cards-${book.id}-${cards.length}`} label="concept" items={cards} renderItem={item => <article className="microlearning-card">
          <h4>{item.title}</h4><p>{item.content}</p><p>Source: {book.title}, {book.author} (sampled passages)</p>
          <button type="button" disabled={busy || !canUseConcept} onClick={() => {
            useConcept({ title: item.title, content: item.content, source: `${book.title}, ${book.author} — sampled passages: ${book.url}`, topic });
            dialog.current.close();
          }}>Review and save this concept</button>
          {!canUseConcept && <p>Save or clear your current card draft before loading this concept.</p>}
        </article>}/>}
        <p>Finding videos sends the book title, author and topic to OpenAI web search and incurs AI/search charges. Only cited direct YouTube video links are shown; results may be incomplete or unavailable. Opening a link takes you to YouTube.</p>
        <button type="button" disabled={busy} onClick={() => request({ operation: 'videos', topic, id: book.id, archiveId: book.archiveId }, data => {
          setVideos(data.videos); setNotice(data.videos.length ? 'Video links ready.' : 'No direct YouTube video links were found.');
        })}>Find related YouTube videos</button>
        {videos?.length > 0 && <Carousel key={`videos-${book.id}-${videos.length}`} label="video" items={videos} renderItem={item => <article className="microlearning-card">
          <h4>{item.title}</h4><a href={item.url} target="_blank" rel="noopener noreferrer">Watch on YouTube</a>
        </article>}/>}
      </>}
      {busy && <p role="status">Peppy is gathering results...</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </dialog>
  </>;
}

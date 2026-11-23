import React, { useEffect, useRef, useState } from 'react';
import { readChatImage } from './chatImage.js';
import { emptyMicrolearning, learningTopics, microlearningKey, readMicrolearning, validateCard } from './microlearning.js';
import { chatLinks } from './chatLinks.js';
import MicrolearningDiscovery, { Carousel } from './MicrolearningDiscovery.jsx';
import MicrolearningImage, { CardImage } from './MicrolearningImage.jsx';

const blankCard = () => ({ title: '', content: '', source: '', topic: learningTopics[0], stashIds: [] });

export default function MicrolearningPanel({ discussCard }) {
  const [data, setData] = useState(emptyMicrolearning);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [card, setCard] = useState(blankCard);
  const [editing, setEditing] = useState(null);
  const [stashName, setStashName] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [stashFilter, setStashFilter] = useState('');
  const [query, setQuery] = useState('');
  const [swipeLibrary, setSwipeLibrary] = useState(false);
  const [image, setImage] = useState(null);
  const [evidence, setEvidence] = useState('');
  const [interests, setInterests] = useState([]);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const cardEditor = useRef(null);

  useEffect(() => {
    try {
      const saved = readMicrolearning(localStorage.getItem(microlearningKey));
      setData(saved);
      if (saved.plan) { setGoal(saved.plan.goal); setInterests(saved.plan.interests); }
    }
    catch (cause) { setLoadError(`Microlearning data could not be loaded: ${cause.message}. It has not been overwritten.`); }
  }, []);

  function save(next) {
    localStorage.setItem(microlearningKey, JSON.stringify(next));
    setData(next);
  }
  function update(fn, message) {
    setError(''); setNotice('');
    try { save(fn()); if (message) setNotice(message); return true; }
    catch (cause) { setError(cause.message); return false; }
  }
  async function request(body) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/microlearning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Microlearning request failed.');
      return result.result;
    } finally { setBusy(false); }
  }
  async function scan() {
    try {
      if (!image) throw new Error('Choose a page image first.');
      const result = await request({ operation: 'scan', image });
      setEvidence(result.transcription);
      setNotice('Review and correct the transcription before drafting a card.');
    } catch (cause) { setError(cause.message); }
  }
  async function draft() {
    try {
      const result = await request({ operation: 'draft', evidence, source: card.source });
      setCard(current => ({ ...current, title: result.title, content: result.content }));
      setNotice('Review and edit the card, then save it.');
    } catch (cause) { setError(cause.message); }
  }
  async function createPlan() {
    try {
      if (!goal.trim() || goal.trim().length > 500) throw new Error('Enter a goal of 1-500 characters.');
      if (!interests.length) throw new Error('Choose at least one interest.');
      const matching = data.cards.filter(item => interests.includes(item.topic)).slice(0, 20);
      if (!matching.length) throw new Error('Save at least one card matching your interests first.');
      const result = await request({ operation: 'plan', goal: goal.trim(), interests, cards: matching.map(({ id, title, content, topic }) => ({ id, title, content, topic })) });
      save({ ...data, plan: { goal: goal.trim(), interests, cardIds: result.cardIds, actions: result.actions } });
      setNotice('Growth plan saved in this browser.');
    } catch (cause) { setError(cause.message); }
  }
  function saveCard() {
    const saved = update(() => {
      const checked = validateCard(card);
      const entry = { ...checked, id: editing || crypto.randomUUID(), stashIds: checked.stashIds.filter(id => data.stashes.some(stash => stash.id === id)) };
      return { ...data, cards: editing ? data.cards.map(item => item.id === editing ? entry : item) : [...data.cards, entry] };
    }, 'Idea card saved.');
    if (saved) { setCard(blankCard()); setEditing(null); }
  }
  const visible = data.cards.filter(item => (!topicFilter || item.topic === topicFilter) &&
    (!stashFilter || item.stashIds.includes(stashFilter)) &&
    `${item.title} ${item.content} ${item.source}`.toLowerCase().includes(query.toLowerCase()));
  function renderCard(item) {
    return <article className="microlearning-card" key={item.id}>
      <h5>{item.title}</h5><CardImage image={item.image} title={item.title}/><p>{item.content}</p>
      <p>Source: {chatLinks(item.source).map((part, index) => part.url ?
        <a key={index} href={part.url} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)}</p>
      <p>Topic: {item.topic} {item.stashIds.length > 0 && ` · Stashes: ${item.stashIds.map(id => data.stashes.find(stash => stash.id === id)?.name).filter(Boolean).join(', ')}`}</p>
      <button type="button" disabled={busy} onClick={() => { discussCard(item); setNotice('Card added to your chat draft. Review it before sending.'); }}>Discuss {item.title} in chat</button>
      <button type="button" disabled={busy} onClick={() => { setCard({ ...item }); setEditing(item.id); setNotice('Card loaded into the editor above.'); }}>Edit {item.title}</button>
      <button type="button" disabled={busy} onClick={() => {
        const saved = update(() => ({ ...data, cards: data.cards.filter(existing => existing.id !== item.id) }), 'Card deleted.');
        if (saved && editing === item.id) { setEditing(null); setCard(blankCard()); }
      }}>Delete {item.title}</button>
    </article>;
  }

  if (loadError) return <p role="alert">{loadError}</p>;
  return <section aria-label="Microlearning">
    <h3>Microlearning</h3>
    <p>Make bite-sized ideas, organize them into stashes, and build a growth plan. Cards and plans stay in this browser, unencrypted and unsynchronized; clearing site data removes them. They are not added to chat memory.</p>
    <p>Use material you have permission to process. Explore <a href="https://www.gutenberg.org/" target="_blank" rel="noopener noreferrer">Project Gutenberg</a> or <a href="https://openstax.org/subjects" target="_blank" rel="noopener noreferrer">OpenStax</a>; check each work's rights and licence.</p>
    <MicrolearningDiscovery canUseConcept={!busy && !editing && !card.title && !card.content && !card.source && !card.image}
      useConcept={value => {
        setCard({ ...value, stashIds: card.stashIds }); setEditing(null); setError('');
        setNotice('Review the concept, choose any stashes, then save it.');
        requestAnimationFrame(() => { cardEditor.current?.scrollIntoView({ block: 'center' }); cardEditor.current?.focus(); });
      }}/>

    <h4>Stashes</h4>
    <label>New stash name <input maxLength={100} value={stashName} onChange={event => setStashName(event.target.value)}/></label>
    <button type="button" disabled={busy} onClick={() => {
      const saved = update(() => {
      const name = stashName.trim();
      if (!name || name.length > 100) throw new Error('Enter a stash name of 1-100 characters.');
      if (data.stashes.some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error('A stash with this name already exists.');
      return { ...data, stashes: [...data.stashes, { id: crypto.randomUUID(), name }] };
      }, 'Stash created.');
      if (saved) setStashName('');
    }}>Create stash</button>
    {data.stashes.map(stash => <div key={stash.id}>{stash.name} <button type="button" disabled={busy} onClick={() => {
      const saved = update(() => {
      return { ...data, stashes: data.stashes.filter(item => item.id !== stash.id), cards: data.cards.map(item => ({ ...item, stashIds: item.stashIds.filter(id => id !== stash.id) })) };
      }, 'Stash deleted; its cards are still saved.');
      if (saved) {
        setCard(current => ({ ...current, stashIds: current.stashIds.filter(id => id !== stash.id) }));
        if (stashFilter === stash.id) setStashFilter('');
      }
    }}>Delete stash {stash.name}</button></div>)}

    <h4>Book-page scanner and reviewed text</h4>
    <p>Select a PNG, JPEG or WebP page (up to 4 MiB / 16 megapixels). Scanning sends the image and its metadata to OpenAI and incurs API charges. The image is temporary, not saved in your library. Check the transcription for errors.</p>
    <label>Book page image <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0];
      setImage(null); setError('');
      if (!file) return;
      setBusy(true);
      try { setImage(await readChatImage(file)); }
      catch (cause) { setError(cause.message); }
      finally { setBusy(false); }
    }}/></label>
    {image && <p>Page ready to scan.</p>}
    <button type="button" disabled={busy || !image} onClick={scan}>Send page to AI for transcription</button>
    <label>Reviewed page text or authorized excerpt <textarea disabled={busy} maxLength={6000} rows={5} value={evidence} onChange={event => setEvidence(event.target.value)}/></label>
    <p>Drafting sends only this reviewed text and the source below to OpenAI and incurs API charges. Review AI output; it may be inaccurate.</p>

    <h4 ref={cardEditor} tabIndex={-1}>{editing ? 'Edit idea card' : 'Create idea card'}</h4>
    <label>Card source (title, author and optional link) <input disabled={busy} maxLength={500} value={card.source} onChange={event => setCard({ ...card, source: event.target.value })}/></label>
    <button type="button" disabled={busy} onClick={draft}>Draft card from reviewed text with AI</button>
    <label>Card title <input disabled={busy} maxLength={120} value={card.title} onChange={event => setCard({ ...card, title: event.target.value })}/></label>
    <label>Idea <textarea disabled={busy} maxLength={1200} rows={4} value={card.content} onChange={event => setCard({ ...card, content: event.target.value })}/></label>
    <label>Card topic <select disabled={busy} value={card.topic} onChange={event => setCard({ ...card, topic: event.target.value })}>{learningTopics.map(topic => <option key={topic}>{topic}</option>)}</select></label>
    {data.stashes.length > 0 && <fieldset disabled={busy}><legend>Add to stashes</legend>{data.stashes.map(stash => <label key={stash.id}><input type="checkbox" checked={card.stashIds.includes(stash.id)} onChange={event => setCard({ ...card, stashIds: event.target.checked ? [...card.stashIds, stash.id] : card.stashIds.filter(id => id !== stash.id) })}/> {stash.name}</label>)}</fieldset>}
    <MicrolearningImage card={card} disabled={busy} onBusyChange={setBusy} onChange={value => setCard(current => ({ ...current, image: value }))}/>
    <button type="button" disabled={busy} onClick={saveCard}>{editing ? 'Save card changes' : 'Save idea card'}</button>
    {editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setCard(blankCard()); }}>Cancel editing</button>}
    {!editing && (card.title || card.content || card.source || card.image) && <button type="button" disabled={busy} onClick={() => setCard(blankCard())}>Clear card draft</button>}

    <h4>Idea library</h4>
    <label>Search cards <input value={query} onChange={event => setQuery(event.target.value)}/></label>
    <label>Filter by topic <select value={topicFilter} onChange={event => setTopicFilter(event.target.value)}><option value="">All topics</option>{learningTopics.map(topic => <option key={topic}>{topic}</option>)}</select></label>
    <label>Filter by stash <select value={stashFilter} onChange={event => setStashFilter(event.target.value)}><option value="">All stashes</option>{data.stashes.map(stash => <option key={stash.id} value={stash.id}>{stash.name}</option>)}</select></label>
    <button type="button" onClick={() => setSwipeLibrary(value => !value)}>{swipeLibrary ? 'Show saved cards as a list' : 'Swipe through saved cards'}</button>
    {!visible.length && <p>No cards match yet.</p>}
    {swipeLibrary ? <Carousel key={`${topicFilter}-${stashFilter}-${query}`} label="saved card" items={visible} renderItem={renderCard}/> : visible.map(renderCard)}

    <h4>Growth plan</h4>
    <p>Choose interests and a goal. Peppy sends your goal, interests and up to the first 20 matching saved cards to OpenAI to select up to five cards and suggest actions. This incurs API charges; review suggestions before acting.</p>
    <label>Growth goal <textarea disabled={busy} maxLength={500} rows={3} value={goal} onChange={event => setGoal(event.target.value)}/></label>
    <fieldset disabled={busy}><legend>Interests</legend><div className="microlearning-topics">{learningTopics.map(topic => <label key={topic}><input type="checkbox" checked={interests.includes(topic)} onChange={event => setInterests(event.target.checked ? [...interests, topic] : interests.filter(item => item !== topic))}/> {topic}</label>)}</div></fieldset>
    <button type="button" disabled={busy} onClick={createPlan}>Suggest and save growth plan</button>
    {data.plan && <div><h5>Your saved plan</h5><p>Goal: {data.plan.goal}</p><p>Interests: {data.plan.interests.join(', ')}</p><h5>Suggested cards</h5><ul>{data.plan.cardIds.map(id => <li key={id}>{data.cards.find(item => item.id === id)?.title || 'Card deleted'}</li>)}</ul><h5>Practical actions</h5><ul>{data.plan.actions.map((action, index) => <li key={index}>{action}</li>)}</ul><button type="button" disabled={busy} onClick={() => update(() => ({ ...data, plan: null }), 'Growth plan deleted.')}>Delete growth plan</button></div>}
    {busy && <p role="status">Peppy is working on your request...</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Heart, Menu, MessageCircle, Plus, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import './style.css';

const KEY = 'peppy-state-v1';
const firstState = { messages: [], memory: '', name: '' };
const topics = [
  { icon: '🏟️', label: 'Sports chat', prompt: 'Let’s talk sports! What’s been exciting lately?' },
  { icon: '🖥️', label: 'Tech things', prompt: 'I’m in a tech mood. Got any fun computer topics for us?' },
  { icon: '🎮', label: 'Game time', prompt: 'Let’s talk games! What should we get nerdy about?' },
  { icon: '🌙', label: 'Big questions', prompt: 'I’ve got some big life and spirituality questions on my mind.' }
];

function App() {
  const [saved, setSaved] = useState(() => { try { return { ...firstState, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return firstState; } });
  const [messages, setMessages] = useState(saved.messages);
  const [memory, setMemory] = useState(saved.memory);
  const [name, setName] = useState(saved.name);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [panel, setPanel] = useState('');
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const tail = useRef(null);
  const input = useRef(null);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ messages, memory, name })); }, [messages, memory, name]);
  useEffect(() => { fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ configured: false })); }, []);
  useEffect(() => { tail.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, loading]);
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);

  async function send(text = draft) {
    const content = text.trim(); if (!content || loading) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next); setDraft(''); setLoading(true);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next.slice(-16), memory: [name && `The user's name is ${name}.`, memory].filter(Boolean).join('\n') }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Something went wrong.');
      setMessages([...next, { role: 'assistant', content: data.reply }]);
    } catch (err) { setMessages([...next, { role: 'assistant', content: `Oh! ${err.message}` }]); }
    finally { setLoading(false); input.current?.focus(); }
  }

  function newChat() { setMessages([]); setMenu(false); }
  async function copyLast() { const last = [...messages].reverse().find(m => m.role === 'assistant'); if (last) { await navigator.clipboard?.writeText(last.content); setCopied(true); setTimeout(() => setCopied(false), 1400); } }

  return <div className="app-shell">
    <aside className="rail">
      <button className="brand-mark" onClick={() => { newChat(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label="Peppy home"><span>p</span><Sparkles size={15}/></button>
      <button className="rail-action active" aria-label="Chat"><MessageCircle size={19}/></button>
      <button className="rail-action" aria-label="New chat" onClick={newChat}><Plus size={20}/></button>
      <div className="rail-spacer"/><button className="rail-action" aria-label="Your memories" onClick={() => setPanel('memory')}><Heart size={19}/></button>
      <button className="avatar" aria-label="Settings" onClick={() => setPanel('settings')}>{name ? name[0].toUpperCase() : '✿'}</button>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="mobile-brand"><span className="tiny-mark">p</span><span>peppy</span></div>
        <button className="top-title" onClick={() => setPanel('settings')}>Your pocket pal <ChevronRight size={15}/></button>
        <div className="top-actions"><span className="online"><i/> here with you</span><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenu(!menu)}><Menu size={20}/></button><button className="icon-button desktop-settings" aria-label="Preferences" onClick={() => setPanel('settings')}><Settings2 size={19}/></button></div>
      </header>

      <section className={`conversation ${messages.length ? 'has-messages' : ''}`}>
        {messages.length === 0 ? <div className="welcome-wrap">
          <div className="hello-illustration"><div className="spark s1">✦</div><div className="spark s2">✳</div><div className="blob"><span className="eyes">•　•</span><span className="smile">⌣</span><i className="cheek c1"/><i className="cheek c2"/></div><div className="hello-heart">♥</div></div>
          <div className="eyebrow"><Sparkles size={13}/> YOUR LITTLE CORNER OF THE INTERNET</div>
          <h1>{name ? `Hey, ${name}!` : 'Hey, friend!'}<br/><span>What’s on your mind?</span></h1>
          <p className="welcome-copy">I’m Peppy — here for the big thoughts, tiny wins,<br className="wide-only"/> weird questions, and everything in between.</p>
          <div className="topic-grid">{topics.map(t => <button className="topic-card" key={t.label} onClick={() => send(t.prompt)}><span className="topic-emoji">{t.icon}</span><span>{t.label}</span><ArrowUp className="topic-arrow" size={14}/></button>)}</div>
          <button className="memory-nudge" onClick={() => setPanel('memory')}><span className="nudge-icon"><Heart size={15}/></span><span><b>Make this feel more like us</b><small>Add a few things for me to remember about you</small></span><ChevronRight size={17}/></button>
        </div> : <div className="message-list">{messages.map((m, i) => <article className={`message ${m.role}`} key={i}><div className={`message-avatar ${m.role}`}>{m.role === 'assistant' ? 'p' : (name ? name[0].toUpperCase() : '✿')}</div><div className="message-content"><div className="message-label">{m.role === 'assistant' ? 'Peppy' : name || 'You'}{m.role === 'assistant' && i === messages.length - 1 && <button className="copy-button" onClick={copyLast}>{copied ? <Check size={12}/> : null}{copied ? 'Copied' : 'Copy reply'}</button>}</div><p>{m.content}</p></div></article>)}{loading && <article className="message assistant"><div className="message-avatar assistant">p</div><div className="message-content"><div className="message-label">Peppy</div><div className="typing"><i/><i/><i/></div></div></article>}<div ref={tail}/></div>}
      </section>

      <footer className="composer-area">
        {!status?.configured && <button className="setup-hint" onClick={() => setPanel('setup')}><span>✨</span> Peppy’s nearly ready — connect an API key to start chatting <ChevronRight size={15}/></button>}
        <form className="composer" onSubmit={e => { e.preventDefault(); send(); }}><textarea ref={input} rows="1" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Say whatever’s on your mind…" aria-label="Your message"/><div className="composer-bottom"><span className="composer-note"><Sparkles size={13}/> Your chats stay on this device</span><button className={`send-button ${draft.trim() ? 'ready' : ''}`} type="submit" disabled={!draft.trim() || loading} aria-label="Send message"><ArrowUp size={19}/></button></div></form>
        <p className="fineprint">Peppy is AI and can get things wrong. For important decisions, check with a pro.</p>
      </footer>
    </main>
    {menu && <div className="mobile-drawer"><button onClick={newChat}><Plus size={16}/> New chat</button><button onClick={() => { setMenu(false); setPanel('memory'); }}><Heart size={16}/> Your memories</button><button onClick={() => { setMenu(false); setPanel('settings'); }}><Settings2 size={16}/> Preferences</button></div>}
    {panel && <div className="scrim" onClick={() => setPanel('')}><section className="side-panel" onClick={e => e.stopPropagation()}><div className="panel-head"><div><span className="panel-eyebrow">{panel === 'memory' ? 'A LITTLE ABOUT YOU' : panel === 'setup' ? 'LET’S GET PEPPY' : 'YOUR SPACE'}</span><h2>{panel === 'memory' ? 'Things to remember' : panel === 'setup' ? 'Connect your chatbot' : 'Make yourself at home'}</h2></div><button className="icon-button" onClick={() => setPanel('')} aria-label="Close"><X size={19}/></button></div>
      {panel === 'memory' ? <><p className="panel-copy">Your notes stay in this browser and help me make our chats feel more personal. Add anything you’d like me to keep in mind.</p><label className="field-label" htmlFor="name">What should I call you?</label><input id="name" className="text-field" value={name} onChange={e => setName(e.target.value)} placeholder="A name or nickname"/><label className="field-label" htmlFor="memory">Your notes & preferences</label><textarea id="memory" className="memory-field" value={memory} onChange={e => setMemory(e.target.value)} placeholder={'I’m a big fan of…\nI prefer answers that…\nI’m currently working on…'} rows="7"/><div className="local-note"><Heart size={15}/> Saved privately on this device</div><button className="delete-button" onClick={() => { setMemory(''); setName(''); }}><Trash2 size={15}/> Clear my saved notes</button></> : panel === 'setup' ? <><p className="panel-copy">The app is ready. To let Peppy answer for real, add your OpenAI API key to a <code>.env</code> file in the project folder, then restart the app.</p><div className="setup-steps"><span>1</span><p>Copy <code>.env.example</code> to a new file named <code>.env</code>.</p><span>2</span><p>Paste your key after <code>OPENAI_API_KEY=</code>.</p><span>3</span><p>Run <code>npm install</code>, then <code>npm run dev</code>.</p></div><p className="panel-copy small-copy">The key stays on your server and is never sent to the browser.</p></> : <><p className="panel-copy">Your cheerful, curious, anything-goes companion. A cosy space for sports takes, tech tangents, game talk, big questions, and the random thought you just had.</p><div className="settings-card"><span className="settings-icon">☀️</span><span><b>Warm, lively & playful</b><small>Peppy adjusts the energy to fit the moment.</small></span><Check size={16} className="checked"/></div><div className="settings-card"><span className="settings-icon">🛟</span><span><b>Thoughtful by default</b><small>Careful with high-stakes topics; kind when things get heavy.</small></span><Check size={16} className="checked"/></div><button className="settings-link" onClick={() => setPanel('memory')}><Heart size={16}/> Manage what Peppy remembers <ChevronRight size={16}/></button></>}
    </section></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);

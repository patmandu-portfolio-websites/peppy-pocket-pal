import React, { useEffect, useState } from 'react';
import './peppyFace.css';

export function useIdleExpression(enabled, activity) {
  const [expression, setExpression] = useState('');
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer;
    let turn = 0;
    function restart() {
      clearTimeout(timer);
      setExpression('');
      if (!enabled || motion.matches || document.hidden) return;
      timer = setTimeout(function play() {
        setExpression(turn++ % 2 ? 'cheeky' : 'winking');
        timer = setTimeout(() => {
          setExpression('');
          timer = setTimeout(play, 20000);
        }, 2500);
      }, 20000);
    }
    restart();
    motion.addEventListener('change', restart);
    document.addEventListener('visibilitychange', restart);
    return () => {
      clearTimeout(timer);
      motion.removeEventListener('change', restart);
      document.removeEventListener('visibilitychange', restart);
    };
  }, [enabled, activity]);
  return enabled ? expression : '';
}

export default function PeppyFace({ state = 'idle', expression = 'neutral', animated = true, decorative = false }) {
  const mood = state === 'listening' || state === 'thinking' ? 'neutral' : expression;
  const label = state === 'idle' ? mood === 'neutral' ? 'here with you' : mood :
    `${state}${mood === 'neutral' ? '' : ` (${mood})`}`;
  return <svg className="peppy-face" viewBox="0 0 100 100" data-state={state} data-expression={mood} data-animated={animated}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : `Peppy is ${label}`}
    aria-hidden={decorative ? true : undefined}>
    <path fill="#ffb390" d="M50 8C76 7 94 25 92 50C90 78 75 93 49 92C23 92 8 76 8 50C7 24 22 9 50 8Z"/>
    <path fill="#f5a37e" d="M86 29C99 61 78 92 49 92C27 92 15 81 11 66C24 88 76 94 86 29Z"/>
    <ellipse fill="#f18d80" cx="26" cy="58" rx="7" ry="4"/>
    <ellipse fill="#f18d80" cx="74" cy="58" rx="7" ry="4"/>
    <g className="face-gaze">
      <g className="face-eyes" fill="#573e45">
        {mood === 'winking' || mood === 'cheeky' ? <>
          <ellipse cx="34" cy="43" rx="4" ry="6"/>
          <path d="M60 43Q66 48 72 43" fill="none" stroke="#573e45" strokeWidth="3.5" strokeLinecap="round"/>
        </> : mood === 'happy' || mood === 'excited' ? <>
          <path d="M28 45Q34 34 40 45M60 45Q66 34 72 45" fill="none" stroke="#573e45" strokeWidth="3.5" strokeLinecap="round"/>
        </> : <>
          <ellipse cx="34" cy="43" rx={mood === 'surprised' ? 5 : 4} ry={mood === 'surprised' ? 8 : 6}/>
          <ellipse cx="66" cy="43" rx={mood === 'surprised' ? 5 : 4} ry={mood === 'surprised' ? 8 : 6}/>
        </>}
      </g>
      {mood === 'surprised' && <path d="M28 29Q34 25 40 29M60 29Q66 25 72 29" fill="none" stroke="#824950" strokeWidth="2.5" strokeLinecap="round"/>}
    </g>
    {mood === 'surprised' ? <ellipse className="face-smile" cx="50" cy="65" rx="5" ry="7" fill="#824950"/> :
      <path className="face-smile" d={mood === 'neutral' ? 'M40 61Q50 72 60 61' : 'M36 59Q50 80 64 59'} fill="none" stroke="#824950" strokeWidth="3.5" strokeLinecap="round"/>}
    <ellipse className="face-mouth" cx="50" cy="65" rx={mood === 'surprised' ? 5 : 8} ry="6" fill="#824950"/>
    {mood === 'cheeky' && <path d="M50 66H60V71Q55 80 50 71Z" fill="#e47786"/>}
  </svg>;
}

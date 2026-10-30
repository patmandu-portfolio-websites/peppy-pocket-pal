import { useEffect, useRef, useState } from 'react';
import { parseVoiceSend } from './voiceCommand';

const recognitionErrors = {
  'not-allowed': 'Microphone access was denied. Allow microphone and speech recognition access in your browser settings, then try again.',
  'service-not-allowed': 'Your browser has disabled speech recognition. Check its speech and privacy settings.',
  'audio-capture': 'No microphone is available. Check that your microphone is connected and not being used by another app.',
  'no-speech': 'No speech was detected. Tap the microphone and try again.',
  network: 'Speech recognition could not connect. Check your internet connection and try again.',
  'language-not-supported': 'Speech recognition does not support your browser language. Try another browser language.'
};

export function useVoiceChat({ enabled, selectedVoice, voiceSendEnabled, onTranscript, onVoiceSend }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canListen = Boolean(Recognition) && window.isSecureContext;
  const canSpeak = 'Audio' in window;
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef(null);
  const playback = useRef(null);
  const selectedVoiceRef = useRef(selectedVoice);
  selectedVoiceRef.current = selectedVoice;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const voiceSendRef = useRef({ enabled: voiceSendEnabled, send: onVoiceSend });
  voiceSendRef.current = { enabled: voiceSendEnabled, send: onVoiceSend };

  function stopSpeaking() {
    const active = playback.current;
    playback.current = null;
    if (active) {
      active.controller.abort();
      active.audio?.pause();
      if (active.url) URL.revokeObjectURL(active.url);
    }
    setPreparing(false);
    setSpeaking(false);
  }

  function stopListening() {
    const active = recognition.current;
    recognition.current = null;
    active?.abort();
    setListening(false);
  }

  function stopAll() {
    stopListening();
    stopSpeaking();
  }

  function startListening(draft) {
    setError('');
    if (!canListen) {
      setError(!window.isSecureContext
        ? 'Microphone input needs HTTPS on your phone (or localhost on this computer). You can still type a message.'
        : 'Speech recognition is not available in this browser. Try Chrome on Android or Safari on iPhone, or type your message.');
      return;
    }
    stopAll();
    const active = new Recognition();
    recognition.current = active;
    active.lang = navigator.language || 'en-US';
    active.continuous = false;
    active.interimResults = true;
    let heardSpeech = false;
    let failed = false;
    active.onresult = event => {
      if (recognition.current !== active) return;
      const result = parseVoiceSend(event.results, draft, voiceSendRef.current.enabled);
      heardSpeech = event.results.length > 0;
      onTranscript(result.text);
      if (result.command) {
        stopListening();
        if (result.text) voiceSendRef.current.send(result.text);
        else setError('There is no message to send. Dictate a message before saying "Peppy, send".');
      }
    };
    active.onerror = event => {
      if (recognition.current !== active) return;
      failed = true;
      setError(recognitionErrors[event.error] || `Speech recognition stopped (${event.error}). Please try again or type your message.`);
    };
    active.onend = () => {
      if (recognition.current !== active) return;
      recognition.current = null;
      setListening(false);
      if (!heardSpeech && !failed) setError(recognitionErrors['no-speech']);
    };
    try {
      setListening(true);
      active.start();
    } catch (cause) {
      recognition.current = null;
      setListening(false);
      setError(`Could not start the microphone: ${cause.message}`);
    }
  }

  async function speak(text, automatic = false) {
    if (automatic && !enabledRef.current) return;
    setError('');
    if (!canSpeak) {
      setError('Spoken replies are not available in this browser. You can still read every reply.');
      return;
    }
    stopAll();
    const active = { controller: new AbortController(), audio: null, url: null };
    playback.current = active;
    setPreparing(true);
    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: selectedVoiceRef.current }),
        signal: active.controller.signal
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Speech generation failed. Please try again.');
      }
      const blob = await response.blob();
      if (playback.current !== active) return;
      active.url = URL.createObjectURL(blob);
      active.audio = new Audio(active.url);
      active.audio.onended = () => { if (playback.current === active) stopSpeaking(); };
      active.audio.onerror = () => {
        if (playback.current !== active) return;
        stopSpeaking();
        setError('The spoken reply could not play. Tap "Read last reply" to try again.');
      };
      await active.audio.play();
      if (playback.current !== active) return;
      setPreparing(false);
      setSpeaking(true);
    } catch (cause) {
      if (playback.current !== active) return;
      stopSpeaking();
      setError(cause.name === 'NotAllowedError'
        ? 'Your phone blocked audio playback. Tap "Read last reply" to try again.'
        : `Could not play the spoken reply: ${cause.message}`);
    }
  }

  useEffect(() => {
    if (!enabled) stopSpeaking();
  }, [enabled]);

  useEffect(() => {
    stopSpeaking();
  }, [selectedVoice]);

  useEffect(() => {
    function cancelVoice() {
      const active = recognition.current;
      recognition.current = null;
      active?.abort();
      stopSpeaking();
      setListening(false);
    }
    function onVisibilityChange() {
      if (document.hidden) cancelVoice();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelVoice();
    };
  }, []);

  return { canListen, canSpeak, listening, speaking, preparing, error, startListening, stopListening, stopSpeaking, stopAll, speak };
}

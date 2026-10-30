# Peppy — your pocket pal

A cheerful, responsive chat companion built as a Progressive Web App (PWA).

## Run locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and add your OpenAI API key.
4. Run `npm run dev` and open the local URL printed by Vite (normally `http://localhost:5173`).

The API key is read by the server and is never sent to the browser. API usage may incur charges on the OpenAI account associated with the key. Change `OPENAI_MODEL` in `.env` if you want a different model available to your account.

## What it includes

- Mobile-friendly installable PWA shell with offline app-shell caching.
- Friendly, energetic companion persona for general conversation.
- Saved conversation history and editable personal notes in this browser's local storage.
- Notes are included in the conversation request to personalize answers. Clearing browser site data removes local history and notes.
- Default boundaries for high-stakes advice, crisis support, spirituality, and avoiding harmful assistance.
- Browser-based microphone dictation and optional OpenAI-generated spoken replies.

## Voice chat

- Tap the microphone beside Send and allow microphone/speech recognition access. Speak, wait for recognition to finish (or tap Stop), review the transcript, then send it.
- Optionally turn on **Enable "Peppy, send" voice command** (off by default, saved on this browser). While dictating, finish with **Peppy, send** to send the message immediately once recognition confirms the words. The command is removed from the message; an existing typed draft is included. An empty message is never sent. Without this option, dictated words always remain in the draft for review. Recognition can mishear you; leave the option off if you want to review every message.
- This is not a wake word: you must tap the microphone first. The command only works while recognition is active, not in the background, and does not automatically restart the microphone after a reply.
- Tap the speaker button to enable automatic spoken replies. The preference is saved on this browser; it starts off. Use **Read last reply** to replay a response or **Stop speaking** to interrupt it.
- Choose **Peppy's voice** and use **Preview voice** to hear a sample. Marin is the default; Marin and Cedar are recommended for quality. The selected voice is saved on this browser. Changing voices cancels current playback.
- Starting the microphone stops playback so Peppy does not dictate its own voice. Leaving the tab or starting a new chat stops microphone input and playback.
- Phone microphone access requires **HTTPS**. A plain `http://192.168...` development URL will not work; `localhost` is allowed for development on the computer itself.
- Speech recognition support varies. Try Chrome on Android or Safari on iPhone with speech recognition enabled; some browsers, installed PWAs, and devices do not support it. Text chat remains available. Some phones require tapping **Read last reply** before audio can play.
- Microphone recognition uses the browser's speech service and language settings. It may need an internet connection and may send audio to the browser provider; it is not guaranteed to run on-device.
- Spoken replies use `/api/speech` on the server with the existing `OPENAI_API_KEY`, and send reply text to OpenAI. The voice is AI-generated, not human. Every preview and replay requests new audio and incurs speech API charges in addition to normal chat charges. Turning off automatic spoken replies does not disable manually requested previews or replays.
- Speech defaults to `gpt-4o-mini-tts`; optionally set `OPENAI_SPEECH_MODEL` to a compatible model supporting the same speech endpoint, voices, and instructions. Your API project needs speech-model access and billing credit. Speech failures are shown without losing the text reply. Requests are limited to 4096 characters; longer replies remain readable as text.
- OpenAI currently documents a January 6, 2027 shutdown for `gpt-4o-mini-tts`. Before that date, migrate the speech integration to the recommended Realtime API workflow; simply changing the model name to a Realtime model will not work. See the [OpenAI speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).

Chats and notes currently stay in the browser, but messages are sent to the configured model provider when you chat. This starter does not include user accounts or sync between devices. Before making it public, add sign-in, per-user rate limits, and an appropriate production hosting and privacy setup.

## Production build

Run `npm run build`, set `NODE_ENV=production`, and start with `npm start`. Serve it over HTTPS to enable PWA installation on mobile devices.

### Deploy on Render

- Create a **Web Service** connected to this repository.
- Build command: `npm ci && npm run build`.
- Start command: `npm start`.
- Set `NODE_ENV=production` and add `OPENAI_API_KEY` as a secret environment variable. Optionally set `OPENAI_MODEL` and `OPENAI_SPEECH_MODEL`.
- Render supplies `PORT`; the server listens on that port on `0.0.0.0`.
- Use Render's HTTPS URL for phone microphone access.

The production SPA fallback uses Express 5's named wildcard `/{*path}`, which matches both `/` and nested page URLs. An unnamed `*` route causes a startup error with Express 5.

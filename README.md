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

Chats and notes currently stay in the browser, but messages are sent to the configured model provider when you chat. This starter does not include user accounts or sync between devices. Before making it public, add sign-in, per-user rate limits, and an appropriate production hosting and privacy setup.

## Production build

Run `npm run build`, set `NODE_ENV=production`, and start with `npm start`. Serve it over HTTPS to enable PWA installation on mobile devices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authConfig, installHostedAuth } from './hostedAuth.js';

test('Render authentication fails closed but local server stays opt-in', () => {
  assert.equal(authConfig({}), null);
  assert.throws(() => authConfig({ RENDER: 'true' }), /requires/);
});

test('Google login binds nonce/state, restricts account, expires and revokes sessions', async t => {
  const items = new Map();
  const store = {
    put: async (id, value) => items.set(id, value),
    get: async id => items.get(id),
    remove: async id => items.delete(id),
    consume: async id => { const value = items.get(id); items.delete(id); return value; }
  };
  let clock = Date.now();
  let nonce;
  let email = 'owner@example.com';
  const oauth = {
    generateAuthUrl: options => { nonce = options.nonce; return `https://accounts.google.com/login?state=${options.state}`; },
    getToken: async options => {
      assert.ok(options.codeVerifier);
      return { tokens: { id_token: 'test' } };
    },
    verifyIdToken: async () => ({ getPayload: () => ({ sub: 'owner-sub', nonce, email, email_verified: true }) })
  };
  const app = express();
  const config = { origin: 'https://peppy.example.com', email: 'owner@example.com', clientId: 'client' };
  installHostedAuth(app, { config, store, oauth, now: () => clock });
  app.get('/api/private', (_req, res) => res.json({ private: true }));
  app.post('/api/private', (_req, res) => res.json({ private: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url, headers = {}) => fetch(base + url, { headers, redirect: 'manual' });
  assert.equal((await get('/api/private')).status, 401);
  async function begin() {
    const response = await get('/api/auth/google');
    const state = new URL(response.headers.get('location')).searchParams.get('state');
    return { state, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  let login = await begin();
  assert.equal((await get(`/api/auth/google/callback?state=wrong&code=test`, { cookie: login.cookie })).status, 400);
  email = 'intruder@example.com';
  assert.equal((await get(`/api/auth/google/callback?state=${login.state}&code=test`, { cookie: login.cookie })).status, 403);
  email = config.email;
  login = await begin();
  const response = await get(`/api/auth/google/callback?state=${login.state}&code=test`, { cookie: login.cookie });
  assert.equal(response.status, 302);
  const cookies = response.headers.getSetCookie();
  const session = cookies.find(value => value.startsWith('__Host-peppy_session=')).split(';')[0];
  assert.match(cookies.join(' '), /Secure/);
  assert.match(cookies.join(' '), /HttpOnly/);
  assert.equal((await get('/api/private', { cookie: session })).status, 200);
  assert.equal((await get(`/api/auth/google/callback?state=${login.state}&code=test`, { cookie: login.cookie })).status, 400);
  assert.equal((await fetch(base + '/api/private', { method: 'POST', headers: { cookie: session, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: session, origin: config.origin } })).status, 200);
  assert.equal((await get('/api/private', { cookie: session })).status, 401);
  login = await begin();
  clock += 11 * 60 * 1000;
  assert.equal((await get(`/api/auth/google/callback?state=${login.state}&code=test`, { cookie: login.cookie })).status, 400);
});

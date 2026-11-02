import crypto from 'node:crypto';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const sessionCookie = '__Host-peppy_session';
const stateCookie = '__Host-peppy_login';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
function cookie(req, name) {
  const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function authConfig(env) {
  const enabled = Boolean(env.RENDER) || env.PEPPY_HOSTED_AUTH === '1';
  if (!enabled) return null;
  for (const key of ['PEPPY_PUBLIC_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PEPPY_ALLOWED_EMAIL', 'GOOGLE_CLOUD_PROJECT']) {
    if (!env[key]?.trim()) throw new Error(`Hosted Google authentication requires ${key}. Hosted access will not start without authentication configuration.`);
  }
  const url = new URL(env.PEPPY_PUBLIC_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PEPPY_PUBLIC_URL must be an HTTPS origin.');
  return { origin: url.origin, callback: `${url.origin}/api/auth/google/callback`, email: env.PEPPY_ALLOWED_EMAIL.trim().toLowerCase(), clientId: env.GOOGLE_CLIENT_ID };
}

export class FirestoreAuthStore {
  constructor(database) { this.collection = database.collection('peppy_auth'); this.database = database; }
  async put(id, value) { await this.collection.doc(id).set({ ...value, expiresAt: new Date(value.expires) }); }
  async get(id) {
    const snapshot = await this.collection.doc(id).get();
    return snapshot.exists ? snapshot.data() : null;
  }
  async remove(id) { await this.collection.doc(id).delete(); }
  async consume(id) {
    return this.database.runTransaction(async transaction => {
      const ref = this.collection.doc(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      transaction.delete(ref);
      return snapshot.data();
    });
  }
}

export function installHostedAuth(app, { config, oauth, store, now = Date.now }) {
  const endpoint = handler => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await handler(req, res, next); }
    catch (error) {
      // OAuth errors can contain tokens/codes; do not log their message or response.
      console.error('Hosted authentication operation failed.');
      res.status(503).json({ error: 'Sign-in service unavailable. Retry later; access remains blocked.' });
    }
  };
  const identity = async req => {
    const token = cookie(req, sessionCookie);
    if (!token) return null;
    const item = await store.get(`session_${digest(token)}`);
    return item?.type === 'session' && item.expires > now() && item.email === config.email ? item : null;
  };
  app.get('/api/auth/status', endpoint(async (req, res) => {
    res.json({ required: true, signedIn: Boolean(await identity(req)) });
  }));
  app.get('/api/auth/google', endpoint(async (_req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(32).toString('hex');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await store.put(`login_${digest(state)}`, { type: 'login', nonce, verifier, expires: now() + 10 * 60 * 1000 });
    res.cookie(stateCookie, state, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
    res.redirect(oauth.generateAuthUrl({ scope: ['openid', 'email'], state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }));
  }));
  app.get('/api/auth/google/callback', endpoint(async (req, res) => {
    const state = cookie(req, stateCookie);
    res.clearCookie(stateCookie, cookieOptions);
    if (!state || typeof req.query.state !== 'string' || req.query.state !== state) return res.status(400).json({ error: 'Sign-in state did not match. Start sign-in again.' });
    const login = await store.consume(`login_${digest(state)}`);
    if (!login || login.type !== 'login' || login.expires <= now() || typeof req.query.code !== 'string') return res.status(400).json({ error: 'Sign-in expired or was cancelled. Start again.' });
    const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: login.verifier });
    if (!tokens.id_token) throw new Error('Missing identity token.');
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    const user = ticket.getPayload();
    if (!user || !user.sub || user.nonce !== login.nonce || user.email_verified !== true || user.email?.toLowerCase() !== config.email) return res.status(403).json({ error: 'This Google account is not approved for Peppy.' });
    const old = cookie(req, sessionCookie);
    if (old) await store.remove(`session_${digest(old)}`);
    const token = crypto.randomBytes(32).toString('hex');
    await store.put(`session_${digest(token)}`, { type: 'session', subject: user.sub, email: config.email, expires: now() + 8 * 60 * 60 * 1000 });
    res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
    res.redirect(config.origin);
  }));
  app.post('/api/auth/logout', endpoint(async (req, res) => {
    if (req.headers.origin !== config.origin) return res.status(403).json({ error: 'Cross-origin logout blocked.' });
    const token = cookie(req, sessionCookie);
    if (token) await store.remove(`session_${digest(token)}`);
    res.clearCookie(sessionCookie, cookieOptions);
    res.json({ signedIn: false });
  }));
  app.use('/api', endpoint(async (req, res, next) => {
    if (req.path === '/status' && req.method === 'GET') {
      const signedIn = Boolean(await identity(req));
      if (!signedIn) return res.json({ configured: false, authenticationRequired: true, signedIn: false });
      req.hostedSignedIn = true;
      return next();
    }
    const user = await identity(req);
    if (!user) return res.status(401).json({ error: 'Sign in with your approved Google account first.' });
    req.hostedIdentity = user;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.origin) return res.status(403).json({ error: 'Cross-origin hosted actions are blocked.' });
    next();
  }));
}

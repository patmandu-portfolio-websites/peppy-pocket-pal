import crypto from 'node:crypto';
import { validateSongDraft } from './songWorkshop.js';

const callbackOrigin = 'https://peppy-pocket-pal.onrender.com';
const callbackPath = '/api/music/suno/callback';
const statuses = new Set(['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS', 'SUCCESS', 'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED', 'CALLBACK_EXCEPTION', 'SENSITIVE_WORD_ERROR']);

export function installSunoCallback(app) {
  // Notifications are acknowledged, never trusted as task results or authorization.
  app.post(callbackPath, (_req, res) => res.status(204).end());
}

function publicAudioUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    url.hostname === 'localhost' || !url.hostname.includes('.') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(':')) throw new Error('Invalid audio URL.');
  return url.href;
}

export function sunoSongs(data) {
  const tracks = data.response?.sunoData ?? data.response?.data;
  if (!Array.isArray(tracks) || !tracks.length || tracks.length > 10) throw new Error('Missing song results.');
  return tracks.map(track => {
    if (typeof track.id !== 'string' || typeof track.title !== 'string' || typeof track.audio_url !== 'string') throw new Error('Invalid song result.');
    return { id: track.id.slice(0, 200), title: track.title.slice(0, 160), url: publicAudioUrl(track.audio_url) };
  });
}

export function installSuno(app, { getKey = () => process.env.SUNO_API_KEY, fetchImpl = fetch, now = Date.now } = {}) {
  const submissions = new Map();
  function owner(req) {
    return crypto.createHash('sha256').update(req.hostedIdentity?.subject || req.headers.cookie || req.socket.remoteAddress || '').digest('hex');
  }
  function prune() {
    for (const [id, item] of submissions) if (now() - item.created > 24 * 60 * 60 * 1000) submissions.delete(id);
  }
  async function provider(path, options = {}) {
    const key = getKey();
    if (!key) throw new Error('SunoAPI credentials unavailable.');
    const response = await fetchImpl(`https://api.sunoapi.org/api/v1/${path}`, {
      ...options, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('SunoAPI request failed.');
    const data = await response.json();
    if (data.code !== 200) throw new Error('SunoAPI rejected the request.');
    return data.data;
  }
  app.get('/api/music/suno/config', (_req, res) => res.set('Cache-Control', 'no-store').json({
    configured: Boolean(getKey()), model: 'V4_5PLUS', cost: 'Cost unavailable — generation uses paid provider credits.',
    callbackUrl: `${callbackOrigin}${callbackPath}`
  }));
  app.post('/api/music/suno/generate', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.hostedIdentity) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* Missing or invalid origins are rejected below. */ }
      if (!sameOrigin) {
        console.error('Cross-origin Suno generation blocked.');
        return res.status(403).json({ error: 'Open Peppy and approve song generation from its own page.' });
      }
    }
    let draft;
    try {
      draft = validateSongDraft(req.body?.draft);
      if (draft.title.length > 80 || draft.lyrics.length > 5000 ||
        req.body?.approved !== true || !/^[a-f0-9-]{36}$/i.test(req.body?.requestId || '')) throw new Error('Invalid approval.');
    } catch {
      console.error('Suno generation rejected invalid approval or draft.');
      return res.status(400).json({ error: 'Review a title of 1-80 characters, lyrics of 1-5000 and style of 1-1000, then explicitly approve generation.' });
    }
    if (!getKey()) return res.status(503).json({ error: 'Configure SUNO_API_KEY on this server and restart before generating audio.' });
    prune();
    const id = `${owner(req)}:${req.body.requestId}`;
    const fingerprint = JSON.stringify(draft);
    let submission = submissions.get(id);
    if (submission && submission.fingerprint !== fingerprint) return res.status(409).json({ error: 'This approval already belongs to a different draft.' });
    if (!submission) {
      if (submissions.size >= 100) return res.status(429).json({ error: 'Song task capacity reached. Try later.' });
      submission = { created: now(), fingerprint };
      submissions.set(id, submission);
      submission.promise = (async () => {
        try {
          const result = await provider('generate', { method: 'POST', body: JSON.stringify({
            prompt: draft.lyrics, style: draft.style, title: draft.title,
            customMode: true, instrumental: false, model: 'V4_5PLUS',
            callBackUrl: `${callbackOrigin}${callbackPath}`
          }) });
          if (typeof result?.taskId !== 'string' || !/^[a-z0-9_-]{1,200}$/i.test(result.taskId)) throw new Error('Invalid task ID.');
          submission.taskId = result.taskId;
          return { task: { requestId: req.body.requestId, status: 'PENDING', songs: [] } };
        } catch {
          console.error('Suno generation submission failed; outcome may be unknown.');
          return { error: 'Song submission could not be confirmed. It may already have used credits. Check your SunoAPI dashboard; do not automatically retry or approve again.' };
        }
      })();
    }
    const result = await submission.promise;
    res.status(result.error ? 502 : 202).json(result);
  });
  app.get('/api/music/suno/tasks/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    prune();
    const submission = submissions.get(`${owner(req)}:${req.params.id}`);
    if (!submission?.taskId) return res.status(404).json({ error: 'Song task is unavailable here (it may have expired or the server restarted). Check the SunoAPI dashboard; do not regenerate automatically.' });
    try {
      const data = await provider(`generate/record-info?taskId=${encodeURIComponent(submission.taskId)}`);
      if (data?.taskId !== submission.taskId || !statuses.has(data.status)) throw new Error('Invalid task result.');
      res.json({ task: { requestId: req.params.id, status: data.status,
        songs: ['FIRST_SUCCESS', 'SUCCESS'].includes(data.status) ? sunoSongs(data) : [] } });
    } catch {
      console.error('Suno task lookup failed.');
      res.status(502).json({ error: 'Could not check song progress. Generation may still be running; refresh status, not generation.' });
    }
  });
}

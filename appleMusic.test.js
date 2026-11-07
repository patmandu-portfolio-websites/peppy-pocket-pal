import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { chromium } from 'playwright';
import { findAppleSongs, installAppleMusic } from './appleMusicServer.js';
import { parseMusicCommand } from './appleMusic.js';

const song = { trackId: 123, trackName: 'Hello', artistName: 'Adele', collectionName: '25',
  trackViewUrl: 'https://music.apple.com/nz/album/hello/1051331933?i=123' };

test('public Apple catalog search needs no credentials and returns safe song links', async () => {
  const songs = await findAppleSongs('Hello Adele', 'NZ', async (url, options) => {
    assert.equal(url.origin, 'https://itunes.apple.com');
    assert.equal(url.searchParams.get('term'), 'Hello Adele');
    assert.equal(url.searchParams.get('entity'), 'song');
    assert.equal(url.searchParams.get('country'), 'NZ');
    assert.equal(options.headers, undefined);
    return Response.json({ results: [song] });
  });
  assert.deepEqual(songs, [{ id: '123', name: 'Hello', artist: 'Adele', album: '25', url: song.trackViewUrl }]);
  assert.deepEqual(await findAppleSongs('missing', 'NZ', async () => Response.json({ results: [] })), []);
  for (const trackViewUrl of ['javascript:alert(1)', 'https://evil.example/song', 'https://user:pass@music.apple.com/song']) {
    await assert.rejects(() => findAppleSongs('Hello', 'NZ', async () => Response.json({ results: [{ ...song, trackViewUrl }] })));
  }
  await assert.rejects(() => findAppleSongs('Hello', 'NZ', async () => new Response('', { status: 429 })), /HTTP 429/);
});

test('music search route validates input, surfaces failures and has no token endpoint', async t => {
  const app = express();
  let calls = 0;
  installAppleMusic(app, { fetchImpl: async () => { calls++; return Response.json({ results: [song] }); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/music/search?q=&country=NZ`)).status, 400);
  assert.equal(calls, 0);
  const response = await fetch(`${base}/api/music/search?q=Hello&country=NZ`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).songs[0].url, song.trackViewUrl);
  assert.equal((await fetch(`${base}/api/music/token`)).status, 404);
});

test('song commands find links while playback commands are manual only', () => {
  for (const verb of ['find', 'search for', 'play']) {
    assert.deepEqual(parseMusicCommand(`Peppy, ${verb} Hello by Adele on Apple Music.`), { action: 'search', query: 'Hello Adele' });
  }
  for (const verb of ['pause', 'resume', 'skip']) assert.deepEqual(parseMusicCommand(`Peppy, ${verb}`), { action: 'manual' });
  assert.equal(parseMusicCommand('Tell me about music'), null);
  assert.equal(parseMusicCommand('Peppy, pause and delete files'), null);
});

test('desktop and phone song searches show clickable links without sign-in or playback', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const app = express();
  app.use(express.json());
  const chats = [];
  app.get('/api/status', (_req, res) => res.json({ configured: true }));
  installAppleMusic(app, { fetchImpl: async () => Response.json({ results: [song] }) });
  app.post('/api/chat', (req, res) => { chats.push(req.body); res.json({ reply: 'Normal reply' }); });
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const outside = [];
    await page.route('**/*', route => {
      if (route.request().url().startsWith(base)) return route.continue();
      outside.push(route.request().url());
      return route.abort();
    });
    await page.goto(base);
    const input = page.getByRole('textbox', { name: 'Your message', exact: true });
    await input.fill('Peppy, play Hello by Adele on Apple Music');
    await input.press('Enter');
    const link = page.getByRole('link', { name: 'Open Hello in Apple Music', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), song.trackViewUrl);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(outside.some(url => url.includes('music.apple.com')), false, 'Search must not load MusicKit or open Apple Music');
    assert.equal(await page.locator('audio,video').count(), 0);
    await input.fill('Peppy, pause');
    await input.press('Enter');
    await page.getByText(/Peppy cannot control Apple Music playback/).waitFor();
    await input.fill('Hi Peppy');
    await input.press('Enter');
    await page.getByText('Normal reply', { exact: true }).waitFor();
    assert.deepEqual(chats.at(-1).messages, [{ role: 'user', content: 'Hi Peppy' }]);
    await page.getByLabel('Song or artist', { exact: true }).fill('Hello Adele');
    await page.getByRole('button', { name: 'Find songs on Apple Music', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Found 1 song' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
});

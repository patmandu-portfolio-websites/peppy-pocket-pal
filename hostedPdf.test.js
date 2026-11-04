import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { CloudPdfStore, pdfService, installPdfRoutes, installPdfCleanup } from './hostedPdf.js';
import path from 'node:path';
import { chromium } from 'playwright';

async function fixture() {
  const jobs = new Map();
  const objects = new Map();
  let time = Date.now();
  let healthy = true;
  const store = {
    healthy: async () => healthy,
    heartbeat: async () => { healthy = true; },
    removeOrphans: async () => {},
    put: async (id, value) => jobs.set(id, structuredClone(value)),
    get: async id => jobs.has(id) ? structuredClone(jobs.get(id)) : null,
    update: async (id, value) => {
      if (!jobs.has(id)) throw new Error('Missing job');
      Object.assign(jobs.get(id), structuredClone(value));
    },
    claim: async (id, owner, now) => {
      const value = jobs.get(id);
      if (!value || value.owner !== owner || value.expires <= now || value.status !== 'ready') throw new Error('Unavailable');
      const before = structuredClone(value);
      value.status = 'busy';
      return before;
    },
    release: async (id, failed) => {
      const value = jobs.get(id);
      if (value?.status === 'busy') value.status = failed ? 'failed' : 'ready';
    },
    write: async (id, name, bytes) => {
      const key = `${id}/${name}`;
      if (objects.has(key)) throw new Error('Existing object');
      objects.set(key, Buffer.from(bytes));
    },
    read: async (id, name) => {
      const bytes = objects.get(`${id}/${name}`);
      if (!bytes) throw new Error('Missing object');
      return Buffer.from(bytes);
    },
    remove: async (id, owner) => {
      const value = jobs.get(id);
      if (!value || (owner !== undefined && (value.owner !== owner || !['ready', 'failed', 'deleting'].includes(value.status)))) throw new Error('Unavailable or busy');
      value.status = 'deleting';
      jobs.delete(id);
      for (const key of objects.keys()) if (key.startsWith(`${id}/`)) objects.delete(key);
    },
    expired: async now => [...jobs].filter(([, value]) => value.expires <= now).map(([id]) => id),
    list: async owner => [...jobs].filter(([, value]) => value.owner === owner).map(([id, value]) => ({ id, ...value }))
  };
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  doc.getForm().createTextField('Name').addToPage(page);
  const input = Buffer.from(await doc.save());
  return { service: pdfService(store, () => time), store, input, jobs, objects, advance: ms => { time += ms; }, unhealthy: () => { healthy = false; } };
}

test('hosted PDF approval creates separate output, protects owners and supports recovery/deletion', async () => {
  const { service, input } = await fixture();
  const job = await service.upload('owner', input);
  assert.equal(job.fields[0].name, 'Name');
  await assert.rejects(service.bytes('other', job.id, 'input'), /unavailable/);
  assert.deepEqual(await service.list('other'), []);
  await assert.rejects(service.remove('other', job.id));
  const proposal = await service.propose('owner', job.id, { Name: 'Example' });
  await assert.rejects(service.bytes('owner', job.id, 'output'));
  await assert.rejects(service.fill('owner', job.id, 'wrong'));
  await service.fill('owner', job.id, proposal.id);
  const output = await PDFDocument.load(await service.bytes('owner', job.id, 'output'));
  assert.equal(output.getForm().getTextField('Name').getText(), 'Example');
  assert.deepEqual(await service.bytes('owner', job.id, 'input'), input);
  assert.equal((await service.inspect('owner', job.id)).hasOutput, true);
  await assert.rejects(service.fill('owner', job.id, proposal.id));
  await service.remove('owner', job.id);
  await assert.rejects(service.bytes('owner', job.id, 'input'));
});

test('fill excludes concurrent owner deletion and uncertain output cannot be filled again', async () => {
  const { service, store, input, jobs, objects } = await fixture();
  const job = await service.upload('owner', input);
  const proposal = await service.propose('owner', job.id, { Name: 'Example' });
  const write = store.write;
  store.write = async (...args) => {
    await assert.rejects(service.remove('owner', job.id), /busy/);
    await write(...args);
    throw new Error('Response lost after write');
  };
  await assert.rejects(service.fill('owner', job.id, proposal.id), /Response lost/);
  assert.equal(jobs.get(job.id).status, 'failed');
  assert.equal(objects.has(`${job.id}/output`), true);
  await assert.rejects(service.fill('owner', job.id, proposal.id), /unavailable/);
  await service.remove('owner', job.id);
  assert.equal(objects.size, 0);
});

test('hosted non-fillable overlays preserve input and enforce ownership, limits and proposal expiry', async () => {
  const { service, advance, jobs } = await fixture();
  const document = await PDFDocument.create();
  document.addPage([400, 500]);
  const input = Buffer.from(await document.save());
  const job = await service.upload('owner', input);
  const overlays = [{ page: 1, x: 0.1, y: 0.2, size: 12, text: 'Cloud overlay' }];
  await assert.rejects(service.propose('other', job.id, {}, overlays), /unavailable/);
  await assert.rejects(service.propose('owner', job.id, {}, [{ ...overlays[0], x: 0.99 }]), /outside/);
  assert.equal(jobs.get(job.id).proposal, undefined);
  let proposal = await service.propose('owner', job.id, {}, overlays);
  advance(6 * 60 * 1000);
  await assert.rejects(service.fill('owner', job.id, proposal.id), /expired/);
  proposal = await service.propose('owner', job.id, {}, overlays);
  assert.deepEqual(proposal.overlays, overlays);
  await service.fill('owner', job.id, proposal.id);
  assert.deepEqual(await service.bytes('owner', job.id, 'input'), input);
  assert.notDeepEqual(await service.bytes('owner', job.id, 'output'), input);
  assert.deepEqual((await service.inspect('owner', job.id)).fields, []);
  await assert.rejects(service.fill('owner', job.id, proposal.id));
});

test('cleanup handles expired writes after job metadata removal without resurrecting a job', async () => {
  const { service, store, input, advance, jobs, objects } = await fixture();
  const job = await service.upload('owner', input);
  const proposal = await service.propose('owner', job.id, { Name: 'Example' });
  const write = store.write;
  store.write = async (...args) => {
    advance(24 * 60 * 60 * 1000);
    await service.cleanup();
    await write(...args);
  };
  await assert.rejects(service.fill('owner', job.id, proposal.id), /Missing job/);
  assert.equal(jobs.size, 0);
  assert.equal(objects.has(`${job.id}/output`), true);
  let deleted = 0;
  const bucket = {
    async *getFilesStream() {
      yield { metadata: { metadata: { expires: String(job.expires) } }, delete: async () => { deleted++; objects.clear(); } };
      yield { metadata: { metadata: { expires: String(Date.now() + 48 * 60 * 60 * 1000) } }, delete: async () => assert.fail('Deleted unexpired input') };
    }
  };
  const cloud = new CloudPdfStore({ collection: () => ({}) }, bucket);
  await cloud.removeOrphans(Date.now() + 24 * 60 * 60 * 1000);
  assert.equal(deleted, 1);
  assert.equal(objects.size, 0);
});

test('cleanup health gates uploads, approvals expire, expiry blocks access and deletion failures surface', async () => {
  const { service, store, input, advance, unhealthy } = await fixture();
  unhealthy();
  await assert.rejects(service.upload('owner', input), /cleanup/);
  await service.cleanup();
  const job = await service.upload('owner', input);
  const proposal = await service.propose('owner', job.id, { Name: 'value' });
  advance(6 * 60 * 1000);
  await assert.rejects(service.fill('owner', job.id, proposal.id), /expired/);
  advance(23 * 60 * 60 * 1000);
  await assert.rejects(service.bytes('owner', job.id, 'input'), /expired/);
  const remove = store.remove;
  store.remove = async () => { throw new Error('Unavailable'); };
  await assert.rejects(service.cleanup(), /could not be deleted/);
  store.remove = remove;
  assert.equal((await service.cleanup()).deleted, 1);
});

test('interrupted uploads clean registered objects and reject non-PDF content', async () => {
  const { service, store, input, jobs, objects } = await fixture();
  await assert.rejects(service.upload('owner', Buffer.from('not pdf')));
  const update = store.update;
  store.update = async () => { throw new Error('Injected failure'); };
  await assert.rejects(service.upload('owner', input), /Injected/);
  assert.equal(jobs.size, 0);
  assert.equal(objects.size, 0);
  store.update = update;
});

test('hosted PDF routes stay disabled until explicitly enabled and require edit approval', async t => {
  const { service, input } = await fixture();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.hostedIdentity = { subject: 'owner' }; next(); });
  const disabled = express.Router();
  installPdfRoutes(disabled, service, false);
  app.use('/disabled', disabled);
  installPdfRoutes(app, service, true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/pdf`;
  const disabledStatus = await fetch(`http://127.0.0.1:${server.address().port}/disabled/api/pdf/status`);
  assert.equal((await disabledStatus.json()).enabled, false);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/disabled/api/pdf`, { method: 'POST' })).status, 503);
  const oversized = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.alloc(10 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /10 MiB/);
  const uploaded = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: input });
  assert.equal(uploaded.status, 200);
  const job = await uploaded.json();
  const denied = await fetch(`${base}/${job.id}/fill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 400);
  const bytes = await fetch(`${base}/${job.id}/input`);
  assert.match(bytes.headers.get('content-disposition'), /attachment/);
  assert.equal(bytes.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), input);
});

test('scheduler requires its own verified account and exact audience and reports cleanup failures', async t => {
  let payload = { email_verified: true, email: 'cleanup@example.test' };
  let calls = 0;
  let fail = false;
  const app = express();
  installPdfCleanup(app, {
    origin: 'https://peppy.example.test', account: 'cleanup@example.test',
    oauth: { verifyIdToken: async ({ idToken, audience }) => {
      assert.equal(audience, 'https://peppy.example.test/api/maintenance/pdf-cleanup');
      if (idToken !== 'valid') throw new Error('Rejected token/audience');
      return { getPayload: () => payload };
    } },
    service: { cleanup: async () => { calls++; if (fail) throw new Error('Storage unavailable'); return { deleted: 1 }; } }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/maintenance/pdf-cleanup`;
  const invoke = token => fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await invoke()).status, 403);
  assert.equal((await invoke('invalid')).status, 403);
  payload = { email_verified: true, email: 'other@example.test' };
  assert.equal((await invoke('valid')).status, 403);
  payload = { email_verified: false, email: 'cleanup@example.test' };
  assert.equal((await invoke('valid')).status, 403);
  assert.equal(calls, 0);
  payload.email_verified = true;
  const success = await invoke('valid');
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { deleted: 1 });
  fail = true;
  assert.equal((await invoke('valid')).status, 503);
});

test('built hosted PDF UI uploads, previews, fills and deletes using explicit buttons', async t => {
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Build first and set PEPPY_PDF_UI_TEST=1.');
  const { service, input } = await fixture();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.hostedIdentity = { subject: 'owner' }; next(); });
  app.get('/api/status', (_req, res) => res.json({ configured: true, authenticationRequired: true, signedIn: true }));
  installPdfRoutes(app, service, true);
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', cause => errors.push(cause.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  await page.getByText('Private hosted PDF forms', { exact: true }).click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const composer = document.querySelector('.composer');
      const panel = document.querySelector('.pdf-panel');
      return {
        ordered: Boolean(composer.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING),
        separated: composer.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        radius: getComputedStyle(panel).borderRadius
      };
    });
    assert.equal(layout.ordered, true);
    assert.equal(layout.separated, true);
    assert.equal(layout.overflow, false);
    assert.equal(layout.radius, '17px');
  }
  await page.getByLabel('Select PDF to upload').setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: input });
  await page.getByRole('button', { name: 'Approve uploading selected PDF' }).click();
  await page.getByLabel('Exact PDF field values as JSON').fill('{"Name":"Hosted answer"}');
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c && c.width > 100 && c.getContext('2d').getImageData(0, 0, 1, 1).data[3] > 0;
  });
  const before = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.getByRole('button', { name: 'Preview proposed changes' }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Review PDF changes before saving');
  const approvalBounds = await page.getByRole('heading', { name: 'Review PDF changes before saving', exact: true }).boundingBox();
  assert.ok(approvalBounds.y >= 65 && approvalBounds.y + approvalBounds.height <= 900,
    `Approval heading must be visible below the header: ${JSON.stringify(approvalBounds)}`);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: 'Approve filling new copy' }).click();
  await page.getByRole('link', { name: 'Download reviewed output PDF' }).waitFor();
  await page.waitForFunction(image => {
    const c = document.querySelector('canvas');
    return c && c.width > 100 && c.getContext('2d').getImageData(0, 0, 1, 1).data[3] > 0 && c.toDataURL() !== image;
  }, before);
  await page.getByRole('button', { name: 'Delete input and output now' }).click();
  await page.getByRole('button', { name: 'Approve uploading selected PDF' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('canvas'));
  assert.deepEqual(await service.list('owner'), []);
  const flat = await PDFDocument.create();
  flat.addPage([400, 500]);
  const flatInput = Buffer.from(await flat.save());
  await page.getByLabel('Select PDF to upload').setInputFiles({ name: 'flat.pdf', mimeType: 'application/pdf', buffer: flatInput });
  await page.getByRole('button', { name: 'Approve uploading selected PDF' }).click();
  await page.getByLabel('Place text on a non-fillable PDF', { exact: true }).check();
  await page.getByLabel('Text to place', { exact: true }).fill('Hosted overlay answer');
  const target = page.getByRole('button', { name: 'Place text on PDF page 1', exact: true });
  await target.waitFor();
  const bounds = await target.boundingBox();
  await target.click({ position: { x: bounds.width * 0.1, y: bounds.height * 0.2 } });
  await page.locator('.pdf-overlays text').waitFor();
  const blank = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole('button', { name: 'Preview proposed changes' }).click();
  await page.getByRole('button', { name: 'Approve filling new copy' }).click();
  await page.getByRole('link', { name: 'Download reviewed output PDF' }).waitFor();
  await page.waitForFunction(image => {
    const canvas = document.querySelector('canvas');
    return canvas && document.querySelector('.pdf-overlays') && canvas.toDataURL() !== image;
  }, blank, { timeout: 10000 });
  const overlayJob = (await service.list('owner'))[0];
  assert.deepEqual(await service.bytes('owner', overlayJob.id, 'input'), flatInput);
  assert.notDeepEqual(await service.bytes('owner', overlayJob.id, 'output'), flatInput);
  await page.getByRole('button', { name: 'Delete input and output now' }).click();
  await page.waitForFunction(() => !document.querySelector('canvas'));
  assert.deepEqual(await service.list('owner'), []);
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
});

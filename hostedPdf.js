import crypto from 'node:crypto';
import express from 'express';
import { PdfTools, maxPdfBytes } from './pdfTools.js';

const lifetime = 23 * 60 * 60 * 1000;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const engine = new PdfTools(null);

export class CloudPdfStore {
  constructor(database, bucket) { this.jobs = database.collection('peppy_pdf_jobs'); this.bucket = bucket; this.database = database; }
  async put(id, data) { await this.jobs.doc(id).create(data); }
  async get(id) { const result = await this.jobs.doc(id).get(); return result.exists ? result.data() : null; }
  async update(id, data) { await this.jobs.doc(id).update(data); }
  async claim(id, owner, now) {
    return this.database.runTransaction(async tx => {
      const ref = this.jobs.doc(id);
      const snap = await tx.get(ref);
      const item = snap.data();
      if (!item || item.owner !== owner || item.expires <= now || item.status !== 'ready') throw new Error('Document unavailable, expired or busy.');
      tx.update(ref, { status: 'busy' });
      return item;
    });
  }
  async release(id, failed) {
    await this.database.runTransaction(async tx => {
      const ref = this.jobs.doc(id);
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().status === 'busy') tx.update(ref, { status: failed ? 'failed' : 'ready' });
    });
  }
  async write(id, name, bytes, expires) {
    await this.bucket.file(`pdf/${id}/${name}.pdf`).save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/pdf', cacheControl: 'no-store', metadata: { expires: String(expires) } } });
  }
  async read(id, name) {
    const file = this.bucket.file(`pdf/${id}/${name}.pdf`);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > maxPdfBytes) throw new Error('Stored document exceeds size limit.');
    const [bytes] = await file.download();
    if (bytes.length > maxPdfBytes) throw new Error('Stored document exceeds size limit.');
    return bytes;
  }
  async remove(id, owner) {
    await this.database.runTransaction(async tx => {
      const ref = this.jobs.doc(id);
      const snap = await tx.get(ref);
      const item = snap.data();
      if (!item || (owner !== undefined && (item.owner !== owner || !['ready', 'failed', 'deleting'].includes(item.status)))) throw new Error('Document unavailable or busy.');
      tx.update(ref, { status: 'deleting' });
    });
    await this.bucket.deleteFiles({ prefix: `pdf/${id}/`, force: false });
    await this.jobs.doc(id).delete();
  }
  async expired(now) {
    const result = await this.jobs.where('expires', '<=', now).limit(100).get();
    return result.docs.map(doc => doc.id);
  }
  async list(owner) {
    const result = await this.jobs.where('owner', '==', owner).limit(100).get();
    return result.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  async healthy(now) {
    const result = await this.database.collection('peppy_pdf_operations').doc('cleanup').get();
    return result.exists && result.data().lastSuccess >= now - 20 * 60 * 1000;
  }
  async heartbeat(now) {
    await this.database.collection('peppy_pdf_operations').doc('cleanup').set({ lastSuccess: now });
  }
  async removeOrphans(now) {
    // Include late writes from interrupted/expired jobs even if metadata was removed.
    for await (const file of this.bucket.getFilesStream({ prefix: 'pdf/' })) {
      const expiry = Number(file.metadata.metadata?.expires);
      if (Number.isFinite(expiry) && expiry > 0 && expiry <= now) await file.delete({ ignoreNotFound: true });
    }
  }
}

export function pdfService(store, now = Date.now) {
  return {
    async upload(owner, bytes) {
      if (!(await store.healthy(now()))) throw new Error('Scheduled cleanup is not healthy. Uploads are blocked.');
      if (!Buffer.isBuffer(bytes) || bytes.length > maxPdfBytes || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Select a PDF no larger than 10 MiB.');
      const document = await engine.document(bytes);
      const id = crypto.randomUUID();
      const expires = now() + lifetime;
      // Register before writing so interrupted uploads are discoverable by cleanup.
      await store.put(id, { owner, expires, status: 'uploading', created: now() });
      try {
        await store.write(id, 'input', bytes, expires);
        await store.update(id, { status: 'ready', inputHash: digest(bytes) });
      } catch (error) {
        try { await store.remove(id); }
        catch { console.error('PDF upload cleanup failed; registered job requires scheduled cleanup.'); }
        throw error;
      }
      return { id, expires, pages: document.getPageCount(), fields: engine.fields(document) };
    },
    async get(owner, id) {
      if (!uuid.test(id)) throw new Error('Invalid document identifier.');
      const job = await store.get(id);
      if (!job || job.owner !== owner || job.expires <= now() || job.status !== 'ready') throw new Error('Document unavailable, expired or busy.');
      return job;
    },
    async propose(owner, id, values, overlays) {
      const job = await this.get(owner, id);
      if (job.outputHash) throw new Error('This job already has an output. Upload a new copy for another edit.');
      const text = JSON.stringify(values);
      if (!text || text.length > 32000) throw new Error('Field JSON is limited to 32000 characters.');
      if (overlays !== undefined && JSON.stringify(overlays).length > 32000) throw new Error('Overlay JSON is limited to 32000 characters.');
      const input = await store.read(id, 'input');
      const document = await engine.document(input);
      await engine.applyEdits(document, values, overlays);
      await document.save();
      const proposal = { id: crypto.randomUUID(), values, hash: digest(input), expires: now() + 5 * 60 * 1000 };
      if (overlays !== undefined) proposal.overlays = overlays;
      await store.update(id, { proposal });
      return proposal;
    },
    async list(owner) {
      const jobs = await store.list(owner);
      return jobs.map(({ id, expires, status, outputHash }) => ({ id, expires, status, hasOutput: Boolean(outputHash) }));
    },
    async inspect(owner, id) {
      const job = await this.get(owner, id);
      const document = await engine.document(await store.read(id, 'input'));
      return { id, expires: job.expires, fields: engine.fields(document), hasOutput: Boolean(job.outputHash) };
    },
    async fill(owner, id, proposalId) {
      await this.get(owner, id);
      const job = await store.claim(id, owner, now());
      let writeStarted = false;
      let completed = false;
      try {
        const proposal = job.proposal;
        if (!proposal || proposal.id !== proposalId || proposal.expires <= now() || job.outputHash) throw new Error('Approval expired or does not match. Request a new proposal.');
        // Consume before performing any write, even if later steps fail.
        await store.update(id, { proposal: null });
        const input = await store.read(id, 'input');
        if (digest(input) !== proposal.hash) throw new Error('Input changed after proposal.');
        const document = await engine.document(input);
        await engine.applyEdits(document, proposal.values, proposal.overlays);
        const output = Buffer.from(await document.save());
        if (output.length > maxPdfBytes) throw new Error('Output exceeds 10 MiB.');
        if (now() >= job.expires - 60000) throw new Error('Document is too close to expiry to edit.');
        writeStarted = true;
        await store.write(id, 'output', output, job.expires);
        await store.update(id, { outputHash: digest(output) });
        completed = true;
        return { fields: engine.fields(document), sha256: digest(output) };
      } finally { await store.release(id, writeStarted && !completed); }
    },
    async bytes(owner, id, name) {
      const job = await this.get(owner, id);
      if (!['input', 'output'].includes(name) || (name === 'output' && !job.outputHash)) throw new Error('Document version unavailable.');
      return store.read(id, name);
    },
    async remove(owner, id) {
      if (!uuid.test(id)) throw new Error('Invalid document identifier.');
      await store.remove(id, owner);
    },
    async cleanup() {
      const ids = await store.expired(now());
      let failed = 0;
      for (const id of ids) {
        try { await store.remove(id); }
        catch { failed++; console.error('Scheduled PDF deletion failed for a registered job.'); }
      }
      if (failed) throw new Error(`${failed} PDF jobs could not be deleted; retry required.`);
      await store.removeOrphans(now());
      if ((await store.expired(now())).length) throw new Error('Cleanup backlog remains; retry required.');
      await store.heartbeat(now());
      return { deleted: ids.length };
    }
  };
}

export function installPdfRoutes(app, service, enabled) {
  app.get('/api/pdf/status', (_req, res) => res.json({ enabled, retentionHours: 23 }));
  app.use('/api/pdf', (req, res, next) => enabled ? next() : res.status(503).json({ error: 'PDF uploads disabled until storage and independent cleanup are verified.' }));
  const endpoint = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    try { await handler(req, res); }
    catch {
      console.error('Hosted PDF operation failed.');
      res.status(400).json({ error: 'PDF operation failed: document may be unsupported, unavailable, expired, busy or storage inaccessible. No success is confirmed; retry inspection before editing.' });
    }
  };
  app.post('/api/pdf', express.raw({ type: 'application/pdf', limit: maxPdfBytes }), endpoint(async (req, res) => res.json(await service.upload(req.hostedIdentity.subject, req.body))));
  app.get('/api/pdf', endpoint(async (req, res) => res.json({ jobs: await service.list(req.hostedIdentity.subject) })));
  app.get('/api/pdf/:id', endpoint(async (req, res) => res.json(await service.inspect(req.hostedIdentity.subject, req.params.id))));
  app.post('/api/pdf/:id/propose', endpoint(async (req, res) => res.json(await service.propose(req.hostedIdentity.subject, req.params.id, req.body.values, req.body.overlays))));
  app.post('/api/pdf/:id/fill', endpoint(async (req, res) => {
    if (req.body.approved !== true) throw new Error('Explicit approval required.');
    res.json(await service.fill(req.hostedIdentity.subject, req.params.id, req.body.proposalId));
  }));
  app.get('/api/pdf/:id/:version', endpoint(async (req, res) => {
    const bytes = await service.bytes(req.hostedIdentity.subject, req.params.id, req.params.version);
    res.set('Content-Disposition', `attachment; filename="peppy-${req.params.version}.pdf"`);
    res.type('application/pdf').send(bytes);
  }));
  app.delete('/api/pdf/:id', endpoint(async (req, res) => { await service.remove(req.hostedIdentity.subject, req.params.id); res.json({ deleted: true }); }));
  app.use('/api/pdf', (error, _req, res, next) => {
    if (error.type !== 'entity.too.large') return next(error);
    res.status(413).set('Cache-Control', 'no-store').json({ error: 'PDF exceeds 10 MiB.' });
  });
}

export function installPdfCleanup(app, { service, oauth, account, origin }) {
  // Scheduler identity is separate from interactive Google sessions.
  app.post('/api/maintenance/pdf-cleanup', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const audience = `${origin}/api/maintenance/pdf-cleanup`;
    try {
      if (!service || !account || !req.headers.authorization?.startsWith('Bearer ')) return res.status(403).json({ error: 'Cleanup caller is not configured or authorized.' });
      const ticket = await oauth.verifyIdToken({ idToken: req.headers.authorization.slice(7), audience });
      const payload = ticket.getPayload();
      if (payload?.email_verified !== true || payload.email !== account) return res.status(403).json({ error: 'Unauthorized cleanup caller.' });
    } catch { return res.status(403).json({ error: 'Invalid cleanup identity.' }); }
    try { res.json(await service.cleanup()); }
    catch { console.error('PDF cleanup failed; scheduled retry required.'); res.status(503).json({ error: 'Cleanup incomplete; retry required.' }); }
  });
}

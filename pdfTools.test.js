import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { chromium } from 'playwright';
import express from 'express';
import { LocalPolicy } from './localPolicy.js';
import { LocalTools } from './localTools.js';
import { LocalAssistant } from './localAssistant.js';
import { maxPdfBytes } from './pdfTools.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.cwd(), 'peppy-pdf-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, 'inputs');
  const outputs = path.join(root, 'outputs');
  await fs.mkdir(inputs); await fs.mkdir(outputs);
  const policy = new LocalPolicy({ roots: [inputs, outputs], origins: [] });
  const tools = new LocalTools(policy, path.join(root, 'state'), { inputs, outputs });
  const document = await PDFDocument.create();
  const page = document.addPage();
  document.getForm().createTextField('Name').addToPage(page);
  document.getForm().createCheckBox('Agree').addToPage(page);
  const source = path.join(inputs, 'form.pdf');
  const original = Buffer.from(await document.save());
  await fs.writeFile(source, original);
  return { inputs, outputs, tools, source, original };
}

test('PDF inspection and approved filling preserve input and renderable field appearances', async t => {
  const { tools, source, outputs, original } = await fixture(t);
  const inspection = await tools.execute(await tools.prepare({ kind: 'inspect_pdf', path: source }));
  assert.equal(inspection.pages, 1);
  assert.equal(inspection.fields.length, 2);
  assert.ok(tools.pdf.previews.has(inspection.previewId));
  const destination = path.join(outputs, 'filled.pdf');
  const prepared = await tools.prepare({ kind: 'fill_pdf', path: source, destination, text: '{"Name":"Peppy","Agree":true}' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  const result = await tools.execute(prepared);
  const saved = await PDFDocument.load(await fs.readFile(destination));
  assert.equal(saved.getForm().getTextField('Name').getText(), 'Peppy');
  assert.equal(saved.getForm().getCheckBox('Agree').isChecked(), true);
  assert.ok(saved.getForm().getTextField('Name').acroField.getWidgets()[0].getNormalAppearance());
  assert.deepEqual(await fs.readFile(source), original);
  assert.equal(result.sha256.length, 64);
  const log = await fs.readFile(path.join(tools.stateDir, 'actions.jsonl'), 'utf8');
  assert.ok(!log.includes('"value":"Peppy"'), 'Logs omit form content');
});

test('PDF actions reject stale inputs, expired approvals, collisions and invalid fields', async t => {
  const { tools, source, outputs, inputs } = await fixture(t);
  const action = { kind: 'fill_pdf', path: source, destination: path.join(outputs, 'new.pdf'), text: '{"Name":"ok"}' };
  for (const text of ['{}', '{"missing":"value"}', '{"Agree":"yes"}', '{"Name":"password=private"}']) {
    await assert.rejects(tools.prepare({ ...action, text }));
  }
  await assert.rejects(tools.prepare({ ...action, destination: path.join(inputs, 'wrong.pdf') }), /outputs/);
  await assert.rejects(tools.prepare({ ...action, destination: source }));
  const expired = await tools.prepare(action);
  expired.expires = 0;
  await assert.rejects(tools.execute(expired), /expired/);
  const collision = await tools.prepare(action);
  await fs.writeFile(action.destination, 'existing');
  await assert.rejects(tools.execute(collision), { code: 'EEXIST' });
  assert.equal(await fs.readFile(action.destination, 'utf8'), 'existing');
  const stale = await tools.prepare({ kind: 'inspect_pdf', path: source });
  await fs.appendFile(source, '\nchanged');
  await assert.rejects(tools.execute(stale), /changed after preview/);
});

test('PDF policy rejects invalid files, too many pages and signatures', async t => {
  const { tools, source } = await fixture(t);
  await fs.writeFile(source, 'not a PDF');
  await assert.rejects(tools.prepare({ kind: 'inspect_pdf', path: source }), /Invalid/);
  const document = await PDFDocument.create();
  for (let i = 0; i < 51; i++) document.addPage();
  await fs.writeFile(source, await document.save());
  await assert.rejects(tools.prepare({ kind: 'inspect_pdf', path: source }), /50 pages/);
  const signed = await PDFDocument.create();
  signed.addPage();
  const signature = signed.context.obj({ FT: 'Sig', T: 'Signature' });
  signed.getForm().acroForm.addField(signed.context.register(signature));
  await fs.writeFile(source, await signed.save());
  await assert.rejects(tools.prepare({ kind: 'inspect_pdf', path: source }), /Signature/);
  const xfa = await PDFDocument.create();
  xfa.addPage();
  xfa.getForm().acroForm.dict.set(PDFName.of('XFA'), xfa.context.obj('unsupported'));
  await fs.writeFile(source, await xfa.save({ updateFieldAppearances: false }));
  await assert.rejects(tools.prepare({ kind: 'inspect_pdf', path: source }), /XFA/);
});

test('PDF limits enforce exact byte/field thresholds and reject read-only and unsupported text edits', async t => {
  const { tools, source, outputs } = await fixture(t);
  await fs.writeFile(source, Buffer.alloc(maxPdfBytes + 1));
  await assert.rejects(tools.prepare({ kind: 'inspect_pdf', path: source }), /10 MiB/);
  const oversizedForm = await PDFDocument.create();
  oversizedForm.addPage();
  for (let i = 0; i < 201; i++) oversizedForm.getForm().createTextField(`Field ${i}`);
  await fs.writeFile(source, await oversizedForm.save());
  await assert.rejects(tools.prepare({ kind: 'inspect_pdf', path: source }), /200 fields/);
  const document = await PDFDocument.create();
  const page = document.addPage();
  const name = document.getForm().createTextField('Name');
  name.addToPage(page);
  name.enableReadOnly();
  await fs.writeFile(source, await document.save());
  const action = { kind: 'fill_pdf', path: source, destination: path.join(outputs, 'invalid.pdf'), text: '{"Name":"change"}' };
  await assert.rejects(tools.prepare(action), /read-only/);
  name.disableReadOnly();
  await fs.writeFile(source, await document.save());
  await assert.rejects(tools.prepare({ ...action, text: JSON.stringify({ Name: '\u4e2d' }) }), /encode/);
  await assert.rejects(fs.stat(action.destination), { code: 'ENOENT' });
});

test('PDF AI proposals require one-time matching approval and do not send results automatically', async t => {
  const { tools, source, outputs } = await fixture(t);
  const destination = path.join(outputs, 'approved.pdf');
  const assistant = new LocalAssistant(tools, () => ({ responses: { create: async () => ({
    output_text: '', output: [{ type: 'function_call', name: 'propose_action', call_id: 'pdf-call',
      arguments: JSON.stringify({ kind: 'fill_pdf', path: source, destination, text: '{"Name":"Approved"}' }) }]
  }) } }));
  const task = await assistant.start([{ role: 'user', content: 'Fill my form' }], '');
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  await assert.rejects(assistant.approve(task.sessionId, 'wrong', true), /does not match/);
  await assistant.approve(task.sessionId, task.pending.id, false);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  const next = await assistant.start([{ role: 'user', content: 'Fill my form' }], '');
  const result = await assistant.approve(next.sessionId, next.pending.id, true);
  assert.equal(result.canContinue, true);
  await assert.rejects(assistant.approve(next.sessionId, next.pending.id, true), /does not match/);
});

test('built PDF controls render approved source and filled output without sending data to AI', async t => {
  // Build-dependent browser validation is explicitly enabled after npm run build.
  if (process.env.PEPPY_PDF_UI_TEST !== '1') return t.skip('Run after build with PEPPY_PDF_UI_TEST=1.');
  const { tools, source, outputs } = await fixture(t);
  const app = express();
  app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ configured: true, localAssistant: true }));
  app.get('/api/local/config', (_req, res) => res.json({ roots: tools.policy.roots, origins: [] }));
  app.get('/api/local/gmail/status', (_req, res) => res.json({ connected: false, enabled: false, preview: false }));
  const pending = new Map();
  app.post('/api/local/pdf/propose', async (req, res) => {
    try {
      const prepared = await tools.prepare(req.body);
      pending.set(prepared.id, prepared);
      res.json({ id: prepared.id, action: prepared.action });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/local/pdf/approval', async (req, res) => {
    try {
      const prepared = pending.get(req.body.id);
      pending.delete(req.body.id);
      res.json(req.body.approved ? await tools.execute(prepared) : { declined: true });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get('/api/local/pdf/preview/:id', (req, res) => res.type('application/pdf').send(tools.pdf.previews.get(req.params.id).bytes));
  app.use(express.static(path.join(process.cwd(), 'dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const address = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(address) ? route.continue() : route.abort());
  await page.goto(address);
  await page.getByText('Learning, knowledge and improvement suggestions', { exact: true }).click();
  await page.getByLabel('Proposal title').fill('Jazz preference');
  await page.getByLabel('Selected evidence or note').fill('I like jazz.');
  await page.getByLabel('Source (HTTPS URL for knowledge)').fill('User note');
  await page.getByRole('button', { name: 'Preview my proposed entry' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('peppy-learning-v1')), null);
  await page.getByRole('button', { name: 'Approve saving locally' }).click();
  let learning = await page.evaluate(() => JSON.parse(localStorage.getItem('peppy-learning-v1')));
  assert.equal(learning.entries[0].included, false);
  await page.getByLabel('Authorize this entry in AI chat context').check();
  await page.reload();
  await page.getByText('Learning, knowledge and improvement suggestions', { exact: true }).click();
  assert.equal(await page.getByLabel('Authorize this entry in AI chat context').isChecked(), true);
  await page.getByRole('button', { name: 'Delete entry and history' }).click();
  learning = await page.evaluate(() => JSON.parse(localStorage.getItem('peppy-learning-v1')));
  assert.equal(learning.entries.length, 0);
  await page.getByText('PDF inspection and form filling — experimental', { exact: true }).click();
  await page.getByLabel('Absolute input PDF path').fill(source);
  await page.getByRole('button', { name: 'Propose PDF inspection' }).click();
  await page.getByRole('button', { name: 'Approve PDF action' }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas || canvas.width < 100) return false;
    return canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3] > 0;
  });
  const originalImage = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  const destination = path.join(outputs, 'ui-filled.pdf');
  await page.getByLabel('Absolute new output PDF path').fill(destination);
  await page.getByLabel('Exact form fields as JSON').fill('{"Name":"Visible answer","Agree":true}');
  await page.getByRole('button', { name: 'Propose filling a new copy' }).click();
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  await page.getByRole('button', { name: 'Approve PDF action' }).click();
  await page.getByText('Visible answer', { exact: false }).first().waitFor();
  await page.waitForFunction(before => {
    const canvas = document.querySelector('canvas');
    return canvas && canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3] > 0 && canvas.toDataURL() !== before;
  }, originalImage);
  const saved = await PDFDocument.load(await fs.readFile(destination));
  assert.equal(saved.getForm().getTextField('Name').getText(), 'Visible answer');
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
});

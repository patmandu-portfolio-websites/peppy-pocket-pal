import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFDocument, PDFName, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, PDFSignature } from 'pdf-lib';
import { inside, containsCredentials } from './localPolicy.js';

export const maxPdfBytes = 10 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export class PdfTools {
  constructor(policy, { inputs, outputs } = {}) {
    this.policy = policy;
    this.inputs = inputs;
    this.outputs = outputs;
    this.previews = new Map();
  }

  async read(file) {
    const resolved = await this.policy.resolve(file);
    if (path.extname(resolved).toLowerCase() !== '.pdf') throw new Error('Select a PDF file.');
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > maxPdfBytes) throw new Error('PDF input must be a regular file no larger than 10 MiB.');
    const bytes = await fs.readFile(resolved);
    if (bytes.length > maxPdfBytes || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Invalid or oversized PDF.');
    return bytes;
  }

  async document(bytes) {
    const document = await PDFDocument.load(bytes);
    if (document.getPageCount() > 50) throw new Error('PDFs are limited to 50 pages.');
    // getForm() removes XFA silently, so reject it before accessing the form.
    if (document.catalog.getAcroForm()?.dict.has(PDFName.of('XFA'))) throw new Error('XFA forms are not supported. Use a standard AcroForm PDF.');
    const form = document.getForm();
    if (form.getFields().length > 200) throw new Error('PDF forms are limited to 200 fields.');
    if (form.getFields().some(field => field instanceof PDFSignature)) throw new Error('Signature-bearing PDFs are not supported; editing can invalidate signatures.');
    return document;
  }

  fields(document) {
    return document.getForm().getFields().map(field => {
      const base = { name: field.getName(), readOnly: field.isReadOnly() };
      if (field instanceof PDFTextField) return { ...base, type: 'text', value: field.getText() || '' };
      if (field instanceof PDFCheckBox) return { ...base, type: 'checkbox', value: field.isChecked() };
      if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { ...base, type: 'choice', value: field.getSelected(), options: field.getOptions() };
      if (field instanceof PDFRadioGroup) return { ...base, type: 'radio', value: field.getSelected() || '', options: field.getOptions() };
      return { ...base, type: 'unsupported' };
    });
  }

  apply(document, values) {
    if (!values || Array.isArray(values) || typeof values !== 'object' || !Object.keys(values).length || Object.keys(values).length > 200) throw new Error('Provide a nonempty JSON object of exact field names and values.');
    for (const [name, value] of Object.entries(values)) {
      const field = document.getForm().getField(name);
      if (field.isReadOnly()) throw new Error(`Field is read-only: ${name}`);
      if (field instanceof PDFCheckBox && typeof value === 'boolean') {
        if (value) field.check(); else field.uncheck();
      } else if (typeof value === 'string' && value.length <= 2000 && !containsCredentials(value)) {
        if (field instanceof PDFTextField) field.setText(value);
        else if ((field instanceof PDFDropdown || field instanceof PDFRadioGroup || field instanceof PDFOptionList) && field.getOptions().includes(value)) field.select(value);
        else throw new Error(`Unsupported field or invalid option: ${name}`);
      } else throw new Error(`Invalid or credential-bearing value: ${name}`);
    }
  }

  async prepare(action) {
    const source = await this.policy.resolve(action.path);
    if (this.inputs && !inside(this.inputs, source)) throw new Error('PDF inputs must be inside the guest inputs folder.');
    const bytes = await this.read(source);
    const document = await this.document(bytes);
    const prepared = { path: source, hash: hash(bytes) };
    if (action.kind === 'fill_pdf') {
      prepared.destination = await this.policy.resolve(action.destination, { missing: true, mutate: true });
      if (path.extname(prepared.destination).toLowerCase() !== '.pdf' || source === prepared.destination) throw new Error('Save to a different, new PDF destination.');
      if (this.outputs && !inside(this.outputs, prepared.destination)) throw new Error('Filled PDFs must be saved inside the guest outputs folder.');
      try { await fs.lstat(prepared.destination); throw new Error('PDF destination already exists.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (typeof action.text !== 'string' || action.text.length > 32000) throw new Error('Provide PDF field values as JSON text, up to 32000 characters.');
      this.apply(document, JSON.parse(action.text));
      // Generate appearances before approval so unsupported text fails without writing.
      await document.save();
    }
    return prepared;
  }

  preview(bytes) {
    for (const [id, item] of this.previews) if (item.expires < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 10) throw new Error('Close/restart the companion to clear PDF previews (maximum 10).');
    const id = crypto.randomUUID();
    this.previews.set(id, { bytes: Buffer.from(bytes), expires: Date.now() + 30 * 60 * 1000 });
    return id;
  }

  async execute(prepared) {
    const bytes = await this.read(prepared.path);
    if (hash(bytes) !== prepared.hash) throw new Error('PDF changed after preview. Request a new approval.');
    const document = await this.document(bytes);
    let output = bytes;
    if (prepared.action.kind === 'fill_pdf') {
      this.apply(document, JSON.parse(prepared.action.text));
      output = await document.save();
      if (output.length > maxPdfBytes) throw new Error('Generated PDF exceeds 10 MiB.');
    }
    const previewId = this.preview(output);
    try {
      if (prepared.action.kind === 'fill_pdf') {
        await this.policy.resolve(prepared.destination, { missing: true, mutate: true });
        await fs.writeFile(prepared.destination, output, { flag: 'wx', mode: 0o600 });
      }
    } catch (error) { this.previews.delete(previewId); throw error; }
    return { path: prepared.destination || prepared.path, pages: document.getPageCount(), fields: this.fields(document), sha256: hash(output), previewId, note: 'Review every rendered page. Original untouched. No export, signing, OCR or website submission. PDF text extraction is not available.' };
  }
}

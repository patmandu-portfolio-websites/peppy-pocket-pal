import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFDocument, PDFName, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, PDFSignature, StandardFonts, degrees } from 'pdf-lib';
import { inside, containsCredentials } from './localPolicy.js';

export const maxPdfBytes = 10 * 1024 * 1024;
export const maxPdfImageBytes = 512 * 1024;
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

  async applyEdits(document, values, overlays) {
    if (overlays === undefined) { this.apply(document, values); return; }
    if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error('Provide field values as a JSON object.');
    if (Object.keys(values).length) this.apply(document, values);
    if (!Array.isArray(overlays) || !overlays.length || overlays.length > 100) throw new Error('Provide between 1 and 100 text/image overlays.');
    const font = await document.embedFont(StandardFonts.Helvetica);
    let imageBytes = 0;
    let imageCount = 0;
    for (const item of overlays) {
      const isImage = item?.type === 'image';
      if (!item || !Number.isInteger(item.page) || item.page < 1 || item.page > document.getPageCount() ||
          !Number.isFinite(item.x) || !Number.isFinite(item.y) || item.x < 0 || item.y < 0 || item.x > 1 || item.y > 1 ||
          (!isImage && (!Number.isFinite(item.size) || item.size < 6 || item.size > 48 ||
          typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 ||
          /[\r\n\t\u0000-\u001f\u007f]/.test(item.text) || containsCredentials(item.text)))) {
        throw new Error('Invalid text overlay: select a page, position, single-line text (up to 500 characters) and size 6-48 pt. Credentials are not allowed.');
      }
      const page = document.getPage(item.page - 1);
      const crop = page.getCropBox();
      const media = page.getMediaBox();
      // PDF.js displays the intersection of CropBox and MediaBox.
      const left = Math.max(crop.x, media.x);
      const bottom = Math.max(crop.y, media.y);
      const width = Math.min(crop.x + crop.width, media.x + media.width) - left;
      const height = Math.min(crop.y + crop.height, media.y + media.height) - bottom;
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rotation) || width <= 0 || height <= 0) throw new Error('Unsupported PDF page geometry.');
      const viewWidth = rotation % 180 ? height : width;
      const viewHeight = rotation % 180 ? width : height;
      const x = item.x * viewWidth;
      const y = item.y * viewHeight;
      if (isImage) {
        if (!Number.isFinite(item.width) || !Number.isFinite(item.height) || item.width <= 0 || item.height <= 0 ||
            item.x + item.width > 1 || item.y + item.height > 1) throw new Error('Image overlay must fit inside the page with a positive width and height.');
        const match = typeof item.data === 'string' && /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.data);
        if (!match || match[2].length > Math.ceil(maxPdfImageBytes / 3) * 4) throw new Error('PDF image overlays require PNG/JPEG, up to 512 KiB combined.');
        const bytes = Buffer.from(match[2], 'base64');
        imageBytes += bytes.length;
        if (++imageCount > 10 || imageBytes > maxPdfImageBytes || bytes.toString('base64') !== match[2]) throw new Error('Use up to 10 PDF images and 512 KiB combined.');
        const embedded = match[1] === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
        if (embedded.width * embedded.height > 16000000) throw new Error('PDF images are limited to 16 megapixels.');
        const imageHeight = item.height * viewHeight;
        const lower = y + imageHeight;
        const position = rotation === 0 ? { x: left + x, y: bottom + height - lower } :
          rotation === 90 ? { x: left + lower, y: bottom + x } :
          rotation === 180 ? { x: left + width - x, y: bottom + lower } :
          { x: left + width - lower, y: bottom + height - x };
        page.drawImage(embedded, { ...position, width: item.width * viewWidth, height: imageHeight, rotate: degrees(rotation) });
        continue;
      }
      const textWidth = font.widthOfTextAtSize(item.text, item.size);
      if (x + textWidth > viewWidth || y + item.size * 1.25 > viewHeight) throw new Error('Overlay text extends outside the page. Move it or reduce its font size.');
      const baseline = y + item.size;
      const position = rotation === 0 ? { x: left + x, y: bottom + height - baseline } :
        rotation === 90 ? { x: left + baseline, y: bottom + x } :
        rotation === 180 ? { x: left + width - x, y: bottom + baseline } :
        { x: left + width - baseline, y: bottom + height - x };
      page.drawText(item.text, { ...position, size: item.size, font, rotate: degrees(rotation) });
    }
  }

  async prepare(action) {
    const source = await this.policy.resolve(action.path);
    if (this.inputs && !inside(this.inputs, source)) throw new Error('PDF inputs must be inside the guest inputs folder.');
    const bytes = await this.read(source);
    if (action.overlays !== undefined && action.inputHash !== hash(bytes)) throw new Error('PDF changed or has not been inspected for text placement. Inspect it again.');
    const document = await this.document(bytes);
    const prepared = { path: source, hash: hash(bytes) };
    if (action.kind === 'fill_pdf') {
      prepared.destination = await this.policy.resolve(action.destination, { missing: true, mutate: true });
      if (path.extname(prepared.destination).toLowerCase() !== '.pdf' || source === prepared.destination) throw new Error('Save to a different, new PDF destination.');
      if (this.outputs && !inside(this.outputs, prepared.destination)) throw new Error('Filled PDFs must be saved inside the guest outputs folder.');
      try { await fs.lstat(prepared.destination); throw new Error('PDF destination already exists.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (typeof action.text !== 'string' || action.text.length > 32000) throw new Error('Provide PDF field values as JSON text, up to 32000 characters.');
      if (action.overlays !== undefined && JSON.stringify(action.overlays).length > 800000) throw new Error('PDF overlays exceed the request limit.');
      await this.applyEdits(document, JSON.parse(action.text), action.overlays);
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
      await this.applyEdits(document, JSON.parse(prepared.action.text), prepared.action.overlays);
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
    return { path: prepared.destination || prepared.path, pages: document.getPageCount(), fields: this.fields(document), sha256: hash(output), previewId, note: 'Review every rendered page. Overlay text is permanent page content, not editable form fields or redaction. Original untouched. No export, signing, OCR or website submission. PDF text extraction is not available.' };
  }
}

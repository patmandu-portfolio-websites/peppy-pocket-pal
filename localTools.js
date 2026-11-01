import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { chromium } from 'playwright';
import { maxFileBytes, redact, containsCredentials } from './localPolicy.js';
import { fetchAuthorized } from './localNetwork.js';
import { AmazonCart } from './amazonCart.js';
import { amazonProductUrl, redirectHtml } from './amazonPolicy.js';
import { PdfTools } from './pdfTools.js';

const kinds = ['inspect_pdf', 'fill_pdf', 'list_files', 'search_files', 'read_file', 'write_file', 'move_file', 'delete_file', 'read_website', 'fill_form', 'download_file', 'restore_backup', 'amazon_product', 'amazon_add_to_cart', 'amazon_view_cart'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

export class LocalTools {
  constructor(policy, stateDir, pdfWorkspace) {
    this.policy = policy;
    this.stateDir = stateDir;
    this.backups = path.join(stateDir, 'backups');
    this.amazon = new AmazonCart(event => this.log(event));
    this.pdf = new PdfTools(policy, pdfWorkspace);
  }

  async log(event) {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.appendFile(path.join(this.stateDir, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n');
  }

  async prepare(action) {
    if (!action || !kinds.includes(action.kind)) throw new Error('Unsupported tool action.');
    const prepared = { id: crypto.randomUUID(), action, expires: Date.now() + 5 * 60 * 1000 };
    if (action.kind === 'inspect_pdf' || action.kind === 'fill_pdf') Object.assign(prepared, await this.pdf.prepare(action));
    if (action.kind.startsWith('amazon_')) {
      this.amazon.requireReady();
      if (action.kind !== 'amazon_view_cart') {
        const product = amazonProductUrl(action.url);
        if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > 10) throw new Error('Amazon quantity must be an integer from 1 to 10.');
        prepared.url = product.url;
        if (action.kind === 'amazon_add_to_cart') {
          prepared.amazon = this.amazon.prepareAdd(product.url, action.quantity);
          prepared.action = { kind: action.kind, url: product.url, quantity: action.quantity, title: prepared.amazon.title, price: prepared.amazon.price, warning: 'Changes your Amazon cart. No checkout or purchase is permitted. Price excludes any checkout costs.' };
        }
      }
    }
    if (['read_file', 'write_file', 'move_file', 'delete_file'].includes(action.kind)) {
      prepared.path = await this.policy.resolve(action.path, { file: true, missing: action.kind === 'write_file', mutate: action.kind !== 'read_file' });
      try {
        prepared.before = await this.policy.read(prepared.path);
        prepared.hash = digest(prepared.before);
      } catch (error) {
        if (error.code !== 'ENOENT' || action.kind !== 'write_file') throw error;
        prepared.before = null;
        prepared.hash = null;
      }
    }
    if (action.kind === 'write_file') {
      if (typeof action.text !== 'string' || Buffer.byteLength(action.text) > maxFileBytes || action.text.includes('\0') || containsCredentials(action.text)) throw new Error('New text must be no larger than 64 KiB and cannot contain credentials.');
      prepared.diff = createTwoFilesPatch(action.path, action.path, prepared.before || '', action.text);
    }
    if (['move_file', 'download_file'].includes(action.kind)) {
      prepared.destination = await this.policy.resolve(action.destination, { missing: true, file: true, mutate: true });
      await this.mustNotExist(prepared.destination);
    }
    if (['list_files', 'search_files'].includes(action.kind)) prepared.path = await this.policy.resolve(action.path);
    if (['read_website', 'fill_form', 'download_file'].includes(action.kind)) prepared.url = await this.policy.website(action.url);
    if (action.kind === 'fill_form' && (!action.selector || typeof action.value !== 'string' || action.value.length > 2000 || containsCredentials(action.value))) throw new Error('Provide a field selector and a non-sensitive value no longer than 2000 characters.');
    if (action.kind === 'restore_backup') {
      if (typeof action.backupId !== 'string' || !/^[a-f0-9-]{36}$/.test(action.backupId)) throw new Error('Choose a backup ID from the action log.');
      const metadata = JSON.parse(await fs.readFile(path.join(this.backups, action.backupId + '.json'), 'utf8'));
      prepared.path = await this.policy.resolve(metadata.path, { file: true, missing: true, mutate: true });
      prepared.restoreText = await fs.readFile(path.join(this.backups, action.backupId + '.txt'), 'utf8');
      try { prepared.before = await this.policy.read(prepared.path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; prepared.before = null; }
      prepared.hash = prepared.before === null ? null : digest(prepared.before);
      prepared.diff = createTwoFilesPatch(prepared.path, prepared.path, prepared.before || '', prepared.restoreText);
    }
    await this.log({ id: prepared.id, status: 'proposed', kind: action.kind, path: prepared.path, destination: prepared.destination, url: prepared.url });
    return prepared;
  }

  async mustNotExist(file) {
    try { await fs.lstat(file); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw new Error('The destination already exists. Overwriting is not allowed.');
  }

  async unchanged(prepared) {
    await this.policy.resolve(prepared.path, { file: true, missing: prepared.hash === null, mutate: true });
    if (prepared.hash === null) return this.mustNotExist(prepared.path);
    if (digest(await this.policy.read(prepared.path)) !== prepared.hash) throw new Error('The file changed after preview. Request a new action before approving.');
  }

  async backup(prepared) {
    if (prepared.before === null) return null;
    const id = crypto.randomUUID();
    await fs.mkdir(this.backups, { recursive: true });
    await fs.writeFile(path.join(this.backups, id + '.txt'), prepared.before, { flag: 'wx' });
    await fs.writeFile(path.join(this.backups, id + '.json'), JSON.stringify({ path: prepared.path, time: new Date().toISOString() }), { flag: 'wx' });
    return id;
  }

  async execute(prepared) {
    if (Date.now() > prepared.expires) throw new Error('Approval expired. Request this action again.');
    const { action } = prepared;
    let result;
    try {
      switch (action.kind) {
        case 'inspect_pdf':
        case 'fill_pdf':
          result = await this.pdf.execute(prepared);
          break;
        case 'amazon_product': {
          const product = await this.amazon.product(prepared.url, action.quantity);
          result = { url: product.url, asin: product.asin, title: product.title, price: product.price, quantity: product.quantity, note: 'Preview only. Request a separate amazon_add_to_cart approval to change the cart.' };
          break;
        }
        case 'amazon_add_to_cart':
          result = await this.amazon.add(prepared.amazon);
          break;
        case 'amazon_view_cart':
          result = await this.amazon.viewCart();
          break;
        case 'read_file':
          result = { path: prepared.path, text: redact(await this.policy.read(prepared.path)) };
          break;
        case 'list_files':
        case 'search_files':
          result = await this.find(prepared.path, action.query || '', action.kind === 'search_files');
          break;
        case 'write_file':
        case 'restore_backup': {
          await this.unchanged(prepared);
          const backupId = await this.backup(prepared);
          const content = action.kind === 'restore_backup' ? prepared.restoreText : action.text;
          if (prepared.hash === null) await fs.writeFile(prepared.path, content, { flag: 'wx' });
          else await fs.writeFile(prepared.path, content);
          result = { path: prepared.path, backupId, created: prepared.hash === null };
          break;
        }
        case 'move_file': {
          await this.unchanged(prepared);
          await this.policy.resolve(prepared.destination, { file: true, missing: true, mutate: true });
          await this.mustNotExist(prepared.destination);
          const backupId = await this.backup(prepared);
          await fs.copyFile(prepared.path, prepared.destination, fs.constants.COPYFILE_EXCL);
          await this.unchanged(prepared);
          await fs.unlink(prepared.path);
          result = { from: prepared.path, to: prepared.destination, backupId };
          break;
        }
        case 'delete_file': {
          await this.unchanged(prepared);
          const backupId = await this.backup(prepared);
          await fs.unlink(prepared.path);
          result = { path: prepared.path, backupId, note: 'Recoverable text copy saved in local backups.' };
          break;
        }
        case 'read_website':
        case 'fill_form':
          result = await this.browse(prepared);
          break;
        case 'download_file':
          result = await this.download(prepared);
          break;
      }
      await this.log({ id: prepared.id, status: 'completed', kind: action.kind, result: ['read_file', 'read_website', 'inspect_pdf', 'fill_pdf'].includes(action.kind) ? { path: prepared.path, destination: prepared.destination, url: prepared.url, sha256: result.sha256 } : result });
      return result;
    } catch (error) {
      await this.log({ id: prepared.id, status: 'failed', kind: action.kind, error: error.message });
      throw error;
    }
  }

  async find(root, query, recursive) {
    await this.policy.resolve(root);
    const matches = [];
    let visited = 0;
    const walk = async (folder, depth) => {
      if (depth > 5) return;
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (++visited > 1000 || matches.length >= 100) return;
        const candidate = path.join(folder, entry.name);
        try { await this.policy.resolve(candidate); }
        catch (error) {
          if (error.code === 'EACCES' || /blocked|protected|links|junctions|Reparse|redirected|Hard-linked/.test(error.message)) continue;
          throw error;
        }
        if (!query || entry.name.toLowerCase().includes(query.toLowerCase())) matches.push({ path: candidate, directory: entry.isDirectory() });
        if (recursive && entry.isDirectory()) await walk(candidate, depth + 1);
      }
    };
    await walk(root, 0);
    return { matches, note: 'Name search only; capped at 100 results, 1000 entries and 5 folder levels.' };
  }

  async browse(prepared) {
    await this.policy.website(prepared.url);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: false });
    let filling = false;
    const blocked = [];
    try {
      await context.route('**/*', async route => {
        const request = route.request();
        try {
          if (filling || request.method() !== 'GET') throw new Error('Browser submissions and interactions with network side effects are blocked.');
          const response = await fetchAuthorized(this.policy, request.url());
          const headers = {};
          for (const name of ['content-type', 'location']) {
            if (typeof response.headers[name] === 'string') headers[name] = response.headers[name];
          }
          if (response.status >= 300 && response.status < 400) {
            if (!response.headers.location || request.resourceType() !== 'document') throw new Error('Only approved document redirects are supported.');
            const destination = await this.policy.website(new URL(response.headers.location, request.url()).href);
            await route.fulfill({ status: 200, contentType: 'text/html', body: redirectHtml(destination) });
            return;
          }
          await route.fulfill({ status: response.status, headers, body: response.body });
        } catch (error) {
          blocked.push({ url: request.url().split('?')[0], reason: error.message });
          await route.abort();
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('popup', popup => popup.close());
      const response = await page.goto(prepared.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!response || !response.ok()) throw new Error('The authorized webpage did not load successfully.');
      await this.policy.website(page.url());
      if (prepared.action.kind === 'fill_form') {
        filling = true;
        const field = page.locator(prepared.action.selector);
        if (await field.count() !== 1) throw new Error('The field selector must identify exactly one field.');
        const type = await field.getAttribute('type');
        const identity = [await field.getAttribute('name'), await field.getAttribute('autocomplete'), await field.getAttribute('id')].join(' ');
        if (type === 'password' || /password|token|secret|credit|card|payment|login|email/i.test(identity)) throw new Error('Credential, payment and login fields are blocked.');
        await field.fill(prepared.action.value);
        return { url: page.url(), filled: prepared.action.selector, value: await field.inputValue(), note: 'Field filled in a temporary isolated browser. Nothing was submitted; the browser has now been discarded.', blocked };
      }
      const text = await page.locator('body').innerText();
      const fields = await page.locator('input:not([type=password]),textarea').evaluateAll(elements => elements.map(el => ({ tag: el.tagName, name: el.getAttribute('name'), id: el.id, type: el.getAttribute('type') })).slice(0, 20));
      return { url: page.url(), title: await page.title(), text: redact(text.slice(0, 12000)), truncated: text.length > 12000, fields, blocked: blocked.slice(0, 20) };
    } finally {
      await browser.close();
    }
  }

  async download(prepared) {
    await this.policy.resolve(prepared.destination, { missing: true, file: true, mutate: true });
    await this.mustNotExist(prepared.destination);
    const url = await this.policy.website(prepared.url);
    const response = await fetchAuthorized(this.policy, url, maxFileBytes);
    if (response.status < 200 || response.status >= 300) throw new Error('Download failed or redirected. Authorize the exact final URL and request a new action.');
    const content = response.body.toString('utf8');
    if (content.includes('\0') || containsCredentials(content)) throw new Error('Binary files and credentials cannot be downloaded.');
    await this.policy.resolve(prepared.destination, { missing: true, file: true, mutate: true });
    await fs.writeFile(prepared.destination, content, { flag: 'wx' });
    return { path: prepared.destination, bytes: response.body.length, source: url };
  }
}

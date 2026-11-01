import { chromium } from 'playwright';
import { LocalPolicy } from './localPolicy.js';
import { fetchAuthorized } from './localNetwork.js';
import { allowAmazonRequest, amazonProductUrl, amazonOrigin, cartUrl, formFingerprint, validateAmazonForm, redirectHtml, amazonSignInUrl } from './amazonPolicy.js';

export class AmazonCart {
  constructor(log) {
    this.log = log;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.phase = 'closed';
    this.ticket = null;
    this.preview = null;
    this.policy = new LocalPolicy({ roots: [process.cwd()], origins: [amazonOrigin] });
  }

  async open() {
    await this.close();
    await this.policy.website(amazonOrigin);
    this.browser = await chromium.launch({ headless: false });
    try {
      this.context = await this.browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
      this.phase = 'login';
      await this.context.route('**/*', route => this.route(route));
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(10000);
      this.page.on('popup', popup => { popup.close().catch(error => console.error('Amazon popup close failed:', error.message)); });
      const response = await this.page.goto(amazonSignInUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response?.ok()) throw new Error('Amazon sign-in request did not succeed.');
      try { await this.page.locator('input[name="email"],input[name="password"]').first().waitFor({ state: 'visible', timeout: 15000 }); }
      catch (error) {
        console.error('Supported Amazon sign-in form unavailable:', error.name);
        throw new Error('Amazon did not show a supported sign-in form with scripts disabled. No login data was read; the restricted browser was closed.');
      }
      await this.log({ status: 'amazon-opened', origin: amazonOrigin, note: 'Manual login only; credentials and cookies are not read into chat or saved to disk.' });
      return { opened: true, phase: this.phase, note: 'Sign in yourself in the separate browser, then click Finish manual sign-in in Peppy. Scripts are disabled; unsupported login or CAPTCHA must be handled without bypassing it.' };
    } catch (error) { await this.close(); throw error; }
  }

  async route(route) {
    const request = route.request();
    try {
      const allowed = allowAmazonRequest({ url: request.url(), method: request.method(), type: request.resourceType(), phase: this.phase, ticket: this.ticket, body: request.postData() || '' });
      if (!allowed) {
        await this.log({ status: 'amazon-request-blocked', path: new URL(request.url()).pathname, method: request.method() });
        await route.abort();
        return;
      }
      if (request.method() === 'POST' && this.phase === 'cart-add') this.ticket.used = true;
      const incoming = await request.allHeaders();
      const headers = {};
      for (const name of ['cookie', 'content-type', 'origin', 'referer', 'user-agent']) if (incoming[name]) headers[name] = incoming[name];
      const response = await fetchAuthorized(this.policy, request.url(), 2 * 1024 * 1024, { method: request.method(), body: request.postData() || undefined, headers });
      const outgoing = {};
      for (const name of ['content-type', 'location']) if (typeof response.headers[name] === 'string') outgoing[name] = response.headers[name];
      if (Array.isArray(response.headers['set-cookie'])) outgoing['set-cookie'] = response.headers['set-cookie'].join('\n');
      if (response.status >= 300 && response.status < 400) {
        if (!response.headers.location || request.resourceType() !== 'document') throw new Error('Unsupported Amazon redirect.');
        const destination = new URL(response.headers.location, request.url()).href;
        if (!allowAmazonRequest({ url: destination, method: 'GET', type: 'document', phase: this.phase })) throw new Error('Amazon redirect would leave the cart/login boundary.');
        delete outgoing.location;
        outgoing['content-type'] = 'text/html';
        await route.fulfill({ status: 200, headers: outgoing, body: redirectHtml(destination) });
        return;
      }
      await route.fulfill({ status: response.status, headers: outgoing, body: response.body });
    } catch (error) {
      console.error('Restricted Amazon request failed:', error.message);
      await route.abort();
    }
  }

  requireReady() {
    if (!this.page || this.page.isClosed() || this.phase !== 'ready') throw new Error('Open the Amazon browser and finish manual sign-in first.');
  }

  async ready() {
    if (!this.page || this.page.isClosed() || this.phase !== 'login') throw new Error('There is no manual sign-in session to finish.');
    const url = new URL(this.page.url());
    if (url.origin !== amazonOrigin || !allowAmazonRequest({ url: url.href, method: 'GET', type: 'document', phase: 'ready' })) throw new Error('Amazon sign-in is not finished. Complete it manually, or close the session if Amazon requires an unsupported login flow.');
    this.phase = 'ready';
    await this.log({ status: 'amazon-manual-login-finished', note: 'Automation restricted to product/cart routes.' });
    return { ready: true, note: 'Credentials stay in this temporary browser. Every cart addition needs a separate item approval. Checkout remains blocked.' };
  }

  async product(value, quantity) {
    this.requireReady();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('Choose an integer quantity from 1 to 10.');
    const product = amazonProductUrl(value);
    const beforeCart = await this.viewCart();
    const beforeQuantity = beforeCart.items.find(item => item.asin === product.asin)?.quantity || 0;
    const response = await this.page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok() || this.page.url().split('?')[0] !== product.url) throw new Error('The product page could not load. Nothing was added.');
    const quantityField = this.page.locator('select[name="quantity"], select[name="items[0.base][quantity]"]');
    if (await quantityField.count() !== 1) throw new Error('The supported quantity selector is unavailable. Nothing was added.');
    await quantityField.selectOption(String(quantity));
    const form = await this.readForm();
    validateAmazonForm(form, product.asin, quantity);
    this.preview = { ...product, quantity, beforeQuantity, title: form.title, price: form.price, fingerprint: formFingerprint(form.action, form.fields), form };
    return this.preview;
  }

  prepareAdd(value, quantity) {
    this.requireReady();
    const product = amazonProductUrl(value);
    if (!this.preview || this.preview.url !== product.url || this.preview.quantity !== quantity) throw new Error('Approve an amazon_product preview of this exact item and quantity before requesting Add to Cart.');
    return this.preview;
  }

  async readForm() {
    return this.page.locator('#add-to-cart-button').evaluate(button => {
      const form = button.form;
      if (!form) throw new Error('No native cart form is available.');
      return {
        action: form.action,
        method: form.method,
        fields: Array.from(new FormData(form), ([name, value]) => [name, String(value)]),
        buttonName: button.name,
        buttonValue: button.value,
        title: document.querySelector('#productTitle')?.textContent.trim(),
        price: document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen')?.textContent.trim()
      };
    });
  }

  async add(prepared) {
    this.requireReady();
    if (this.page.url().split('?')[0] !== prepared.url) throw new Error('The browser moved away from the approved product. Request a new preview.');
    const form = await this.readForm();
    if (form.title !== prepared.title || form.price !== prepared.price || formFingerprint(form.action, form.fields) !== prepared.fingerprint) throw new Error('The product, offer, price, quantity or cart form changed after preview. Request a fresh approval.');
    const current = prepared;
    this.ticket = validateAmazonForm(form, current.asin, current.quantity);
    this.phase = 'cart-add';
    try {
      await Promise.all([
        this.page.waitForURL(url => /^\/gp\/huc\/view\.html\/?$/.test(url.pathname) || /^\/gp\/cart\/view\.html\/?$/.test(url.pathname), { timeout: 20000 }),
        this.page.locator('#add-to-cart-button').click()
      ]);
      if (!this.ticket.used) throw new Error('Amazon did not submit the approved cart form.');
      this.phase = 'ready';
      const cart = await this.viewCart();
      const item = cart.items.find(item => item.asin === current.asin && item.quantity === current.beforeQuantity + current.quantity);
      if (!item) throw new Error('Cart verification failed. The item may have been added; inspect the visible cart before retrying to avoid duplicates.');
      await this.log({ status: 'amazon-item-added', asin: current.asin, quantity: current.quantity, title: current.title, price: current.price });
      return { added: true, asin: current.asin, title: current.title, requestedQuantity: current.quantity, cartQuantity: item.quantity, price: current.price, note: 'Stopped at the cart. No purchase or checkout was submitted.' };
    } catch (error) {
      throw new Error(`${error.message} Do not automatically retry: inspect the visible browser cart first.`);
    } finally { this.ticket = null; this.preview = null; this.phase = 'ready'; }
  }

  async viewCart() {
    this.requireReady();
    const response = await this.page.goto(cartUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response?.ok() || !this.page.url().startsWith(cartUrl)) throw new Error('Amazon cart could not be loaded.');
    const items = await this.page.locator('#sc-active-cart [data-asin]').evaluateAll(elements => elements.map(element => ({
      asin: element.getAttribute('data-asin'),
      title: element.querySelector('.sc-product-title')?.textContent.trim(),
      quantity: Number(element.querySelector('select[name="quantity"],input[name="quantity"],.sc-quantity-textfield')?.value || element.querySelector('[data-a-selector="value"]')?.textContent.trim())
    })).filter(item => item.asin));
    if (items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1)) throw new Error('Cart item quantities could not be verified. Inspect the browser manually.');
    return { items, note: 'Cart view only. Checkout and purchasing are blocked in this browser.' };
  }

  async close() {
    this.phase = 'closed'; this.ticket = null; this.preview = null;
    const browser = this.browser;
    this.browser = null; this.context = null; this.page = null;
    if (browser) await browser.close();
    return { closed: true, note: 'Temporary browser and login cookies discarded.' };
  }
}

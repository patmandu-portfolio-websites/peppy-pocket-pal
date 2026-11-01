import crypto from 'node:crypto';

export const amazonOrigin = 'https://www.amazon.com.au';
export const cartUrl = amazonOrigin + '/gp/cart/view.html';
export function amazonSignInUrl() {
  const identifier = 'http://specs.openid.net/auth/2.0/identifier_select';
  const params = new URLSearchParams({
    'openid.return_to': cartUrl,
    'openid.identity': identifier,
    'openid.assoc_handle': 'auflex',
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': identifier,
    'openid.ns': 'http://specs.openid.net/auth/2.0'
  });
  return `${amazonOrigin}/ap/signin?${params}`;
}
const loginPath = /^(?:\/ap\/(?:signin|cvf|mfa|challenge|verify)(?:\/|$)|\/ax\/claim\/?$)/;
const productPath = /^\/dp\/[A-Z0-9]{10}\/?$/;
const cartReadPath = /^\/gp\/(?:cart\/view\.html|huc\/view\.html)\/?$/;
export const cartSubmitPath = /^\/gp\/product\/handle-buy-box(?:\/ref=[A-Za-z0-9_-]+)?\/?$/;
const blockedNames = /buy.?now|checkout|place.?order|purchase|payment|address|proceed|submit\.buy/i;

export function amazonProductUrl(value) {
  const url = new URL(value);
  if (![amazonOrigin, 'https://amazon.com.au'].includes(url.origin) || url.username || url.password) throw new Error('Choose an Amazon Australia product page.');
  const match = /\/dp\/([A-Z0-9]{10})(?:\/|$)/.exec(url.pathname);
  if (!match) throw new Error('An Amazon product URL with a 10-character ASIN is required.');
  return { url: `${amazonOrigin}/dp/${match[1]}`, asin: match[1] };
}

export function formFingerprint(action, fields) {
  return crypto.createHash('sha256').update(JSON.stringify({ action, fields })).digest('hex');
}

export function redirectHtml(url) {
  const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><meta http-equiv="refresh" content="0;url=${escaped}"><title>Following approved redirect</title>`;
}

export function sameFormBody(expected, actual) {
  const sorted = value => [...new URLSearchParams(value)].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  return JSON.stringify(sorted(expected)) === JSON.stringify(sorted(actual));
}

export function allowAmazonRequest({ url: value, method, type, phase, ticket, body }) {
  const url = new URL(value);
  if (url.origin !== amazonOrigin || url.username || url.password) return false;
  if ([...url.searchParams].some(([key, value]) => blockedNames.test(key) || /checkout|buy.?now|place.?order|payment/i.test(value))) return false;
  if (method === 'POST') {
    if (phase === 'login' && loginPath.test(url.pathname)) {
      const params = new URLSearchParams(body);
      const returnTo = params.get('openid.return_to') || url.searchParams.get('openid.return_to');
      if (returnTo && returnTo !== cartUrl) return false;
      return true;
    }
    return Boolean(phase === 'cart-add' && ticket && !ticket.used && url.href === ticket.url &&
      cartSubmitPath.test(url.pathname) && sameFormBody(ticket.body, body));
  }
  if (method !== 'GET') return false;
  if (type !== 'document') return ['stylesheet', 'image', 'font'].includes(type) && /^\/(?:images|gp\/images)\//.test(url.pathname);
  if (loginPath.test(url.pathname)) {
    if (phase !== 'login') return false;
    const returnTo = url.searchParams.get('openid.return_to');
    return !returnTo || returnTo === cartUrl;
  }
  return url.pathname === '/' || productPath.test(url.pathname) || cartReadPath.test(url.pathname);
}

export function validateAmazonForm(form, asin, quantity) {
  const url = new URL(form.action);
  if (url.origin !== amazonOrigin || !cartSubmitPath.test(url.pathname) || form.method.toLowerCase() !== 'post') throw new Error('Amazon no longer exposes the supported cart-only form. Nothing was added.');
  if (form.buttonName !== 'submit.add-to-cart') throw new Error('The expected Add to Cart submit button is unavailable.');
  if (form.fields.some(([key]) => blockedNames.test(key))) throw new Error('The cart form contains unsupported purchase-related fields.');
  const data = new URLSearchParams(form.fields);
  const foundAsin = data.get('ASIN') || data.get('asin') || data.get('items[0.base][asin]');
  if (foundAsin !== asin) throw new Error('The cart form item does not match the approved product.');
  if (form.fields.some(([key]) => /^items\[(?!0\.base\])/.test(key))) throw new Error('Multi-item and bundled cart forms are not supported.');
  const quantityName = ['quantity', 'items[0.base][quantity]'].find(key => data.has(key));
  if (!quantityName || Number(data.get(quantityName)) !== quantity) throw new Error('The cart form quantity does not match the requested quantity.');
  if (!form.title || !form.price) throw new Error('Product title and visible price are required before cart approval.');
  data.append(form.buttonName, form.buttonValue);
  return { url: url.href, body: data.toString(), used: false };
}

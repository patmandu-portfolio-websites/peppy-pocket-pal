import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowAmazonRequest, amazonOrigin, amazonProductUrl, cartUrl, validateAmazonForm, sameFormBody, redirectHtml, amazonSignInUrl } from './amazonPolicy.js';
import { AmazonCart } from './amazonCart.js';
import { chromium } from 'playwright';

const asin = 'B0BFR1FLS7';
const form = () => ({
  action: amazonOrigin + '/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance',
  method: 'post',
  buttonName: 'submit.add-to-cart',
  buttonValue: 'Add to cart',
  title: 'Test phone stand',
  price: 'A$12.00',
  fields: [['ASIN', asin], ['quantity', '2'], ['anti-csrftoken-a2z', 'fixture-only']]
});
const request = (url, extras = {}) => ({ url, method: 'GET', type: 'document', phase: 'ready', ...extras });

test('canonicalizes product URLs and rejects other retailers', () => {
  assert.equal(amazonProductUrl(`https://amazon.com.au/Phone-Stand/dp/${asin}/ref=test?tracking=1`).url, `${amazonOrigin}/dp/${asin}`);
  assert.throws(() => amazonProductUrl('https://amazon.com.au.evil.test/dp/' + asin));
  assert.throws(() => amazonProductUrl('https://www.amazon.com.au/gp/cart/view.html'));
});

test('blocks checkout, purchases, addresses and unknown writes in every phase', () => {
  for (const phase of ['login', 'ready', 'cart-add']) {
    for (const path of ['/gp/buy/spc/handlers/display.html', '/checkout', '/gp/cart/desktop/go-to-checkout.html', '/gp/your-account/address/view.html', '/gp/product/handle-buy-box?submit.buy-now=1']) {
      for (const method of ['GET', 'POST']) {
        for (const type of ['document', 'image', 'stylesheet', 'xhr', 'fetch']) assert.equal(allowAmazonRequest(request(amazonOrigin + path, { phase, method, type })), false);
      }
    }
    assert.equal(allowAmazonRequest(request('https://example.com/dp/' + asin, { phase })), false);
    assert.equal(allowAmazonRequest(request(amazonOrigin + '/ap/forgotpassword', { phase, method: 'POST' })), false);
  }
  assert.equal(allowAmazonRequest(request(cartUrl)), true);
  assert.equal(allowAmazonRequest(request(amazonOrigin + '/dp/' + asin)), true);
  assert.equal(allowAmazonRequest(request(amazonOrigin + '/images/style.css', { type: 'stylesheet' })), true);
});

test('only exact approved single-item cart body may be submitted once', () => {
  const ticket = validateAmazonForm(form(), asin, 2);
  assert.equal(allowAmazonRequest(request(ticket.url, { method: 'POST', phase: 'ready', ticket, body: ticket.body })), false);
  assert.equal(allowAmazonRequest(request(ticket.url, { method: 'POST', phase: 'cart-add', ticket, body: ticket.body })), true);
  assert.equal(allowAmazonRequest(request(ticket.url, { method: 'POST', phase: 'cart-add', ticket, body: ticket.body + '&submit.buy-now=1' })), false);
  assert.equal(sameFormBody(ticket.body, ticket.body.replace('quantity=2', 'quantity=3')), false);
  ticket.used = true;
  assert.equal(allowAmazonRequest(request(ticket.url, { method: 'POST', phase: 'cart-add', ticket, body: ticket.body })), false);
});

test('rejects changed product, quantity, buy-now form and bundles', () => {
  assert.throws(() => validateAmazonForm(form(), 'B012345678', 2), /product/);
  assert.throws(() => validateAmazonForm(form(), asin, 1), /quantity/);
  assert.throws(() => validateAmazonForm({ ...form(), buttonName: 'submit.buy-now' }, asin, 2), /submit button/);
  assert.throws(() => validateAmazonForm({ ...form(), fields: [...form().fields, ['items[1.base][asin]', asin]] }, asin, 2), /bundled/);
});

test('manual sign-in cannot return to checkout or run after login phase', () => {
  const safe = amazonOrigin + '/ap/signin?openid.return_to=' + encodeURIComponent(cartUrl);
  const bad = amazonOrigin + '/ap/signin?openid.return_to=' + encodeURIComponent(amazonOrigin + '/checkout');
  assert.equal(allowAmazonRequest(request(safe, { phase: 'login' })), true);
  assert.equal(allowAmazonRequest(request(bad, { phase: 'login' })), false);
  assert.equal(allowAmazonRequest(request(safe)), false);
  assert.equal(allowAmazonRequest(request(amazonOrigin + '/ap/signin', { method: 'POST', phase: 'login', body: 'openid.return_to=' + encodeURIComponent(cartUrl) })), true);
  const published = new URL(amazonSignInUrl());
  assert.equal(published.searchParams.get('openid.assoc_handle'), 'auflex');
  assert.equal(published.searchParams.get('openid.mode'), 'checkid_setup');
  assert.equal(published.searchParams.get('openid.return_to'), cartUrl);
  assert.equal(allowAmazonRequest(request(published.href, { phase: 'login' })), true);
  assert.equal(allowAmazonRequest(request(amazonOrigin + '/ax/claim?arb=fixture-only', { phase: 'login' })), true);
  assert.equal(allowAmazonRequest(request(amazonOrigin + '/ax/claim?arb=fixture-only')), false);
});

test('native product/cart workflow uses fixed Add to Cart and verifies exact quantity in a fixture', async t => {
  const shopping = new AmazonCart(async () => {});
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  shopping.browser = browser; shopping.context = context; shopping.page = page; shopping.phase = 'ready';
  let cartQuantity = 1;
  let submitted = 0;
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const allowed = allowAmazonRequest(request(req.url(), { method: req.method(), phase: shopping.phase, ticket: shopping.ticket, body: req.postData() || '' }));
    assert.equal(allowed, true, `Unexpected blocked fixture request: ${req.method()} ${url.pathname}`);
    if (req.method() === 'POST') {
      shopping.ticket.used = true;
      const fields = new URLSearchParams(req.postData());
      assert.equal(fields.get('submit.add-to-cart'), 'Add to cart');
      assert.equal(fields.has('submit.buy-now'), false);
      cartQuantity += Number(fields.get('quantity'));
      submitted++;
      return route.fulfill({ contentType: 'text/html', body: redirectHtml(amazonOrigin + '/gp/huc/view.html') });
    }
    if (url.pathname.startsWith('/dp/')) return route.fulfill({ contentType: 'text/html', body: `<span id="productTitle">Test phone stand</span><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">A$12.00</span></span></div><form method="POST" action="/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance"><input name="ASIN" value="${asin}"><input type="hidden" name="anti-csrftoken-a2z" value="fixture-only"><select name="quantity"><option value="1">1</option><option value="2">2</option></select><input id="add-to-cart-button" name="submit.add-to-cart" type="submit" value="Add to cart"><input type="submit" name="submit.buy-now" value="Buy Now"></form>` });
    return route.fulfill({ contentType: 'text/html', body: `<div id="sc-active-cart"><div data-asin="${asin}"><span class="sc-product-title">Test phone stand</span><select name="quantity"><option selected>${cartQuantity}</option></select></div></div>` });
  });
  const preview = await shopping.product(amazonOrigin + '/dp/' + asin, 2);
  assert.equal(preview.beforeQuantity, 1);
  assert.equal(submitted, 0, 'Preview does not change cart');
  const result = await shopping.add(shopping.prepareAdd(preview.url, 2));
  assert.equal(result.added, true);
  assert.equal(result.cartQuantity, 3);
  assert.equal(submitted, 1);
  assert.equal(page.url(), cartUrl);
  assert.throws(() => shopping.prepareAdd(preview.url, 2), /preview/);
});

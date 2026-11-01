import https from 'node:https';
import dns from 'node:dns/promises';
import { isPublicAddress } from './localPolicy.js';

export async function fetchAuthorized(policy, value, maxBytes = 2 * 1024 * 1024, options = {}) {
  const url = new URL(await policy.website(value));
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error('The website resolved to a blocked network address.');
  const target = addresses.find(entry => entry.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    // Pin the approved DNS result; the HTTP client must not resolve it a second time.
    const request = https.request(url, {
      agent: false,
      method: options.method || 'GET',
      lookup: (_hostname, options, callback) => options.all ? callback(null, [target]) : callback(null, target.address, target.family),
      headers: { 'User-Agent': 'PeppyLocal/1.0', Accept: 'text/html,text/plain,application/json,*/*', ...options.headers }
    }, response => {
      const parts = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) request.destroy(new Error('The website response exceeds the allowed size.'));
        else parts.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts) }));
      response.on('error', reject);
    });
    request.setTimeout(20000, () => request.destroy(new Error('The website request timed out.')));
    request.on('error', reject);
    request.end(options.body);
  });
}

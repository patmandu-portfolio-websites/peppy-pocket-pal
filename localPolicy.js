import path from 'node:path';
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';

const blockedParts = /^(?:\.git|\.ssh|\.aws|\.azure|\.config|\.peppy-local|node_modules|AppData|Windows|Program Files(?: \(x86\))?|ProgramData|\$Recycle\.Bin|System Volume Information)$/i;
const blockedFiles = /(?:^\.env(?:\.|$)|^\.npmrc$|^\.gitconfig$|credentials|secrets|password|token|^id_(?:rsa|ed25519)|\.(?:pem|key|pfx|p12|kdbx|exe|dll|bat|cmd|ps1|sh|msi|lnk|url)$)/i;
const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.log']);
export const maxFileBytes = 64 * 1024;

export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function redact(text) {
  return text.replace(/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+/g, '[REDACTED CREDENTIAL]');
}

export function containsCredentials(text) {
  return text.includes('-----BEGIN ') || redact(text) !== text || /(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["']?\S+/i.test(text);
}

export class LocalPolicy {
  constructor({ roots, origins, protectedPaths = [] }) {
    this.roots = roots.map(root => path.resolve(root));
    this.origins = origins.map(value => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Website authorization must use an HTTPS origin without credentials.');
      return url.origin;
    });
    this.protectedPaths = protectedPaths.map(value => path.resolve(value));
    if (!this.roots.length) throw new Error('Authorize at least one folder.');
  }

  async resolve(input, { missing = false, file = false, mutate = false } = {}) {
    if (typeof input !== 'string' || !path.isAbsolute(input) || input.startsWith('\\\\') || input.includes('\0')) throw new Error('Use an absolute local file path, not a network path.');
    const candidate = path.resolve(input);
    if (!this.roots.some(root => inside(root, candidate))) throw new Error('This path is outside authorized folders.');
    if (this.protectedPaths.some(root => inside(root, candidate))) throw new Error('Peppy configuration and application files are protected from tool access.');
    const parts = candidate.slice(path.parse(candidate).root.length).split(path.sep);
    if (parts.some(part => blockedParts.test(part) || part.includes(':')) || blockedFiles.test(path.basename(candidate))) throw new Error('Credential, system, application, and executable paths are blocked.');
    if (mutate && this.roots.some(root => root === candidate)) throw new Error('Authorized folder roots cannot be changed or removed.');
    let cursor = path.parse(candidate).root;
    for (let index = 0; index < parts.length; index++) {
      cursor = path.join(cursor, parts[index]);
      let stat;
      try { stat = await fs.lstat(cursor); }
      catch (error) {
        if (error.code === 'ENOENT' && missing && index === parts.length - 1) break;
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed.');
      if (stat.isFile() && stat.nlink > 1) throw new Error('Hard-linked files are not allowed.');
      const real = await fs.realpath(cursor);
      const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      if (normalized(real) !== normalized(cursor)) throw new Error('Reparse points and redirected paths are not allowed.');
    }
    if (file && !textExtensions.has(path.extname(candidate).toLowerCase())) throw new Error('Only supported text file types are allowed.');
    return candidate;
  }

  async read(input) {
    const file = await this.resolve(input, { file: true });
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > maxFileBytes) throw new Error('Select a text file no larger than 64 KiB.');
    const content = await fs.readFile(file, 'utf8');
    if (content.includes('\0') || containsCredentials(content)) throw new Error('This file may contain credentials and cannot be read by assistant tools.');
    return content;
  }

  async website(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !this.origins.includes(url.origin)) throw new Error('This website is not authorized.');
    if ([...url.searchParams.keys()].some(key => /password|token|secret|api.?key|authorization/i.test(key))) throw new Error('Credential-bearing URLs are blocked.');
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Private, loopback, and reserved network destinations are blocked.');
    return url.href;
  }
}

export function isPublicAddress(address) {
  if (net.isIP(address) === 6) return /^[23]/i.test(address) && !/^2001:(?:db8|0:|10:|20:)/i.test(address);
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}

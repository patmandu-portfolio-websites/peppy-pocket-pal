import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyPackage, installUpdate } from './ubuntuUpdate.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peppy-updater-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'disc');
  const home = path.join(root, 'home');
  const app = path.join(home, 'peppy');
  fs.mkdirSync(source); fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(path.join(app, '.peppy-local'));
  fs.writeFileSync(path.join(app, '.env'), 'fictional-private-config');
  fs.writeFileSync(path.join(app, '.peppy-local', 'state.json'), '{"checkpoint":42}');
  fs.writeFileSync(path.join(app, 'localServer.js'), 'old source');
  fs.mkdirSync(path.join(app, 'node_modules'));
  fs.writeFileSync(path.join(app, 'node_modules', 'old-dependency'), 'old dependency');
  const names = ['package.json', 'package-lock.json', 'localServer.js', 'src.jsx', 'ubuntuUpdate.mjs', 'example.test.js'];
  const manifest = names.map(name => {
    const body = `new ${name}`;
    fs.writeFileSync(path.join(source, name), body);
    return `${digest(body)}  ${name}\r\n`;
  }).join('');
  fs.writeFileSync(path.join(source, 'SHA256SUMS'), manifest);
  const calls = [];
  const reports = [];
  const options = { home, source, expected: digest(manifest), report: text => reports.push(text),
    run: (command, args, cwd) => { calls.push({ command, args, cwd }); return true; }, healthy: () => {} };
  return { root, app, home, source, options, calls, reports };
}

test('updater verifies trusted manifest, rejects corruption and private/traversal entries before service changes', t => {
  const f = fixture(t);
  assert.equal(verifyPackage(f.source, f.options.expected).size, 6);
  assert.throws(() => verifyPackage(f.source, '0'.repeat(64)), /trusted release/);
  fs.writeFileSync(path.join(f.source, 'src.jsx'), 'corrupt');
  assert.throws(() => installUpdate(f.options), /checksum/);
  assert.equal(f.calls.length, 0);
  for (const name of ['../escape.js', '.env', '.peppy-local/state.json', 'public/../state.json']) {
    const manifest = `${digest('value')}  ${name}\n`;
    fs.writeFileSync(path.join(f.source, 'SHA256SUMS'), manifest);
    assert.throws(() => verifyPackage(f.source, digest(manifest)), /Unsafe/);
  }
});

test('release source inventory including dotted configuration names verifies with CRLF manifest', t => {
  const f = fixture(t);
  const repository = path.dirname(fileURLToPath(import.meta.url));
  const names = fs.readdirSync(repository).filter(name => fs.statSync(path.join(repository, name)).isFile() &&
    (name === '.gitignore' || /^[A-Za-z0-9_-].*\.(?:js|jsx|mjs|json|md|html|css|ps1)$/.test(name)));
  names.push('public/icon.svg', 'public/manifest.webmanifest', 'public/sw.js');
  assert.ok(names.includes('vite.config.js'));
  const manifest = names.map(name => {
    const body = fs.readFileSync(path.join(repository, name));
    fs.mkdirSync(path.dirname(path.join(f.source, name)), { recursive: true });
    fs.writeFileSync(path.join(f.source, name), body);
    return `${digest(body)}  ${name}\r\n`;
  }).join('');
  fs.writeFileSync(path.join(f.source, 'SHA256SUMS'), manifest);
  assert.equal(verifyPackage(f.source, digest(manifest)).size, names.length);
});

test('updater stages builds and tests, preserves private state, retains complete previous installation', t => {
  const f = fixture(t);
  const result = installUpdate(f.options);
  assert.equal(fs.readFileSync(path.join(f.app, 'localServer.js'), 'utf8'), 'new localServer.js');
  assert.equal(fs.readFileSync(path.join(f.app, '.env'), 'utf8'), 'fictional-private-config');
  assert.equal(fs.readFileSync(path.join(f.app, '.peppy-local', 'state.json'), 'utf8'), '{"checkpoint":42}');
  assert.equal(fs.readFileSync(path.join(result.backup, 'localServer.js'), 'utf8'), 'old source');
  assert.equal(fs.readFileSync(path.join(result.backup, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency');
  assert.deepEqual(f.calls.filter(call => call.command === 'npm').map(call => call.args), [['ci'], ['run', 'build']]);
  assert.ok(f.calls.some(call => call.args.includes('--test-concurrency=1') && call.args.includes('example.test.js')));
  assert.equal(fs.existsSync(path.join(f.home, '.peppy-update-lock')), false);
});

test('failed build retains original installation and restores prior running service', t => {
  const f = fixture(t);
  const original = f.options.run;
  f.options.run = (...args) => {
    original(...args);
    if (args[0] === 'npm') throw new Error('npm failed');
    return true;
  };
  assert.throws(() => installUpdate(f.options), /npm failed/);
  assert.equal(fs.readFileSync(path.join(f.app, 'localServer.js'), 'utf8'), 'old source');
  assert.ok(f.calls.some(call => call.command === 'systemctl' && call.args.includes('start')));
  assert.equal(fs.existsSync(path.join(f.home, '.peppy-update-lock')), false);
});

test('post-activation health failure rolls back source and dependencies', t => {
  const f = fixture(t);
  let checks = 0;
  f.options.healthy = () => { if (++checks === 1) throw new Error('New service unhealthy'); };
  assert.throws(() => installUpdate(f.options), /New service unhealthy/);
  assert.equal(checks, 2);
  assert.equal(fs.readFileSync(path.join(f.app, 'localServer.js'), 'utf8'), 'old source');
  assert.equal(fs.readFileSync(path.join(f.app, 'node_modules', 'old-dependency'), 'utf8'), 'old dependency');
});

test('failed recovery is reported separately without hiding the original update error', t => {
  const f = fixture(t);
  f.options.healthy = () => { throw new Error('Service unhealthy'); };
  assert.throws(() => installUpdate(f.options), error => error instanceof AggregateError && error.errors.length === 2);
  assert.ok(f.reports.some(text => text.startsWith('RECOVERY FAILED:')));
  assert.equal(fs.readFileSync(path.join(f.app, 'localServer.js'), 'utf8'), 'old source');
});

test('stopped service remains stopped and concurrent updater lock prevents mutation', t => {
  const f = fixture(t);
  f.options.run = (command, args) => command === 'systemctl' && args.includes('is-active') ? false : true;
  fs.mkdirSync(path.join(f.home, '.peppy-update-lock'));
  assert.throws(() => installUpdate(f.options), /EEXIST/);
  fs.rmdirSync(path.join(f.home, '.peppy-update-lock'));
  let checks = 0;
  f.options.healthy = () => { checks++; };
  const result = installUpdate(f.options);
  assert.equal(result.active, false);
  assert.equal(checks, 0);
});

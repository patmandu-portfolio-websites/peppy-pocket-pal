import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const sourceName = /^(?:\.gitignore|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|jsx|mjs|json|md|html|css|ps1)|public\/(?:icon\.svg|manifest\.webmanifest|sw\.js))$/;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

export function verifyPackage(directory, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Provide the trusted SHA256SUMS checksum from the release announcement.');
  const manifest = fs.readFileSync(path.join(directory, 'SHA256SUMS'));
  if (hash(manifest) !== expected.toLowerCase()) throw new Error('Manifest checksum does not match the trusted release checksum.');
  const entries = new Map();
  for (const line of manifest.toString('utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+?)\r?$/.exec(line);
    if (!match || !sourceName.test(match[2]) || entries.has(match[2])) throw new Error(`Unsafe or duplicate source manifest entry: ${match ? match[2] : 'malformed checksum line'}`);
    const file = path.join(directory, match[2]);
    for (const part of [directory, path.dirname(file), file]) {
      if (fs.lstatSync(part).isSymbolicLink()) throw new Error('Linked package paths are not allowed.');
    }
    if (!fs.statSync(file).isFile() || hash(fs.readFileSync(file)) !== match[1]) throw new Error(`Source checksum failed: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  for (const required of ['package.json', 'package-lock.json', 'localServer.js', 'src.jsx', 'ubuntuUpdate.mjs']) {
    if (!entries.has(required)) throw new Error(`Incomplete source package: ${required}`);
  }
  return entries;
}

export function installUpdate({ home, source, expected, run, healthy, report = console.log }) {
  const app = path.join(home, 'peppy');
  const lock = path.join(home, '.peppy-update-lock');
  const tag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const staged = path.join(home, `peppy-update-${tag}`);
  const backup = path.join(home, `peppy-backup-${tag}`);
  const entries = verifyPackage(source, expected);
  if (fs.lstatSync(app).isSymbolicLink() || !fs.statSync(app).isDirectory()) throw new Error('Expected a real ~/peppy installation directory.');
  fs.mkdirSync(lock, { mode: 0o700 });
  let stopped = false;
  let moved = false;
  let activated = false;
  let wasActive = false;
  try {
    wasActive = run('systemctl', ['--user', 'is-active', '--quiet', 'peppy.service'], home, true);
    // Stop before cloning so Gmail checkpoints and private state cannot diverge.
    run('systemctl', ['--user', 'stop', 'peppy.service'], home);
    stopped = true;
    fs.mkdirSync(staged, { mode: 0o700 });
    fs.cpSync(app, staged, {
      recursive: true,
      filter: file => {
        const relative = path.relative(app, file);
        if (['node_modules', 'dist'].includes(relative)) return false;
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error(`Linked installation path refused: ${relative}`);
        if (process.platform === 'linux' && stat.uid !== process.getuid()) throw new Error(`Installation path is not owned by this user: ${relative}`);
        return true;
      }
    });
    fs.chmodSync(staged, 0o700);
    for (const name of entries.keys()) {
      const target = path.join(staged, name);
      if (fs.existsSync(path.dirname(target))) fs.chmodSync(path.dirname(target), 0o700);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (fs.existsSync(target)) fs.chmodSync(target, 0o600);
      fs.copyFileSync(path.join(source, name), target);
      fs.chmodSync(target, 0o600);
    }
    // Check copied bytes again before executing any new code or dependency scripts.
    for (const [name, digest] of entries) {
      if (hash(fs.readFileSync(path.join(staged, name))) !== digest) throw new Error(`Installed checksum failed: ${name}`);
    }
    run('npm', ['ci'], staged);
    run('npm', ['run', 'build'], staged);
    const tests = [...entries.keys()].filter(name => name.endsWith('.test.js'));
    if (!tests.length) throw new Error('No release tests found.');
    run(process.execPath, ['--test', '--test-concurrency=1', ...tests], staged);
    fs.renameSync(app, backup);
    moved = true;
    fs.chmodSync(backup, 0o700);
    fs.renameSync(staged, app);
    activated = true;
    if (wasActive) {
      run('systemctl', ['--user', 'start', 'peppy.service'], home);
      healthy();
    }
    report(`Update installed. Previous installation retained privately at ${backup}`);
    report(wasActive ? 'Companion restarted and health checks passed.' : 'Companion was stopped before the update and remains stopped.');
    return { backup, active: wasActive };
  } catch (error) {
    report(`UPDATE FAILED: ${error.message}`);
    try {
      if (activated) {
        run('systemctl', ['--user', 'stop', 'peppy.service'], home);
        fs.renameSync(app, staged);
      }
      if (moved) fs.renameSync(backup, app);
      if (stopped && wasActive) {
        run('systemctl', ['--user', 'start', 'peppy.service'], home);
        healthy();
      }
      report('Previous installation retained/restored. Failed staged files, if present, remain private for diagnosis.');
    } catch (recovery) {
      report(`RECOVERY FAILED: ${recovery.message}. Keep backups; inspect peppy.service before proceeding.`);
      throw new AggregateError([error, recovery], 'Update and recovery failed.');
    }
    throw error;
  } finally { fs.rmdirSync(lock); }
}

async function main() {
  if (process.platform !== 'linux' || process.getuid() === 0) throw new Error('Run inside Ubuntu as the Peppy user, never with sudo.');
  const [sourceInput, expected] = process.argv.slice(2);
  if (!sourceInput || !expected || process.argv.length !== 4) throw new Error('Usage: node ubuntuUpdate.mjs DISC_DIRECTORY TRUSTED_MANIFEST_SHA256');
  const source = fs.realpathSync(sourceInput);
  verifyPackage(source, expected);
  const service = execFileSync('systemctl', ['--user', 'show', 'peppy.service', '--property=ExecStart', '--property=WorkingDirectory', '--property=Environment'], { encoding: 'utf8' });
  if (!service.includes(path.join(os.homedir(), 'peppy', 'localServer.js')) ||
      !service.includes(`WorkingDirectory=${path.join(os.homedir(), 'peppy')}`) || !service.includes('PEPPY_VM=1')) {
    throw new Error('Existing peppy.service must use ~/peppy/localServer.js, ~/peppy as WorkingDirectory and PEPPY_VM=1. No service configuration was changed.');
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try { answer = await terminal.question('Verified source. Stop Peppy, build/test and update ~/peppy? Type UPDATE: '); }
  finally { terminal.close(); }
  if (answer !== 'UPDATE') throw new Error('Update cancelled; installation unchanged.');
  process.umask(0o077);
  const run = (command, args, cwd, probe = false) => {
    try {
      execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`, PEPPY_PDF_UI_TEST: '1' } });
      return true;
    } catch (error) {
      if (probe && [3, 4].includes(error.status)) return false;
      throw error;
    }
  };
  const healthy = () => {
    run('systemctl', ['--user', 'is-active', '--quiet', 'peppy.service'], os.homedir());
    const status = execFileSync('curl', ['--fail', '--silent', '--show-error', '--retry', '10', '--retry-connrefused',
      '--retry-delay', '1', '--max-time', '5', 'http://127.0.0.1:3030/api/status'], { stdio: 'pipe' });
    const data = JSON.parse(status.toString('utf8'));
    if (data.localAssistant !== true || data.downtimeResearch !== true) throw new Error('Companion status did not confirm Ubuntu research mode.');
    const listeners = execFileSync('ss', ['-H', '-ltn', 'sport = :3030'], { encoding: 'utf8' });
    const lines = listeners.trim().split('\n');
    if (!lines.length || lines.some(line => line.trim().split(/\s+/)[3] !== '127.0.0.1:3030')) throw new Error('Expected only a loopback IPv4 companion listener on port 3030.');
  };
  installUpdate({ home: os.homedir(), source, expected, run, healthy });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

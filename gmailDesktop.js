import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./gmailDesktop.ps1', import.meta.url));

function run(file, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true, timeout: 45000, maxBuffer: 128 * 1024 }, (error, stdout) => {
      // Child stderr can contain credential-bearing tool diagnostics: never forward it.
      if (error) reject(new Error(`Gmail desktop integration failed (${path.basename(file)}). Check the desktop session, credential store and installed tools.`));
      else resolve(stdout.trim());
    });
    child.stdin.on('error', () => reject(new Error('Gmail desktop integration could not receive its input.')));
    child.stdin.end(input);
  });
}

export function desktopGmail(platform = process.platform) {
  if (!['win32', 'linux'].includes(platform)) throw new Error('Gmail desktop notifications require Windows or Ubuntu.');
  const windows = (action, input) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Action', action], input);
  const attributes = ['application', 'peppy', 'credential', 'gmail-refresh-token'];
  return {
    async read() {
      if (platform === 'win32') return windows('Read');
      return run('secret-tool', ['lookup', ...attributes]);
    },
    async write(token) {
      if (platform === 'win32') await windows('Write', token);
      else await run('secret-tool', ['store', '--label=Peppy Gmail authorization', ...attributes], token);
    },
    async remove() {
      if (platform === 'win32') await windows('Delete');
      else {
        await run('secret-tool', ['clear', ...attributes]);
      }
    },
    async notify(title, body) {
      if (platform === 'win32') await windows('Notify', JSON.stringify({ title, body }));
      else await run('notify-send', ['--app-name=Peppy', '--', title, body]);
    }
  };
}

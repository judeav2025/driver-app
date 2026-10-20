import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;

const INSTALL_HINT = `cloudflared is not installed.
  macOS:   brew install cloudflared
  Windows: winget install --id Cloudflare.cloudflared
  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`;

if (spawnSync('cloudflared', ['--version']).error) {
  console.error(INSTALL_HINT);
  process.exit(1);
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: 'inherit',
});

const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let shown = false;
tunnel.stderr.on('data', (chunk) => {
  const match = !shown && chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match) return;
  shown = true;
  console.log(`
  Public URL:  ${match[0]}
  Big screen:  ${match[0]}/screen   (open on the laptop, phones scan the QR)

  The URL can take up to a minute to start working. Ctrl+C stops both.
`);
});

const stop = () => {
  server.kill();
  tunnel.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', () => tunnel.kill());
tunnel.on('exit', (code) => {
  if (!shown) console.error(`cloudflared exited (code ${code}) before giving a URL.`);
  server.kill();
});

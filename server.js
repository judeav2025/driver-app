import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Game } from './lib/game.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

export const SNAPSHOT_MS = 66;

export function createDriverServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const game = new Game();

  // Behind Render/Fly/Railway the TLS terminates at the proxy.
  app.set('trust proxy', true);

  app.get('/health', (req, res) => {
    res.json({ ok: true, players: game.count });
  });

  app.get('/screen', (req, res) => {
    res.sendFile(path.join(publicDir, 'screen.html'));
  });

  app.get('/qr.svg', async (req, res) => {
    const fallback = `${req.protocol}://${req.get('host')}/`;
    const target = typeof req.query.u === 'string' && req.query.u ? req.query.u : fallback;
    if (!/^https?:\/\//.test(target) || target.length > 512) {
      return res.status(400).send('u must be an http(s) URL');
    }
    const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=300').send(svg);
  });

  app.use(express.static(publicDir));

  io.on('connection', (socket) => {
    socket.on('join', (msg) => {
      if (game.players.has(socket.id)) return;
      const player = game.join(socket.id, msg || {});
      socket.emit('welcome', player);
    });

    socket.on('state', (msg) => {
      game.setState(socket.id, msg);
    });

    socket.on('disconnect', () => {
      game.leave(socket.id);
    });

    // Late-joining screens see everyone immediately instead of waiting for a change.
    socket.emit('snapshot', game.snapshot());
  });

  const timer = setInterval(() => {
    const snap = game.takeSnapshot();
    if (snap) io.emit('snapshot', snap);
  }, SNAPSHOT_MS);

  httpServer.on('close', () => clearInterval(timer));

  return { app, httpServer, io, game };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createDriverServer();
  httpServer.listen(port, () => {
    console.log(`Driver listening on http://localhost:${port} (screen: /screen)`);
  });
}

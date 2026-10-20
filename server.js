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

// raceMs / countdownMs are overridable so tests can run a whole race in a blink.
export function createDriverServer(options = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const game = new Game(options);
  let endTimer = null;

  // Behind Render/Fly/Railway the TLS terminates at the proxy.
  app.set('trust proxy', true);

  app.get('/health', (req, res) => {
    res.json({ ok: true, players: game.count, phase: game.phase });
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

    socket.on('crash', () => {
      game.crash(socket.id);
    });

    // Only the big screen starts races; phones are players.
    socket.on('start', () => {
      if (game.players.has(socket.id)) return;
      const info = game.startRace();
      if (!info) return;
      io.emit('start', info);
      endTimer = setTimeout(endRace, info.startsInMs + info.durationMs);
    });

    socket.on('disconnect', () => {
      game.leave(socket.id);
    });

    // Late-joining screens see everyone immediately instead of waiting for a change,
    // and pick up a race that's already running (or the last results).
    socket.emit('snapshot', game.snapshot());
    if (game.race) socket.emit('start', game.raceInfo());
    else if (game.leaderboard) socket.emit('end', { leaderboard: game.leaderboard });
  });

  function endRace() {
    endTimer = null;
    const result = game.endRace();
    if (result) io.emit('end', result);
  }

  const timer = setInterval(() => {
    const snap = game.takeSnapshot();
    if (snap) io.emit('snapshot', snap);
  }, SNAPSHOT_MS);

  httpServer.on('close', () => {
    clearInterval(timer);
    clearTimeout(endTimer);
  });

  return { app, httpServer, io, game };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createDriverServer();
  httpServer.listen(port, () => {
    console.log(`Driver listening on http://localhost:${port} (screen: /screen)`);
  });
}

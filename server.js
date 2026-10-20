import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Room } from './lib/room.js';
import { qrResponse } from './lib/qr.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

// raceMs / countdownMs are overridable so tests can run a whole race in a blink.
export function createDriverServer(options = {}) {
  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const room = new Room(options);

  // Behind a tunnel or proxy the TLS terminates there.
  app.set('trust proxy', true);

  app.get('/health', (req, res) => {
    res.json(room.health());
  });

  app.get('/screen', (req, res) => {
    res.sendFile(path.join(publicDir, 'screen.html'));
  });

  app.get('/qr.svg', async (req, res) => {
    const qr = await qrResponse(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
    if (qr.status === 200) res.set('Cache-Control', 'public, max-age=300');
    res.status(qr.status).type(qr.type).send(qr.body);
  });

  app.use(express.static(publicDir));

  wss.on('connection', (ws) => {
    const id = randomUUID();
    ws.on('message', (data) => room.receive(id, data.toString()));
    ws.on('close', () => room.disconnect(id));
    room.connect(id, (text) => ws.send(text));
  });

  httpServer.on('close', () => room.close());

  return { app, httpServer, wss, room, game: room.game };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createDriverServer();
  httpServer.listen(port, () => {
    console.log(`Driver listening on http://localhost:${port} (screen: /screen)`);
  });
}

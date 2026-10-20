import { DurableObject } from 'cloudflare:workers';
import { Room } from '../lib/room.js';
import { qrResponse } from '../lib/qr.js';

// Static files in public/ are served by Workers assets before this runs.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/qr.svg') {
      const qr = await qrResponse(request.url);
      const headers = { 'Content-Type': qr.type };
      if (qr.status === 200) headers['Cache-Control'] = 'public, max-age=300';
      return new Response(qr.body, { status: qr.status, headers });
    }
    if (url.pathname === '/health' || url.pathname === '/ws') {
      // Everyone shares one room, so one Durable Object holds the whole game.
      const stub = env.ROOM.get(env.ROOM.idFromName('main'));
      return stub.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = new Room();
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/health') return Response.json(this.room.health());
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const id = crypto.randomUUID();
    server.addEventListener('message', (event) => this.room.receive(id, event.data));
    server.addEventListener('close', () => this.room.disconnect(id));
    server.addEventListener('error', () => this.room.disconnect(id));
    this.room.connect(id, (text) => server.send(text));
    return new Response(null, { status: 101, webSocket: client });
  }
}

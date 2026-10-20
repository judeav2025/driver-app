import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDriverServer } from '../server.js';

// QA: a room's worth of phones over real WebSockets — everyone joins, gets the race, and is ranked.
const PHONES = 30;

function ws(url) {
  const sock = new WebSocket(url);
  const got = [];
  sock.addEventListener('message', (m) => got.push(JSON.parse(m.data)));
  return { sock, got, has: (e) => got.some(([ev]) => ev === e), send: (e, d) => sock.send(JSON.stringify([e, d])) };
}

const waitFor = async (check, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test(`${PHONES} phones join, race and all land on the leaderboard`, async (t) => {
  const server = createDriverServer({ countdownMs: 50, raceMs: 200 });
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  const url = `ws://localhost:${server.httpServer.address().port}/ws`;
  const clients = [];
  t.after(() => {
    for (const c of clients) c.sock.close();
    for (const c of server.wss.clients) c.terminate();
    server.wss.close();
    server.httpServer.close();
  });

  const screen = ws(url);
  clients.push(screen);
  const phones = Array.from({ length: PHONES }, () => ws(url));
  clients.push(...phones);
  await Promise.all(clients.map((c) => once(c.sock, 'open')));

  phones.forEach((p, i) => p.send('join', { name: `Bot ${i + 1}` }));
  await waitFor(() => phones.every((p) => p.has('welcome')));
  assert.equal(server.room.health().players, PHONES);

  // Everyone steers at ~15 Hz for a moment, like real phones.
  const steer = setInterval(() => phones.forEach((p) => p.send('state', { x: Math.random() * 2 - 1 })), 66);
  t.after(() => clearInterval(steer));

  screen.send('start');
  await waitFor(() => phones.every((p) => p.has('start')));
  const seeds = new Set(phones.map((p) => p.got.find(([e]) => e === 'start')[1].seed));
  assert.equal(seeds.size, 1, 'every phone races the same course');

  await waitFor(() => phones.every((p) => p.has('end')));
  clearInterval(steer);
  const [, end] = screen.got.find(([e]) => e === 'end');
  assert.equal(end.leaderboard.length, PHONES);
  assert.ok(screen.got.filter(([e]) => e === 'snapshot').length > 1, 'screen kept getting snapshots');
});

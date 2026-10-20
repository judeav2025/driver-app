import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { createDriverServer } from '../server.js';

async function startServer(t, options) {
  const server = createDriverServer(options);
  server.httpServer.listen(0);
  await once(server.httpServer, 'listening');
  const base = `http://localhost:${server.httpServer.address().port}`;
  t.after(() => {
    server.io.close();
    server.httpServer.close();
  });
  return { ...server, base };
}

function client(t, base) {
  const socket = connect(base, { transports: ['websocket'], forceNew: true });
  t.after(() => socket.close());
  return socket;
}

// Resolves with the first snapshot that satisfies the predicate.
function snapshotWhere(socket, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for snapshot')), timeoutMs);
    const onSnap = (snap) => {
      if (!predicate(snap)) return;
      clearTimeout(timer);
      socket.off('snapshot', onSnap);
      resolve(snap);
    };
    socket.on('snapshot', onSnap);
  });
}

test('/health reports player count', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, players: 0, phase: 'lobby' });
});

test('pages and the socket.io client are served', async (t) => {
  const { base } = await startServer(t);
  for (const [path, needle] of [
    ['/', 'Start your engine'],
    ['/screen', 'id="qr"'],
    ['/js/phone.js', 'deviceorientation'],
    ['/js/course.js', 'buildCourse'],
    ['/socket.io/socket.io.js', 'io'],
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.ok((await res.text()).includes(needle), path);
  }
});

test('/qr.svg encodes a URL and rejects non-http targets', async (t) => {
  const { base } = await startServer(t);
  const ok = await fetch(`${base}/qr.svg?u=${encodeURIComponent('https://example.com/')}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await ok.text(), /^<svg/);
  const fallback = await fetch(`${base}/qr.svg`);
  assert.equal(fallback.status, 200);
  const bad = await fetch(`${base}/qr.svg?u=${encodeURIComponent('javascript:alert(1)')}`);
  assert.equal(bad.status, 400);
});

test('a joined player is welcomed and their x is relayed to everyone', async (t) => {
  const { base } = await startServer(t);
  const screen = client(t, base);
  const phone = client(t, base);

  phone.emit('join', {});
  const [welcome] = await once(phone, 'welcome');
  assert.equal(welcome.id, phone.id);
  assert.equal(welcome.x, 0);
  assert.ok(welcome.name && welcome.color);

  await snapshotWhere(screen, (s) => s.players.some((p) => p.id === phone.id));

  phone.emit('state', { x: 0.42 });
  const moved = await snapshotWhere(screen, (s) => s.players.find((p) => p.id === phone.id)?.x === 0.42);
  assert.equal(moved.players.length, 1);

  phone.emit('state', { x: 9 });
  await snapshotWhere(screen, (s) => s.players.find((p) => p.id === phone.id)?.x === 1);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.players, 1);
});

test('a second tab sees the first player, and leaving removes the car', async (t) => {
  const { base } = await startServer(t);
  const a = client(t, base);
  a.emit('join', {});
  await once(a, 'welcome');

  const b = client(t, base);
  b.emit('join', {});
  await once(b, 'welcome');
  await snapshotWhere(b, (s) => s.players.length === 2);

  a.close();
  const after = await snapshotWhere(b, (s) => s.players.length === 1);
  assert.equal(after.players[0].id, b.id);
});

test('joining twice on one socket does not duplicate the car', async (t) => {
  const { base, game } = await startServer(t);
  const phone = client(t, base);
  phone.emit('join', {});
  await once(phone, 'welcome');
  phone.emit('join', {});
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(game.count, 1);
});

test('state from a socket that never joined is ignored', async (t) => {
  const { base, game } = await startServer(t);
  const lurker = client(t, base);
  await once(lurker, 'connect');
  lurker.emit('state', { x: 0.5 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(game.count, 0);
});

test('the screen starts a race; everyone gets the seed, crashes are counted, results arrive at the end', async (t) => {
  const { base } = await startServer(t, { countdownMs: 50, raceMs: 300 });
  const screen = client(t, base);
  const phone = client(t, base);
  phone.emit('join', {});
  await once(phone, 'welcome');

  phone.emit('start'); // players can't start the race
  await new Promise((r) => setTimeout(r, 50));

  const phoneStart = once(phone, 'start');
  screen.emit('start');
  const [start] = await once(screen, 'start');
  assert.deepEqual((await phoneStart)[0].seed, start.seed);
  assert.equal(start.durationMs, 300);
  assert.ok(start.startsInMs > 0 && start.startsInMs <= 50);

  // A screen opened mid-race picks it up straight away.
  await new Promise((r) => setTimeout(r, 80));
  const late = client(t, base);
  const [lateStart] = await once(late, 'start');
  assert.equal(lateStart.seed, start.seed);
  assert.ok(lateStart.startsInMs < 0);

  phone.emit('crash');
  await snapshotWhere(screen, (s) => s.players[0]?.crashes === 1);

  const [{ leaderboard }] = await once(screen, 'end');
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].id, phone.id);
  assert.equal(leaderboard[0].crashes, 1);

  // Screens that connect after the race see the results.
  const after = client(t, base);
  const [{ leaderboard: again }] = await once(after, 'end');
  assert.deepEqual(again, leaderboard);
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.phase, 'results');
});

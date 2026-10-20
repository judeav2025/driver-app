import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../lib/room.js';

// QA: the room must shrug off junk and out-of-order messages without crashing or changing state.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(t, options = { countdownMs: 60, raceMs: 150 }) {
  const room = new Room(options);
  const inbox = new Map();
  const connect = (id) => {
    inbox.set(id, []);
    room.connect(id, (text) => inbox.get(id).push(JSON.parse(text)));
  };
  const events = (id, name) => inbox.get(id).filter(([e]) => e === name).map(([, d]) => d);
  const raw = (id, text) => room.receive(id, text);
  const send = (id, event, data) => raw(id, JSON.stringify([event, data]));
  t.after(() => {
    for (const id of [...room.clients.keys()]) room.disconnect(id);
    clearTimeout(room.endTimer);
  });
  return { room, game: room.game, connect, events, raw, send };
}

test('junk messages are ignored and the room keeps working', (t) => {
  const r = setup(t);
  r.connect('phone');
  for (const junk of ['not json', '{"a":1}', '42', 'null', '[]', '["nope", {}]', '[1,2,3]', '']) {
    assert.doesNotThrow(() => r.raw('phone', junk), `junk: ${junk}`);
  }
  assert.doesNotThrow(() => r.room.receive('phone', { not: 'a string' }));
  assert.doesNotThrow(() => r.room.receive('phone', Buffer.from('["join",{}]')));
  assert.equal(r.game.count, 0, 'nothing joined from junk');
  r.send('phone', 'join', { name: 'Still Works' });
  assert.equal(r.game.count, 1);
});

test('messages over 1 KB are dropped', (t) => {
  const r = setup(t);
  r.connect('phone');
  r.send('phone', 'join', { name: 'x'.repeat(2000) });
  assert.equal(r.game.count, 0);
});

test('messages from an unknown or disconnected connection are ignored', (t) => {
  const r = setup(t);
  r.send('ghost', 'join', {});
  assert.equal(r.game.count, 0);
  r.connect('phone');
  r.room.disconnect('phone');
  r.send('phone', 'join', {});
  assert.equal(r.game.count, 0);
});

test('bad steering values never move a car off the road', (t) => {
  const r = setup(t);
  r.connect('phone');
  r.send('phone', 'join', {});
  const car = () => r.game.players.get('phone');
  for (const x of [NaN, null, '0.5', {}, [], undefined]) {
    r.send('phone', 'state', { x });
    assert.equal(car().x, 0, `ignored x=${String(x)}`);
  }
  r.raw('phone', '["state",{"x":1e999}]'); // Infinity after JSON.parse
  assert.equal(car().x, 0);
  r.send('phone', 'state', { x: 999 });
  assert.equal(car().x, 1);
  r.send('phone', 'state', { x: -999 });
  assert.equal(car().x, -1);
  r.send('phone', 'state', null);
  assert.equal(car().x, -1);
});

test('crashes only count for joined players during the race', async (t) => {
  const r = setup(t);
  r.connect('screen');
  r.connect('phone');
  r.connect('watcher');
  r.send('phone', 'join', {});
  r.send('phone', 'crash');
  assert.equal(r.game.players.get('phone').crashes, 0, 'lobby crash ignored');

  r.send('screen', 'start');
  r.send('phone', 'crash');
  assert.equal(r.game.players.get('phone').crashes, 0, 'countdown crash ignored');

  await sleep(90);
  r.send('phone', 'crash');
  r.send('phone', 'crash');
  r.send('watcher', 'crash');
  assert.equal(r.game.players.get('phone').crashes, 1, 'second crash while spinning ignored');

  await sleep(180);
  r.send('phone', 'crash');
  assert.equal(r.game.phase, 'results');
  assert.equal(r.game.players.get('phone').crashes, 1, 'crash after the finish ignored');
});

test('names: empty, emoji-only, too long and duplicate', (t) => {
  const r = setup(t);
  for (const id of ['a', 'b', 'c', 'd', 'e']) r.connect(id);
  r.send('a', 'join', { name: '' });
  r.send('b', 'join', { name: '🚗🚗🚗' });
  r.send('c', 'join', { name: 'A'.repeat(100) });
  r.send('d', 'join', { name: 'Sam' });
  r.send('e', 'join', { name: 'sam' });
  const name = (id) => r.events(id, 'welcome')[0].name;
  assert.ok(name('a').length > 0, 'empty name gets a random one');
  assert.ok(name('b').length > 0 && !name('b').includes('🚗'), 'emoji-only falls back');
  assert.ok(name('c').length <= 24, 'long name is cut');
  assert.equal(name('d'), 'Sam');
  assert.equal(name('e'), 'sam (2)');
});

test('a player who leaves mid-race is not on the leaderboard', async (t) => {
  const r = setup(t);
  r.connect('screen');
  r.connect('stays');
  r.connect('quits');
  r.send('stays', 'join', { name: 'Stays' });
  r.send('quits', 'join', { name: 'Quits' });
  r.send('screen', 'start');
  await sleep(90);
  r.room.disconnect('quits');
  await sleep(180);
  const [end] = r.events('screen', 'end');
  assert.deepEqual(end.leaderboard.map((p) => p.name), ['Stays']);
});

// Finding to confirm with the team: the button is disabled with no cars, but the server
// itself will still start a race for an empty room if a screen sends 'start'.
test('FINDING: server accepts Start with zero players (UI-only guard)', (t) => {
  const r = setup(t);
  r.connect('screen');
  r.send('screen', 'start');
  assert.equal(r.game.phase, 'countdown');
});

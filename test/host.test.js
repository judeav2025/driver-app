import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../lib/room.js';

// The big screen's host controls: kick one, kick everyone, end early, abandon.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(t) {
  const room = new Room({ countdownMs: 20, raceMs: 5_000 });
  const inbox = new Map();
  const connect = (id) => {
    inbox.set(id, []);
    room.connect(id, (text) => inbox.get(id).push(JSON.parse(text)));
  };
  const events = (id, name) => inbox.get(id).filter(([e]) => e === name).map(([, d]) => d);
  const send = (id, event, data) => room.receive(id, JSON.stringify([event, data]));
  const join = (id) => {
    connect(id);
    send(id, 'join', { name: id });
  };
  t.after(() => {
    for (const id of [...room.clients.keys()]) room.disconnect(id);
    clearTimeout(room.endTimer);
  });
  connect('screen');
  return { room, game: room.game, events, send, join };
}

test('the screen can kick one player, who is told and cannot rejoin on that socket', (t) => {
  const r = setup(t);
  r.join('a');
  r.join('b');
  r.send('screen', 'kick', { id: 'a' });
  assert.deepEqual([...r.game.players.keys()], ['b']);
  assert.equal(r.events('a', 'kicked').length, 1);
  assert.equal(r.events('b', 'kicked').length, 0);
  r.send('a', 'join', { name: 'a' });
  assert.equal(r.game.count, 1, 'kicked socket stays out');
  r.send('a', 'start');
  assert.equal(r.game.phase, 'lobby', 'kicked socket cannot use host controls either');
});

test('the screen can kick everyone', (t) => {
  const r = setup(t);
  for (const id of ['a', 'b', 'c']) r.join(id);
  r.send('screen', 'kickAll');
  assert.equal(r.game.count, 0);
  for (const id of ['a', 'b', 'c']) assert.equal(r.events(id, 'kicked').length, 1);
  assert.equal(r.events('screen', 'kicked').length, 0);
});

test('phones cannot kick, end or reset', (t) => {
  const r = setup(t);
  r.join('a');
  r.join('b');
  r.send('screen', 'start');
  r.send('a', 'kick', { id: 'b' });
  r.send('a', 'kickAll');
  r.send('a', 'endRace');
  r.send('a', 'reset');
  assert.equal(r.game.count, 2);
  assert.ok(r.game.race, 'race still on');
});

test('the screen can end a race early; everyone gets the results', async (t) => {
  const r = setup(t);
  r.join('a');
  r.send('screen', 'start');
  await sleep(60);
  r.send('screen', 'endRace');
  assert.equal(r.game.phase, 'results');
  const [end] = r.events('a', 'end');
  assert.equal(end.leaderboard.length, 1);
  assert.equal(r.room.endTimer, null, 'the finish timer is cancelled');
});

test('the screen can abandon a race and go back to the lobby', (t) => {
  const r = setup(t);
  r.join('a');
  r.send('screen', 'start');
  r.send('screen', 'reset');
  assert.equal(r.game.phase, 'lobby');
  assert.equal(r.events('a', 'reset').length, 1);
  assert.equal(r.events('a', 'end').length, 0, 'no results for an abandoned race');
  r.send('screen', 'start');
  assert.equal(r.game.phase, 'countdown', 'a new race can start');
});

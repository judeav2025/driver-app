import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../lib/room.js';

// QA: "press Start, the race starts" — flag-off flow through the Room, no network.
const COUNTDOWN = 60;
const RACE = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const room = new Room({ countdownMs: COUNTDOWN, raceMs: RACE });
  const inbox = new Map();
  const connect = (id) => {
    inbox.set(id, []);
    room.connect(id, (text) => inbox.get(id).push(JSON.parse(text)));
  };
  const events = (id, name) => inbox.get(id).filter(([e]) => e === name).map(([, d]) => d);
  const send = (id, event, data) => room.receive(id, JSON.stringify([event, data]));
  const close = () => {
    for (const id of [...room.clients.keys()]) room.disconnect(id);
    clearTimeout(room.endTimer);
  };
  return { room, connect, events, send, close };
}

test('lobby before anyone presses Start', () => {
  const t = setup();
  t.connect('screen');
  t.connect('phone');
  t.send('phone', 'join', { name: 'Turbo Potato' });
  assert.equal(t.room.health().phase, 'lobby');
  assert.equal(t.events('phone', 'start').length, 0);
  t.close();
});

test('Start from the big screen: countdown → racing → results', async () => {
  const t = setup();
  t.connect('screen');
  t.connect('phone');
  t.send('phone', 'join', { name: 'Turbo Potato' });

  t.send('screen', 'start');
  assert.equal(t.room.health().phase, 'countdown');
  const [info] = t.events('phone', 'start');
  assert.ok(info, 'phone got the start message');
  assert.ok(info.startsInMs > 0 && info.startsInMs <= COUNTDOWN);
  assert.equal(info.durationMs, RACE);
  assert.deepEqual(t.events('screen', 'start'), [info], 'screen and phone get the same race');

  await sleep(COUNTDOWN + 40);
  assert.equal(t.room.health().phase, 'racing');

  await sleep(RACE + 60);
  assert.equal(t.room.health().phase, 'results');
  const [end] = t.events('phone', 'end');
  assert.equal(end.leaderboard.length, 1);
  assert.equal(end.leaderboard[0].name, 'Turbo Potato');
  t.close();
});

test('a phone cannot start the race', () => {
  const t = setup();
  t.connect('phone');
  t.send('phone', 'join', {});
  t.send('phone', 'start');
  assert.equal(t.room.health().phase, 'lobby');
  assert.equal(t.events('phone', 'start').length, 0);
  t.close();
});

test('pressing Start again mid-race does not restart it', () => {
  const t = setup();
  t.connect('screen');
  t.connect('phone');
  t.send('phone', 'join', {});
  t.send('screen', 'start');
  const first = t.room.game.race;
  t.send('screen', 'start');
  assert.equal(t.room.game.race, first);
  assert.equal(t.events('phone', 'start').length, 1);
  t.close();
});

test('a phone joining mid-race is told the race is on', () => {
  const t = setup();
  t.connect('screen');
  t.send('screen', 'start');
  t.connect('late');
  assert.equal(t.events('late', 'start').length, 1);
  t.close();
});

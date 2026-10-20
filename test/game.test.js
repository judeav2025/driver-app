import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../lib/game.js';
import { randomName, cleanName, cleanColor, COLORS } from '../lib/names.js';
import { buildCourse, COIN_POINTS } from '../public/js/course.js';

test('join assigns a funny name, a palette colour and centres the car', () => {
  const game = new Game();
  const p = game.join('a');
  assert.match(p.name, /^\w+ \w+$/);
  assert.ok(COLORS.includes(p.color));
  assert.equal(p.x, 0);
  assert.equal(game.count, 1);
});

test('rejoin can keep its name and colour; junk is replaced', () => {
  const game = new Game();
  assert.equal(game.join('a', { name: 'Wobbly Moose', color: COLORS[2] }).name, 'Wobbly Moose');
  assert.equal(game.join('b', { color: COLORS[2] }).color, COLORS[2]);
  const junk = game.join('c', { name: '<script>', color: 'red' });
  assert.notEqual(junk.name, '<script>');
  assert.ok(COLORS.includes(junk.color));
});

test('players get distinct rows in join order', () => {
  const game = new Game();
  const rows = ['a', 'b', 'c'].map((id) => game.join(id).row);
  assert.deepEqual(rows, [0, 1, 2]);
});

test('state clamps x and ignores bad input', () => {
  const game = new Game();
  game.join('a');
  game.setState('a', { x: 5 });
  assert.equal(game.players.get('a').x, 1);
  game.setState('a', { x: -5 });
  assert.equal(game.players.get('a').x, -1);
  assert.equal(game.setState('a', { x: 'nope' }), false);
  assert.equal(game.setState('a', null), false);
  assert.equal(game.setState('ghost', { x: 0 }), false);
  assert.equal(game.players.get('a').x, -1);
});

test('snapshots are only produced when something changed', () => {
  const game = new Game();
  assert.equal(game.takeSnapshot(), null);
  game.join('a');
  assert.equal(game.takeSnapshot().players.length, 1);
  assert.equal(game.takeSnapshot(), null);
  game.setState('a', { x: 0 }); // unchanged
  assert.equal(game.takeSnapshot(), null);
  game.setState('a', { x: 0.5 });
  assert.equal(game.takeSnapshot().players[0].x, 0.5);
  game.leave('a');
  assert.deepEqual(game.takeSnapshot().players, []);
});

test('names are sanitised and bounded', () => {
  assert.equal(cleanName('  Turbo Llama  '), 'Turbo Llama');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName(42), null);
  assert.ok(cleanName('x'.repeat(100)).length <= 24);
  assert.equal(cleanColor('#nothex'), null);
  assert.match(randomName(() => 0), /^\w+ \w+$/);
});

function clock(start = 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('a race goes lobby → countdown → racing → results', () => {
  const c = clock();
  const game = new Game({ now: c.now, raceMs: 10_000, countdownMs: 3_000 });
  assert.equal(game.phase, 'lobby');
  const info = game.startRace(77);
  assert.deepEqual(info, { seed: 77, startsInMs: 3_000, durationMs: 10_000 });
  assert.equal(game.phase, 'countdown');
  assert.equal(game.startRace(), null, 'cannot start twice');
  c.t += 3_000;
  assert.equal(game.phase, 'racing');
  assert.equal(game.raceInfo().startsInMs, 0);
  c.t += 5_000;
  assert.equal(game.raceInfo().startsInMs, -5_000, 'late joiners learn how far in we are');
  c.t += 5_000;
  game.endRace();
  assert.equal(game.phase, 'results');
  assert.ok(game.startRace(), 'can race again');
  assert.equal(game.leaderboard, null);
});

test('crashes count only while racing and not while already spinning', () => {
  const c = clock();
  const game = new Game({ now: c.now, raceMs: 10_000, countdownMs: 1_000 });
  game.join('a');
  assert.equal(game.crash('a'), false, 'no race');
  game.startRace(1);
  assert.equal(game.crash('a'), false, 'countdown');
  c.t += 1_000;
  assert.equal(game.crash('a'), true);
  c.t += 100;
  assert.equal(game.crash('a'), false, 'still spinning');
  c.t += 2_000;
  assert.equal(game.crash('a'), true);
  assert.equal(game.crash('nobody'), false);
  assert.equal(game.snapshot().players[0].crashes, 2);
});

test('leaderboard ranks by score, crashes cost points, late joiners score from joining', () => {
  const c = clock();
  const game = new Game({ now: c.now, raceMs: 10_000, countdownMs: 0 });
  game.join('clean', { name: 'Clean Car' });
  game.join('crashy', { name: 'Crashy Car' });
  game.startRace(1);
  c.t += 1_000;
  game.crash('crashy');
  c.t += 5_000;
  game.join('late', { name: 'Late Car' });
  c.t += 4_000;
  const { leaderboard } = game.endRace();
  assert.deepEqual(leaderboard.map((r) => [r.name, r.score, r.crashes]), [
    ['Clean Car', 100, 0],
    ['Crashy Car', 50, 1],
    ['Late Car', 40, 0],
  ]);
});

test('starting a new race resets crashes', () => {
  const c = clock();
  const game = new Game({ now: c.now, raceMs: 1_000, countdownMs: 0 });
  game.join('a');
  game.startRace(1);
  game.crash('a');
  game.endRace();
  game.startRace(2);
  assert.equal(game.players.get('a').crashes, 0);
});

test('typed names are kept as cleaned; empty or all-symbol names fall back to a random one', () => {
  const game = new Game();
  assert.equal(game.join('a', { name: '  Sam  ' }).name, 'Sam');
  assert.equal(game.join('b', { name: 'Zoë 🚗🔥 #1!' }).name, 'Zoë 1');
  assert.equal(game.join('c', { name: 'x'.repeat(30) }).name, 'x'.repeat(24));
  assert.match(game.join('d', { name: '' }).name, /^\w+ \w+$/);
  assert.match(game.join('e', { name: '🚗🚗' }).name, /^\w+ \w+$/);
});

test('a second player with the same name gets a suffix, case-insensitively', () => {
  const game = new Game();
  assert.equal(game.join('a', { name: 'Sam' }).name, 'Sam');
  assert.equal(game.join('b', { name: 'sam' }).name, 'sam (2)');
  assert.equal(game.join('c', { name: 'Sam' }).name, 'Sam (3)');
  game.leave('a');
  assert.equal(game.join('d', { name: 'Sam' }).name, 'Sam', 'free again once they leave');
  const long = 'y'.repeat(24);
  game.join('e', { name: long });
  const dup = game.join('f', { name: long }).name;
  assert.equal(dup, `${'y'.repeat(20)} (2)`);
  assert.ok(dup.length <= 24);
});

test('a reconnecting phone keeps its exact name, suffix included, even if its old connection lingers', () => {
  const game = new Game();
  game.join('a', { name: 'Sam' });
  const second = game.join('b', { name: 'Sam' });
  assert.equal(second.name, 'Sam (2)');
  // Old socket "b" hasn't timed out yet when the phone comes back as "b2".
  const back = game.join('b2', { name: second.name, color: second.color });
  assert.equal(back.name, 'Sam (2)');
  assert.equal(back.color, second.color);
});

// A seed whose course has a pickup of this kind, and that pickup's index.
function seedWith(kind) {
  for (let seed = 1; ; seed++) {
    const i = buildCourse(seed, 60_000).pickups.findIndex((p) => p.kind === kind);
    if (i >= 0) return { seed, i };
  }
}

test('pickups count only while racing, once each; coins add to the score', () => {
  const c = clock();
  const game = new Game({ now: c.now, raceMs: 60_000, countdownMs: 1_000 });
  game.join('a', { name: 'Coin Car' });
  game.join('b', { name: 'Plain Car' });
  const coin = seedWith('coin');
  assert.equal(game.pickup('a', coin.i), false, 'no race');
  game.startRace(coin.seed);
  assert.equal(game.pickup('a', coin.i), false, 'countdown');
  c.t += 1_000;
  assert.equal(game.pickup('a', coin.i), true);
  assert.equal(game.pickup('a', coin.i), false, 'already taken');
  assert.equal(game.pickup('b', coin.i), true, 'everyone gets their own');
  assert.equal(game.pickup('a', 9999), false);
  assert.equal(game.pickup('a', '1'), false);
  assert.equal(game.pickup('nobody', 0), false);
  const snap = game.snapshot().players.find((p) => p.id === 'a');
  assert.equal(snap.pickups, 1);
  assert.equal(snap.lastPickup, 'coin');
  assert.equal(snap.coins, 1, 'so the live scoreboard can count coins');

  c.t += 60_000;
  const { leaderboard } = game.endRace();
  assert.deepEqual(leaderboard.map((r) => [r.name, r.coins, r.score]), [
    ['Coin Car', 1, 600 + COIN_POINTS],
    ['Plain Car', 1, 600 + COIN_POINTS],
  ]);
});

test('non-coin pickups are recorded but do not score, and a new race resets them', () => {
  const c = clock();
  const game = new Game({ now: c.now, raceMs: 60_000, countdownMs: 0 });
  game.join('a');
  const mirror = seedWith('mirror');
  game.startRace(mirror.seed);
  assert.equal(game.pickup('a', mirror.i), true);
  assert.equal(game.snapshot().players[0].lastPickup, 'mirror');
  c.t += 60_000;
  assert.equal(game.endRace().leaderboard[0].score, 600);
  game.startRace(mirror.seed);
  assert.equal(game.players.get('a').pickups, 0);
  assert.equal(game.pickup('a', mirror.i), true, 'can be taken again next race');
});

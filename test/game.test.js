import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../lib/game.js';
import { randomName, cleanName, cleanColor, COLORS } from '../lib/names.js';

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

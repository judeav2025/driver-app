import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, buildCourse, distanceAt, speedAt, findCrash, hitsBox, scoreFor,
  RACE_MS, SPEED_START, SPEED_END, SPIN_MS, CAR_HALF_W, BOX_HALF, CRASH_PENALTY,
} from '../public/js/course.js';
import { SPEED as STEER_SPEED, integrate } from '../public/js/steer.js';

test('the PRNG is deterministic per seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 5 }, a);
  assert.deepEqual(seqA, Array.from({ length: 5 }, b));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, mulberry32(43)));
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('same seed builds the same course on every device', () => {
  assert.deepEqual(buildCourse(1234), buildCourse(1234));
  assert.notDeepEqual(buildCourse(1234).boxes, buildCourse(4321).boxes);
});

test('distance integrates a speed that ramps from start to finish', () => {
  const T = RACE_MS / 1000;
  assert.equal(distanceAt(0), 0);
  assert.equal(distanceAt(-1), 0);
  assert.equal(speedAt(0), SPEED_START);
  assert.equal(speedAt(T), SPEED_END);
  assert.ok(Math.abs(distanceAt(T) - ((SPEED_START + SPEED_END) / 2) * T) < 1e-9);
  assert.ok(Math.abs(distanceAt(T + 1) - distanceAt(T) - SPEED_END) < 1e-9);
});

test('boxes stay on the road, are sorted, and start after a clear run-up', () => {
  for (const seed of [1, 2, 3, 99, 2 ** 32 - 1]) {
    const course = buildCourse(seed);
    assert.ok(course.boxes.length > 30, `seed ${seed} has boxes`);
    assert.ok(course.boxes[0].y >= distanceAt(2));
    for (let i = 0; i < course.boxes.length; i++) {
      const b = course.boxes[i];
      assert.ok(b.x >= -1 && b.x <= 1);
      assert.ok(b.y < course.finish);
      if (i) assert.ok(b.y >= course.boxes[i - 1].y);
    }
  }
});

test('every row leaves a gap a car can reach in time', () => {
  for (let seed = 0; seed < 50; seed++) {
    const { rows } = buildCourse(seed);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (const x of row.boxes) assert.ok(Math.abs(x - row.freeX) >= CAR_HALF_W + BOX_HALF, `seed ${seed} row ${i}`);
      if (!i) continue;
      const sec = (row.y - rows[i - 1].y) / SPEED_END;
      assert.ok(Math.abs(row.freeX - rows[i - 1].freeX) <= STEER_SPEED * sec, `seed ${seed} row ${i} reachable`);
    }
  }
});

test('a perfect driver following the gap never crashes', () => {
  const course = buildCourse(7);
  const hit = new Set();
  let x = 0;
  let row = 0;
  const dt = 1 / 60;
  for (let t = 0; t < RACE_MS / 1000; t += dt) {
    const dist = distanceAt(t);
    while (row < course.rows.length - 1 && course.rows[row].y < dist - 0.5) row++;
    const target = course.rows[row].freeX;
    const steer = Math.max(-1, Math.min(1, (target - x) * 20));
    x = integrate(x, steer, dt);
    assert.equal(findCrash(course, x, dist, hit), -1, `crashed at t=${t.toFixed(2)}`);
  }
});

test('driving straight down the middle does hit something', () => {
  const course = buildCourse(7);
  const hit = new Set();
  let crashes = 0;
  for (let t = 0; t < RACE_MS / 1000; t += 1 / 60) {
    const i = findCrash(course, 0, distanceAt(t), hit);
    if (i >= 0) {
      hit.add(i);
      crashes++;
    }
  }
  assert.ok(crashes > 0);
});

test('collisions use overlapping boxes and skip boxes already hit', () => {
  const box = { x: 0.5, y: 10 };
  assert.ok(hitsBox(0.5, 10, box));
  assert.ok(!hitsBox(0.5 - (CAR_HALF_W + BOX_HALF) - 0.01, 10, box));
  assert.ok(!hitsBox(0.5, 11, box));
  const course = { boxes: [{ x: 0, y: 5 }, box, { x: -0.5, y: 20 }] };
  assert.equal(findCrash(course, 0.5, 10, new Set()), 1);
  assert.equal(findCrash(course, 0.5, 10, new Set([1])), -1);
  assert.equal(findCrash(course, -0.5, 20, new Set()), 2);
});

test('score rewards time driven and penalises crashes', () => {
  assert.equal(scoreFor(60, 0), 600);
  assert.equal(scoreFor(60, 2), 600 - 2 * CRASH_PENALTY);
  assert.equal(scoreFor(-5, 0), 0);
  assert.ok(SPIN_MS > 0);
});

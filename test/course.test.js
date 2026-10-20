import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, buildCourse, distanceAt, speedAt, findCrash, hitsBox, scoreFor,
  findPedestrian, findPickup, pedestrianAt,
  RACE_MS, SPEED_START, SPEED_END, SPIN_MS, CAR_HALF_W, CAR_HALF_L, BOX_HALF, CRASH_PENALTY,
  PED_EDGE, PED_HALF, PICKUP_HALF, PICKUPS, COIN_POINTS, leadFor, MAX_LEAD, LEAD_PTS, LEAD_RATE,
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
  assert.equal(scoreFor(60, 1, 3), 600 - CRASH_PENALTY + 3 * COIN_POINTS);
  assert.equal(scoreFor(-5, 0), 0);
  assert.ok(SPIN_MS > 0);
});

test('drivers ahead on points pull ahead of the pack, up to a limit', () => {
  assert.equal(leadFor(500, [500]), 0, 'racing alone: no lead');
  assert.equal(leadFor(500, [500, 500, 500]), 0, 'all level: no lead');
  assert.equal(leadFor(400, [400, 600]), 0, 'behind the average: no lead');
  assert.equal(leadFor(600, [400, 600]), (100 / LEAD_PTS) * MAX_LEAD);
  assert.equal(leadFor(2000, [0, 2000]), MAX_LEAD);
  assert.ok(LEAD_RATE < SPEED_START, 'losing the lead never drives a car backwards');
});

test('pedestrians and pickups are seeded, sorted, on the road and clear of the box rows', () => {
  assert.deepEqual(buildCourse(5).pedestrians, buildCourse(5).pedestrians);
  assert.deepEqual(buildCourse(5).pickups, buildCourse(5).pickups);
  for (let seed = 0; seed < 20; seed++) {
    const { rows, pedestrians, pickups, finish } = buildCourse(seed);
    assert.ok(pedestrians.length > 5, `seed ${seed} has pedestrians`);
    assert.ok(pickups.length > 5, `seed ${seed} has pickups`);
    for (const list of [pedestrians, pickups]) {
      for (let i = 0; i < list.length; i++) {
        assert.ok(list[i].y < finish);
        if (i) assert.ok(list[i].y > list[i - 1].y);
        // Never overlapping a box row, so they don't block the guaranteed gap.
        for (const row of rows) assert.ok(Math.abs(row.y - list[i].y) > BOX_HALF + PICKUP_HALF + CAR_HALF_L);
      }
    }
    for (const item of pickups) {
      assert.ok(item.kind in PICKUPS);
      assert.ok(Math.abs(item.x) <= 0.85);
    }
  }
});

test('pedestrians walk edge to edge and back, and later ones are weirder', () => {
  const ped = { y: 10, phase: 0, speed: 0.5, emoji: '🚶' };
  assert.deepEqual(pedestrianAt(ped, 0), { x: -PED_EDGE, dir: 1 });
  const crossSec = (PED_EDGE * 2) / ped.speed;
  assert.ok(Math.abs(pedestrianAt(ped, crossSec / 2).x) < 1e-9);
  assert.equal(pedestrianAt(ped, crossSec * 1.5).dir, -1);
  for (let t = -5; t < 60; t += 0.37) assert.ok(Math.abs(pedestrianAt(ped, t).x) <= PED_EDGE + 1e-9);

  const { pedestrians } = buildCourse(3);
  const early = pedestrians.filter((p) => p.y < pedestrians.at(-1).y / 4);
  assert.ok(early.every((p) => ['🚶', '🏃', '🚶‍♀️', '🦆'].includes(p.emoji)), 'first quarter is mostly people');
});

test('pedestrian and pickup collisions follow where they are, and skip ones already done', () => {
  const ped = { y: 10, phase: 0, speed: 0.5, emoji: '🦆' };
  const course = { pedestrians: [ped], pickups: [{ x: 0.3, y: 20, kind: 'coin' }] };
  const { x } = pedestrianAt(ped, 4);
  assert.equal(findPedestrian(course, x, 10, 4, new Set()), 0);
  assert.equal(findPedestrian(course, x + CAR_HALF_W + PED_HALF + 0.01, 10, 4, new Set()), -1);
  assert.equal(findPedestrian(course, x, 10, 4, new Map([[0, {}]])), -1);
  assert.equal(findPedestrian(course, x, 11, 4, new Set()), -1);
  assert.equal(findPickup(course, 0.3, 20, new Set()), 0);
  assert.equal(findPickup(course, 0.3, 20, new Set([0])), -1);
  assert.equal(findPickup(course, -0.3, 20, new Set()), -1);
});

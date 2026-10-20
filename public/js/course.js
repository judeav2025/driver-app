// Course generation, collisions and scoring, shared by the phones, the big screen,
// the server and the tests. Every device builds the identical course from the seed.
//
// World units: x runs -1..1 across the road (car centres stay inside that), y is
// distance along the course in the same units.

import { SPEED as STEER_SPEED, clamp } from './steer.js';

export const RACE_MS = 60_000;
export const COUNTDOWN_MS = 3_000;

export const SPEED_START = 2.6; // units per second at the start
export const SPEED_END = 4.2; // ...ramping linearly to this at the finish

export const SPIN_MS = 1_200; // spin-out after hitting a box, no steering
export const POINTS_PER_SEC = 10;
export const CRASH_PENALTY = 50;

export const CAR_HALF_W = 0.11;
export const CAR_HALF_L = 0.12;
export const BOX_HALF = 0.13;
export const BOX_DRAW = 0.32; // drawn size; a bit bigger than the hitbox feels fair

const FIRST_BOX_SEC = 2.5;
const FREE_HALF = 0.5; // half-width of the guaranteed gap in every row

// Small, fast seeded PRNG. Same seed → same sequence on every device.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function speedAt(sec, durationMs = RACE_MS) {
  const T = durationMs / 1000;
  return SPEED_START + (SPEED_END - SPEED_START) * clamp(sec / T, 0, 1);
}

// Distance travelled after `sec` seconds: the integral of speedAt.
export function distanceAt(sec, durationMs = RACE_MS) {
  if (sec <= 0) return 0;
  const T = durationMs / 1000;
  const a = (SPEED_END - SPEED_START) / T;
  const t = Math.min(sec, T);
  const d = SPEED_START * t + 0.5 * a * t * t;
  return d + Math.max(0, sec - T) * SPEED_END;
}

// Rows of boxes with a guaranteed gap (`freeX`) that drifts no faster than a car can steer.
export function buildCourse(seed, durationMs = RACE_MS) {
  const rand = mulberry32(seed);
  const T = durationMs / 1000;
  const finish = distanceAt(T, durationMs);
  const rows = [];
  const boxes = [];
  let y = distanceAt(FIRST_BOX_SEC, durationMs);
  let freeX = 0;

  while (y < finish - 2) {
    const progress = y / finish;
    const count = progress < 0.3 ? 1 : progress < 0.7 ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2);
    const row = { y, freeX, boxes: [] };
    for (let tries = 0; row.boxes.length < count && tries < 30; tries++) {
      const x = rand() * 2 - 1;
      if (Math.abs(x - freeX) < FREE_HALF) continue;
      if (row.boxes.some((b) => Math.abs(b - x) < BOX_HALF * 2.2)) continue;
      row.boxes.push(x);
      boxes.push({ x, y });
    }
    rows.push(row);

    const gap = 2.4 - 1.1 * progress;
    // Time to the next row at the speed we'll be doing there, and how far a car can steer in it.
    const sec = gap / SPEED_END;
    const reach = STEER_SPEED * sec * 0.6;
    freeX = clamp(freeX + (rand() * 2 - 1) * reach, -0.85, 0.85);
    y += gap;
  }

  return { seed, durationMs, finish, rows, boxes };
}

export function hitsBox(carX, dist, box) {
  return Math.abs(carX - box.x) < CAR_HALF_W + BOX_HALF && Math.abs(dist - box.y) < CAR_HALF_L + BOX_HALF;
}

// Index of the first box the car overlaps that it hasn't already hit, or -1.
// Boxes are sorted by y, so this only scans the stretch around the car.
export function findCrash(course, carX, dist, alreadyHit) {
  const { boxes } = course;
  const reach = CAR_HALF_L + BOX_HALF;
  let lo = 0;
  let hi = boxes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boxes[mid].y < dist - reach) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < boxes.length && boxes[i].y <= dist + reach; i++) {
    if (!alreadyHit.has(i) && hitsBox(carX, dist, boxes[i])) return i;
  }
  return -1;
}

export function scoreFor(secondsDriven, crashes) {
  return Math.round(Math.max(0, secondsDriven) * POINTS_PER_SEC) - crashes * CRASH_PENALTY;
}

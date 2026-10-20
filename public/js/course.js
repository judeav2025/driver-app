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

// The weird stuff: pedestrians (and animals) wander across the road, and pickups sit in
// the gaps between box rows. Hitting a pedestrian is a crash for you; they hop clear, unhurt.
export const PED_HALF = 0.09;
export const PED_EDGE = 1.05; // they walk edge to edge, just onto the kerb
export const PED_DRAW = 0.3;
export const PICKUP_HALF = 0.12;
export const PICKUP_DRAW = 0.3;
export const COIN_POINTS = 30;

// ms is how long the effect lasts (for a coin, how long its badge shows).
export const PICKUPS = {
  coin: { emoji: '🪙', ms: 900, text: `🪙 +${COIN_POINTS} pts` },
  star: { emoji: '⭐', ms: 5_000, text: '⭐ Invincible!' },
  mirror: { emoji: '🪞', ms: 6_000, text: '🪞 Mirror!\nSteering is flipped' },
  ink: { emoji: '🦑', ms: 4_500, text: '🦑 Squid ink!' },
};
const PICKUP_ODDS = [['coin', 0.4], ['star', 0.15], ['mirror', 0.25], ['ink', 0.2]];

// Later in the race the crowd gets stranger.
const WALKERS = ['🚶', '🏃', '🚶‍♀️', '🦆', '🐢', '🐧', '🐄', '🦩', '🦖', '🤖'];

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
  const extra = mulberry32(seed ^ 0x5eed5eed); // separate stream, so boxes don't depend on it
  const rows = [];
  const boxes = [];
  const pedestrians = [];
  const pickups = [];
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
    addExtra(extra, y + gap / 2, progress, finish, pedestrians, pickups);
    // Time to the next row at the speed we'll be doing there, and how far a car can steer in it.
    const sec = gap / SPEED_END;
    const reach = STEER_SPEED * sec * 0.6;
    freeX = clamp(freeX + (rand() * 2 - 1) * reach, -0.85, 0.85);
    y += gap;
  }

  return { seed, durationMs, finish, rows, boxes, pedestrians, pickups };
}

// Halfway between two box rows: a pedestrian, a pickup, or nothing. Pedestrians get likelier,
// faster and weirder as the race goes on.
function addExtra(rand, y, progress, finish, pedestrians, pickups) {
  if (y > finish - 2) return;
  const roll = rand();
  const pedOdds = 0.1 + 0.35 * progress;
  if (roll < pedOdds) {
    const pool = WALKERS.slice(0, 3 + Math.round(progress * (WALKERS.length - 3)));
    pedestrians.push({
      y,
      phase: rand() * 2,
      speed: 0.35 + rand() * (0.15 + 0.5 * progress),
      emoji: pool[Math.floor(rand() * pool.length)],
    });
  } else if (roll < pedOdds + 0.25) {
    let pick = rand();
    const [kind] = PICKUP_ODDS.find(([, odds]) => (pick -= odds) < 0) ?? PICKUP_ODDS[0];
    pickups.push({ x: rand() * 1.7 - 0.85, y, kind });
  }
}

// Where a pedestrian is `sec` seconds into the race: back and forth across the road.
// dir is +1 walking right, -1 walking left.
export function pedestrianAt(ped, sec) {
  const span = PED_EDGE * 2;
  const u = (((ped.phase + (sec * ped.speed) / span) % 2) + 2) % 2;
  const s = u < 1 ? u : 2 - u;
  return { x: -PED_EDGE + s * span, dir: u < 1 ? 1 : -1 };
}

const overlaps = (carX, dist, x, y, half) => Math.abs(carX - x) < CAR_HALF_W + half && Math.abs(dist - y) < CAR_HALF_L + half;

export function hitsBox(carX, dist, box) {
  return overlaps(carX, dist, box.x, box.y, BOX_HALF);
}

// Index of the first item the car overlaps that isn't in `done`, or -1.
// Items are sorted by y, so this only scans the stretch around the car.
function findOverlap(items, carX, dist, done, half, xOf = (item) => item.x) {
  const reach = CAR_HALF_L + half;
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].y < dist - reach) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < items.length && items[i].y <= dist + reach; i++) {
    if (!done.has(i) && overlaps(carX, dist, xOf(items[i]), items[i].y, half)) return i;
  }
  return -1;
}

export function findCrash(course, carX, dist, alreadyHit) {
  return findOverlap(course.boxes, carX, dist, alreadyHit, BOX_HALF);
}

// Pedestrians move, so this needs the race time too.
export function findPedestrian(course, carX, dist, sec, alreadyHit) {
  return findOverlap(course.pedestrians, carX, dist, alreadyHit, PED_HALF, (ped) => pedestrianAt(ped, sec).x);
}

export function findPickup(course, carX, dist, alreadyTaken) {
  return findOverlap(course.pickups, carX, dist, alreadyTaken, PICKUP_HALF);
}

export function scoreFor(secondsDriven, crashes, coins = 0) {
  return Math.round(Math.max(0, secondsDriven) * POINTS_PER_SEC) - crashes * CRASH_PENALTY + coins * COIN_POINTS;
}

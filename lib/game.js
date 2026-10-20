import { randomName, randomColor, cleanName, cleanColor, MAX_NAME } from './names.js';
import { RACE_MS, COUNTDOWN_MS, SPIN_MS, buildCourse, scoreFor } from '../public/js/course.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Authoritative list of who is connected and where their car is, plus the race clock.
// Phones simulate their own car and report crashes and pickups; the server keeps score.
export class Game {
  constructor({ now = Date.now, raceMs = RACE_MS, countdownMs = COUNTDOWN_MS } = {}) {
    this.players = new Map();
    this.dirty = false;
    this.nextRow = 0;
    this.now = now;
    this.raceMs = raceMs;
    this.countdownMs = countdownMs;
    this.race = null; // {seed, startAt, endAt, course}
    this.leaderboard = null; // set when a race ends, cleared when the next starts
  }

  join(id, { name, color } = {}) {
    // Only a reconnecting phone sends its colour back. It keeps its exact name, even if
    // its old connection hasn't timed out yet; new players get a suffix if the name is taken.
    const rejoin = Boolean(cleanColor(color));
    const base = cleanName(name) || randomName();
    const player = {
      id,
      name: rejoin ? base : this.uniqueName(base),
      color: cleanColor(color) || randomColor(),
      x: 0,
      row: this.nextRow++,
      crashes: 0,
      joinedAt: this.now(),
      lastCrashAt: -Infinity,
      ...freshPickups(),
    };
    this.players.set(id, player);
    this.dirty = true;
    return publicPlayer(player);
  }

  // "Sam", then "Sam (2)", "Sam (3)"..., so labels on the big screen stay tellable apart.
  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` (${n})`;
      const candidate = name.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  setState(id, state) {
    const player = this.players.get(id);
    if (!player || !state || !Number.isFinite(state.x)) return false;
    const x = clamp(state.x, -1, 1);
    if (x !== player.x) {
      player.x = x;
      this.dirty = true;
    }
    return true;
  }

  leave(id) {
    if (this.players.delete(id)) this.dirty = true;
  }

  get count() {
    return this.players.size;
  }

  // 'lobby' before the first race, 'countdown' → 'racing' during one, 'results' after.
  get phase() {
    if (!this.race) return this.leaderboard ? 'results' : 'lobby';
    return this.now() < this.race.startAt ? 'countdown' : 'racing';
  }

  startRace(seed = Math.floor(Math.random() * 2 ** 32)) {
    if (this.race) return null;
    const startAt = this.now() + this.countdownMs;
    // Built here too so the server knows which pickup is which.
    const course = buildCourse(seed >>> 0, this.raceMs);
    this.race = { seed: seed >>> 0, startAt, endAt: startAt + this.raceMs, course };
    this.leaderboard = null;
    for (const p of this.players.values()) {
      p.crashes = 0;
      p.lastCrashAt = -Infinity;
      Object.assign(p, freshPickups());
    }
    this.dirty = true;
    return this.raceInfo();
  }

  // What a phone or screen needs to run the race locally. startsInMs is negative once it's underway.
  raceInfo() {
    if (!this.race) return null;
    return { seed: this.race.seed, startsInMs: this.race.startAt - this.now(), durationMs: this.raceMs };
  }

  // Phones report each box they hit. Ignored outside the race and while already spinning.
  crash(id) {
    const player = this.players.get(id);
    const now = this.now();
    if (!player || this.phase !== 'racing' || now > this.race.endAt) return false;
    if (now - player.lastCrashAt < SPIN_MS) return false;
    player.lastCrashAt = now;
    player.crashes++;
    this.dirty = true;
    return true;
  }

  // Phones report each pickup they drive over, by index into the course. Each player can
  // take each pickup once; coins score, the rest only change how the phone drives.
  pickup(id, index) {
    const player = this.players.get(id);
    const now = this.now();
    if (!player || this.phase !== 'racing' || now > this.race.endAt) return false;
    const item = Number.isInteger(index) ? this.race.course.pickups[index] : null;
    if (!item || player.taken.has(index)) return false;
    player.taken.add(index);
    if (item.kind === 'coin') player.coins++;
    player.pickups++;
    player.lastPickup = item.kind;
    this.dirty = true;
    return true;
  }

  endRace() {
    if (!this.race) return null;
    const { startAt, endAt } = this.race;
    this.leaderboard = [...this.players.values()]
      .map((p) => {
        const seconds = (endAt - Math.max(startAt, p.joinedAt)) / 1000;
        const score = scoreFor(seconds, p.crashes, p.coins);
        return { id: p.id, name: p.name, color: p.color, crashes: p.crashes, coins: p.coins, score };
      })
      .sort((a, b) => b.score - a.score || a.crashes - b.crashes || a.name.localeCompare(b.name));
    this.race = null;
    this.dirty = true;
    return { leaderboard: this.leaderboard };
  }

  snapshot() {
    return { players: [...this.players.values()].map(publicPlayer) };
  }

  // Returns a snapshot only if something changed since the last call.
  takeSnapshot() {
    if (!this.dirty) return null;
    this.dirty = false;
    return this.snapshot();
  }
}

function freshPickups() {
  return { taken: new Set(), coins: 0, pickups: 0, lastPickup: null };
}

// pickups counts up on every pickup, so watchers can tell a new one from the last one.
// coins lets the big screen's live scoreboard match the final score.
function publicPlayer({ id, name, color, x, row, crashes, coins, pickups, lastPickup }) {
  return { id, name, color, x, row, crashes, coins, pickups, lastPickup };
}

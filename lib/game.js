import { randomName, randomColor, cleanName, cleanColor } from './names.js';
import { RACE_MS, COUNTDOWN_MS, SPIN_MS, scoreFor } from '../public/js/course.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Authoritative list of who is connected and where their car is, plus the race clock.
// Phones simulate their own car and report crashes; the server keeps score.
export class Game {
  constructor({ now = Date.now, raceMs = RACE_MS, countdownMs = COUNTDOWN_MS } = {}) {
    this.players = new Map();
    this.dirty = false;
    this.nextRow = 0;
    this.now = now;
    this.raceMs = raceMs;
    this.countdownMs = countdownMs;
    this.race = null; // {seed, startAt, endAt}
    this.leaderboard = null; // set when a race ends, cleared when the next starts
  }

  join(id, { name, color } = {}) {
    const player = {
      id,
      name: cleanName(name) || randomName(),
      color: cleanColor(color) || randomColor(),
      x: 0,
      row: this.nextRow++,
      crashes: 0,
      joinedAt: this.now(),
      lastCrashAt: -Infinity,
    };
    this.players.set(id, player);
    this.dirty = true;
    return publicPlayer(player);
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
    this.race = { seed: seed >>> 0, startAt, endAt: startAt + this.raceMs };
    this.leaderboard = null;
    for (const p of this.players.values()) {
      p.crashes = 0;
      p.lastCrashAt = -Infinity;
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

  endRace() {
    if (!this.race) return null;
    const { startAt, endAt } = this.race;
    this.leaderboard = [...this.players.values()]
      .map((p) => {
        const seconds = (endAt - Math.max(startAt, p.joinedAt)) / 1000;
        return { id: p.id, name: p.name, color: p.color, crashes: p.crashes, score: scoreFor(seconds, p.crashes) };
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

function publicPlayer({ id, name, color, x, row, crashes }) {
  return { id, name, color, x, row, crashes };
}

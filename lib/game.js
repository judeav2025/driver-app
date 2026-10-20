import { randomName, randomColor, cleanName, cleanColor } from './names.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Authoritative list of who is connected and where their car is.
// Phones simulate their own car; the server only stores and relays positions.
export class Game {
  constructor() {
    this.players = new Map();
    this.dirty = false;
    this.nextRow = 0;
  }

  join(id, { name, color } = {}) {
    const player = {
      id,
      name: cleanName(name) || randomName(),
      color: cleanColor(color) || randomColor(),
      x: 0,
      row: this.nextRow++,
    };
    this.players.set(id, player);
    this.dirty = true;
    return player;
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

  snapshot() {
    return { players: [...this.players.values()] };
  }

  // Returns a snapshot only if something changed since the last call.
  takeSnapshot() {
    if (!this.dirty) return null;
    this.dirty = false;
    return this.snapshot();
  }
}

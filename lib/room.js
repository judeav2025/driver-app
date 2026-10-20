import { Game } from './game.js';

export const SNAPSHOT_MS = 66;
const MAX_MESSAGE = 1024;

// One game plus the connections watching it. Transport-agnostic: the Node server and the
// Cloudflare Durable Object each hand it a send(text) function per connection.
// Wire format is a JSON array: [event, data].
export class Room {
  constructor(options = {}) {
    this.game = new Game(options);
    this.clients = new Map(); // id -> send(text)
    this.snapshotTimer = null;
    this.endTimer = null;
  }

  connect(id, send) {
    this.clients.set(id, send);
    this.send(id, 'connected', { id });
    // Late-joining screens see everyone immediately instead of waiting for a change,
    // and pick up a race that's already running (or the last results).
    this.send(id, 'snapshot', this.game.snapshot());
    if (this.game.race) this.send(id, 'start', this.game.raceInfo());
    else if (this.game.leaderboard) this.send(id, 'end', { leaderboard: this.game.leaderboard });
    if (!this.snapshotTimer) this.snapshotTimer = setInterval(() => this.tick(), SNAPSHOT_MS);
  }

  receive(id, text) {
    if (!this.clients.has(id) || typeof text !== 'string' || text.length > MAX_MESSAGE) return;
    let event;
    let data;
    try {
      [event, data] = JSON.parse(text);
    } catch {
      return;
    }
    const game = this.game;
    if (event === 'join') {
      if (game.players.has(id)) return;
      this.send(id, 'welcome', game.join(id, data || {}));
    } else if (event === 'state') {
      game.setState(id, data);
    } else if (event === 'crash') {
      game.crash(id);
    } else if (event === 'start') {
      // Only the big screen starts races; phones are players.
      if (game.players.has(id)) return;
      const info = game.startRace();
      if (!info) return;
      this.broadcast('start', info);
      this.endTimer = setTimeout(() => this.endRace(), info.startsInMs + info.durationMs);
    }
  }

  disconnect(id) {
    if (!this.clients.delete(id)) return;
    this.game.leave(id);
    if (this.clients.size === 0) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  health() {
    return { ok: true, players: this.game.count, phase: this.game.phase };
  }

  tick() {
    const snap = this.game.takeSnapshot();
    if (snap) this.broadcast('snapshot', snap);
  }

  endRace() {
    this.endTimer = null;
    const result = this.game.endRace();
    if (result) this.broadcast('end', result);
  }

  send(id, event, data) {
    const send = this.clients.get(id);
    if (!send) return;
    try {
      send(JSON.stringify([event, data]));
    } catch {
      this.disconnect(id);
    }
  }

  broadcast(event, data) {
    for (const id of [...this.clients.keys()]) this.send(id, event, data);
  }

  close() {
    clearInterval(this.snapshotTimer);
    clearTimeout(this.endTimer);
    this.snapshotTimer = null;
    this.endTimer = null;
  }
}

import { lateralTilt, tiltToSteer, integrate, approach, clamp } from './steer.js';
import { fitCanvas, makeView, drawRoad, drawCourse, drawCar, xToPixel, spinProgress, spinAngle } from './road.js';
import { buildCourse, distanceAt, findCrash, scoreFor, SPEED_START, SPIN_MS } from './course.js';
import { io } from './net.js';

const SEND_MS = 66; // ~15 Hz
const TILT_TIMEOUT_MS = 1000;
const GHOST_ALPHA = 0.35;
const LATE_JOIN_GRACE_MS = 1500; // dropped into a race already underway: don't crash on arrival
const GO_MS = 800;

const $ = (id) => document.getElementById(id);
const canvas = $('road');

const state = {
  me: null, // {id, name, color}
  x: 0,
  others: new Map(), // id -> {name, color, x, shownX, crashes, crashedAt}
  mode: 'starting', // 'tilt' | 'buttons'
  tilt: null, // latest lateral tilt in degrees
  neutral: 0,
  calibrateNext: true,
  buttonSteer: 0,
  keys: { left: false, right: false },
  connected: false,
  playerCount: 0,
  dist: 0, // how far down the course we are, world units
  race: null, // {seed, course, startAt, endAt} in performance.now() time
  joinedAt: 0,
  hit: new Set(), // indices of boxes already crashed into this race
  crashes: 0,
  crashedAt: null,
  graceUntil: 0,
  results: null,
};

const socket = io({ autoConnect: false });

// --- Networking ---------------------------------------------------------

socket.on('connect', () => {
  state.connected = true;
  // On reconnect, ask for the same name/colour so the player keeps their identity.
  socket.emit('join', state.me ? { name: state.me.name, color: state.me.color } : {});
  renderDebug();
});

socket.on('disconnect', () => {
  state.connected = false;
  renderDebug();
});

socket.on('welcome', (player) => {
  state.me = { id: player.id, name: player.name, color: player.color };
  // The server scores each connection from when it joined, so the local HUD does too.
  state.joinedAt = performance.now();
  state.crashes = 0;
  $('myname').textContent = player.name;
  $('swatch').style.background = player.color;
});

socket.on('snapshot', ({ players }) => {
  state.playerCount = players.length;
  const seen = new Set();
  for (const p of players) {
    if (p.id === socket.id) continue;
    seen.add(p.id);
    const prev = state.others.get(p.id);
    const crashedAt = prev && p.crashes > prev.crashes ? performance.now() : prev?.crashedAt ?? null;
    state.others.set(p.id, { ...p, shownX: prev ? prev.shownX : p.x, crashedAt });
  }
  for (const id of state.others.keys()) if (!seen.has(id)) state.others.delete(id);
  renderDebug();
});

socket.on('start', ({ seed, startsInMs, durationMs }) => {
  const now = performance.now();
  const startAt = now + startsInMs;
  // A reconnect mid-race re-sends the same race: just resync the clock.
  if (state.race && state.race.seed === seed) {
    state.race.startAt = startAt;
    state.race.endAt = startAt + durationMs;
    return;
  }
  state.race = { seed, course: buildCourse(seed, durationMs), startAt, endAt: startAt + durationMs };
  state.results = null;
  state.hit = new Set();
  state.crashes = 0;
  state.crashedAt = null;
  state.graceUntil = startsInMs < 0 ? now + LATE_JOIN_GRACE_MS : 0;
  state.x = 0;
});

socket.on('end', ({ leaderboard }) => {
  state.race = null;
  state.results = leaderboard;
});

let lastSentX = null;
setInterval(() => {
  if (!state.connected || !state.me) return;
  if (state.x === lastSentX) return;
  lastSentX = state.x;
  socket.volatile.emit('state', { x: state.x });
}, SEND_MS);

// --- Controls -----------------------------------------------------------

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

function onOrientation(e) {
  if (e.gamma == null && e.beta == null) return;
  const tilt = lateralTilt(e, screenAngle());
  if (state.calibrateNext) {
    state.neutral = tilt;
    state.calibrateNext = false;
  }
  state.tilt = tilt;
  if (state.mode === 'starting') setMode('tilt');
}

async function requestTilt() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      return (await DeviceOrientationEvent.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true; // Android / desktop: no prompt needed
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock whenever the tab is hidden.
  if (document.visibilityState === 'visible' && state.me && (!wakeLock || wakeLock.released)) requestWakeLock();
});

function setMode(mode) {
  state.mode = mode;
  $('buttons').hidden = mode !== 'buttons';
  $('recal').hidden = mode !== 'tilt';
  renderDebug();
}

function holdButton(el, dir) {
  const press = (e) => {
    e.preventDefault();
    state.buttonSteer = dir;
    el.classList.add('down');
  };
  const release = (e) => {
    e.preventDefault();
    if (state.buttonSteer === dir) state.buttonSteer = 0;
    el.classList.remove('down');
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('left'), -1);
holdButton($('right'), 1);

const KEYMAP = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.key]) state.keys[KEYMAP[e.key]] = true;
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.key]) state.keys[KEYMAP[e.key]] = false;
});

function currentSteer() {
  if (spinProgress(state.crashedAt, performance.now(), SPIN_MS) != null) return 0;
  const keySteer = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
  if (keySteer) return keySteer;
  if (state.mode === 'buttons') return state.buttonSteer;
  if (state.mode === 'tilt' && state.tilt != null) return tiltToSteer(state.tilt, state.neutral);
  return 0;
}

$('recal').addEventListener('click', () => {
  state.calibrateNext = true;
});

$('start').addEventListener('click', async () => {
  // Permission prompts must be triggered straight from this tap.
  const [tiltOk] = await Promise.all([requestTilt(), requestWakeLock()]);
  $('join').hidden = true;
  $('game').hidden = false;
  state.calibrateNext = true;
  if (tiltOk) {
    window.addEventListener('deviceorientation', onOrientation);
    setTimeout(() => {
      if (state.mode === 'starting') setMode('buttons');
    }, TILT_TIMEOUT_MS);
  } else {
    setMode('buttons');
  }
  socket.connect();
  requestAnimationFrame(frame);
});

// --- Race ---------------------------------------------------------------

function phase(now) {
  if (state.race) {
    if (now < state.race.startAt) return 'countdown';
    return now < state.race.endAt ? 'racing' : 'finished';
  }
  return state.results ? 'results' : 'lobby';
}

function checkCrash(now) {
  if (now < state.graceUntil || spinProgress(state.crashedAt, now, SPIN_MS) != null) return;
  const i = findCrash(state.race.course, state.x, state.dist, state.hit);
  if (i < 0) return;
  state.hit.add(i);
  state.crashes++;
  state.crashedAt = now;
  socket.emit('crash');
  if (navigator.vibrate) navigator.vibrate(200);
}

function liveScore(now) {
  const from = Math.max(state.race.startAt, state.joinedAt);
  const to = Math.min(now, state.race.endAt);
  return scoreFor((to - from) / 1000, state.crashes);
}

// --- Rendering ----------------------------------------------------------

function renderHud(now, ph) {
  const hud = $('hud');
  hud.hidden = ph !== 'racing' && ph !== 'finished';
  if (!hud.hidden) {
    const left = Math.max(0, Math.ceil((state.race.endAt - now) / 1000));
    hud.textContent = `⏱ ${left}s · ${liveScore(now)} pts · 💥 ${state.crashes}`;
  }

  let text = '';
  if (ph === 'lobby') text = 'Waiting for the host to start the race.\nSteer to warm up!';
  else if (ph === 'countdown') text = String(Math.ceil((state.race.startAt - now) / 1000));
  else if (ph === 'racing' && now - state.race.startAt < GO_MS) text = 'GO!';
  else if (ph === 'finished') text = '🏁 Finish!\nWaiting for results…';
  else if (ph === 'results') text = resultsText();
  const banner = $('banner');
  if (banner.textContent !== text) banner.textContent = text;
  banner.className = ph === 'countdown' || text === 'GO!' ? 'count' : '';
}

function resultsText() {
  const board = state.results;
  const rank = board.findIndex((r) => r.id === socket.id);
  const lines = [];
  if (rank >= 0) {
    const me = board[rank];
    lines.push(`🏁 You finished #${rank + 1} of ${board.length}`);
    lines.push(`${me.score} pts · ${me.crashes} crash${me.crashes === 1 ? '' : 'es'}`);
    lines.push('');
  } else {
    lines.push('🏁 Race over', '');
  }
  board.slice(0, 3).forEach((r, i) => lines.push(`${['🥇', '🥈', '🥉'][i]} ${r.name} · ${r.score}`));
  lines.push('', 'Next race starts when the host is ready.');
  return lines.join('\n');
}

function renderDebug() {
  const conn = state.connected ? '🟢 connected' : '🔴 disconnected';
  const mode = state.mode === 'starting' ? 'detecting tilt…' : state.mode;
  $('debug').textContent = `${conn} · ${mode} · ${state.playerCount} player${state.playerCount === 1 ? '' : 's'}`;
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;

  const ph = phase(now);
  state.x = integrate(state.x, currentSteer(), dt);
  // Before and after a race the road just rolls along; during one, distance comes from the shared clock.
  if (state.race) state.dist = distanceAt((now - state.race.startAt) / 1000, state.race.endAt - state.race.startAt);
  else state.dist += dt * SPEED_START;
  if (ph === 'racing' && state.me) checkCrash(now);

  const { ctx, w, h } = fitCanvas(canvas);
  const view = makeView(w, h);
  drawRoad(ctx, view, state.dist);
  drawCourse(ctx, view, state.race?.course, state.dist);

  // Ghosts first so the player's own car is drawn on top.
  for (const p of state.others.values()) {
    p.shownX = approach(p.shownX, p.x, dt);
    const spin = spinProgress(p.crashedAt, now, SPIN_MS);
    drawCar(ctx, xToPixel(view, p.shownX), view.carY, view.carSize, {
      color: p.color,
      alpha: GHOST_ALPHA,
      angle: spin == null ? 0 : spinAngle(spin),
    });
  }
  if (state.me) {
    const spin = spinProgress(state.crashedAt, now, SPIN_MS);
    drawCar(ctx, xToPixel(view, state.x), view.carY, view.carSize, {
      color: state.me.color,
      label: 'YOU',
      angle: spin == null ? 0 : spinAngle(spin),
      crashed: spin != null,
    });
  }
  renderHud(now, ph);

  requestAnimationFrame(frame);
}

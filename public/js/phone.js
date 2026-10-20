import { lateralTilt, tiltToSteer, integrate, approach, clamp } from './steer.js';
import { fitCanvas, drawRoad, drawCar, xToPixel } from './road.js';

const SEND_MS = 66; // ~15 Hz
const TILT_TIMEOUT_MS = 1000;
const CAR = 56;
const GHOST_ALPHA = 0.35;

const $ = (id) => document.getElementById(id);
const canvas = $('road');

const state = {
  me: null, // {id, name, color}
  x: 0,
  others: new Map(), // id -> {name, color, x, shownX}
  mode: 'starting', // 'tilt' | 'buttons'
  tilt: null, // latest lateral tilt in degrees
  neutral: 0,
  calibrateNext: true,
  buttonSteer: 0,
  keys: { left: false, right: false },
  connected: false,
  playerCount: 0,
  scroll: 0,
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
    state.others.set(p.id, { ...p, shownX: prev ? prev.shownX : p.x });
  }
  for (const id of state.others.keys()) if (!seen.has(id)) state.others.delete(id);
  renderDebug();
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

// --- Rendering ----------------------------------------------------------

function renderDebug() {
  const conn = state.connected ? '🟢 connected' : '🔴 disconnected';
  const mode = state.mode === 'starting' ? 'detecting tilt…' : state.mode;
  $('debug').textContent = `${conn} · ${mode} · ${state.playerCount} player${state.playerCount === 1 ? '' : 's'}`;
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;

  state.x = integrate(state.x, currentSteer(), dt);
  state.scroll += dt * 240;

  const { ctx, w, h } = fitCanvas(canvas);
  drawRoad(ctx, w, h, state.scroll);

  // Ghosts first so the player's own car is drawn on top.
  for (const p of state.others.values()) {
    p.shownX = approach(p.shownX, p.x, dt);
    drawCar(ctx, xToPixel(p.shownX, w, CAR), h * 0.72, CAR, { color: p.color, alpha: GHOST_ALPHA });
  }
  if (state.me) {
    drawCar(ctx, xToPixel(state.x, w, CAR), h * 0.72, CAR, { color: state.me.color, label: 'YOU' });
  }

  requestAnimationFrame(frame);
}

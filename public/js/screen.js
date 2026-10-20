import { approach, clamp } from './steer.js';
import { fitCanvas, makeView, drawRoad, drawCourse, drawCar, xToPixel, spinProgress, spinAngle } from './road.js';
import { buildCourse, distanceAt, SPEED_START, SPIN_MS } from './course.js';

const $ = (id) => document.getElementById(id);
const canvas = $('road');
const GO_MS = 800;

const joinUrl = `${location.origin}/`;
$('qr').src = `/qr.svg?u=${encodeURIComponent(joinUrl)}`;
$('url').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

const cars = new Map(); // id -> {name, color, x, shownX, row, crashes, crashedAt}
let race = null; // {seed, course, startAt, endAt} in performance.now() time
let results = null;
let dist = 0;

const socket = io();
socket.on('connect', () => ($('status').textContent = ''));
socket.on('disconnect', () => ($('status').textContent = 'reconnecting…'));

socket.on('snapshot', ({ players }) => {
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    const prev = cars.get(p.id);
    const crashedAt = prev && p.crashes > prev.crashes ? performance.now() : prev?.crashedAt ?? null;
    cars.set(p.id, { ...p, shownX: prev ? prev.shownX : p.x, crashedAt });
  }
  for (const id of cars.keys()) if (!seen.has(id)) cars.delete(id);
  $('count').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
});

socket.on('start', ({ seed, startsInMs, durationMs }) => {
  const startAt = performance.now() + startsInMs;
  const course = race?.seed === seed ? race.course : buildCourse(seed, durationMs);
  race = { seed, course, startAt, endAt: startAt + durationMs };
  results = null;
});

socket.on('end', ({ leaderboard }) => {
  race = null;
  results = leaderboard;
  renderResults();
});

$('startRace').addEventListener('click', () => socket.emit('start'));

function phase(now) {
  if (race) {
    if (now < race.startAt) return 'countdown';
    return now < race.endAt ? 'racing' : 'finished';
  }
  return results ? 'results' : 'lobby';
}

function renderResults() {
  const overlay = $('overlay');
  overlay.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = '🏁 Results';
  const list = document.createElement('ol');
  list.className = 'board';
  for (const r of results.slice(0, 10)) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = r.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = r.name;
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = `${r.score} pts · 💥 ${r.crashes}`;
    li.append(dot, name, score);
    list.append(li);
  }
  if (!results.length) {
    const li = document.createElement('li');
    li.textContent = 'Nobody finished. Scan the QR to play!';
    list.append(li);
  }
  overlay.append(h, list);
}

// Sidebar controls and the big centred countdown / results.
function renderUi(now, ph) {
  const btn = $('startRace');
  btn.hidden = ph !== 'lobby' && ph !== 'results';
  btn.disabled = cars.size === 0;
  btn.textContent = ph === 'results' ? 'Race again' : 'Start race';

  const timer = $('timer');
  timer.hidden = ph !== 'racing';
  if (!timer.hidden) timer.textContent = `⏱ ${Math.max(0, Math.ceil((race.endAt - now) / 1000))}s`;

  const overlay = $('overlay');
  let big = null;
  if (ph === 'countdown') big = String(Math.ceil((race.startAt - now) / 1000));
  else if (ph === 'racing' && now - race.startAt < GO_MS) big = 'GO!';
  else if (ph === 'finished') big = '🏁 Finish!';
  if (big != null) {
    if (overlay.textContent !== big) overlay.textContent = big;
    overlay.className = 'count';
  } else if (ph === 'results') {
    overlay.className = 'results';
  }
  overlay.hidden = big == null && ph !== 'results';
}

// Lobby and results: one row per player, in join order, so people can find their car.
function rows(h, n) {
  const size = clamp(Math.floor((h * 0.9) / Math.max(n, 1) / 1.6), 22, 72);
  const gap = size * 1.6;
  const top = (h - gap * (n - 1)) / 2;
  return { size, rowY: (i) => top + i * gap };
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  const ph = phase(now);
  if (race) dist = distanceAt((now - race.startAt) / 1000, race.endAt - race.startAt);
  else dist += dt * SPEED_START;

  const { ctx, w, h } = fitCanvas(canvas);
  const view = makeView(w, h);
  drawRoad(ctx, view, dist);
  drawCourse(ctx, view, race?.course, dist);

  // During a race everyone is on the same stretch of road, so every car sits on the same line.
  const sorted = [...cars.values()].sort((a, b) => a.row - b.row);
  const inRace = Boolean(race);
  const { size, rowY } = inRace ? { size: view.carSize, rowY: () => view.carY } : rows(h, sorted.length);
  sorted.forEach((car, i) => {
    car.shownX = approach(car.shownX, car.x, dt);
    const spin = spinProgress(car.crashedAt, now, SPIN_MS);
    drawCar(ctx, xToPixel(view, car.shownX), rowY(i), size, {
      color: car.color,
      label: car.name,
      alpha: inRace ? 0.85 : 1,
      angle: spin == null ? 0 : spinAngle(spin),
      crashed: spin != null,
    });
  });

  if (!sorted.length && ph === 'lobby') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for drivers…', w / 2, h / 2);
  }

  renderUi(now, ph);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

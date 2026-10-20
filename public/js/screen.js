import { approach, clamp } from './steer.js';
import { fitCanvas, makeView, drawRoad, drawCourse, drawCar, xToPixel, yToPixel, spinProgress, spinAngle } from './road.js';
import { buildCourse, distanceAt, findPedestrian, pedestrianAt, scoreFor, SPEED_START, SPIN_MS, PICKUPS } from './course.js';
import { io } from './net.js';
import { renderStandings, byScore, minimizable } from './board.js';

const $ = (id) => document.getElementById(id);
const canvas = $('road');
const GO_MS = 800;

const joinUrl = `${location.origin}/`;
$('qr').src = `/qr.svg?u=${encodeURIComponent(joinUrl)}`;
$('url').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

const cars = new Map(); // id -> {name, color, x, shownX, lead, shownLead, row, crashes, coins, crashedAt, seenAt, pickups, lastPickup, pickedAt}
let race = null; // {seed, course, startAt, endAt, boinked} in performance.now() time
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
    const seenAt = prev?.seenAt ?? performance.now();
    const pickedAt = prev && p.pickups > prev.pickups ? performance.now() : prev?.pickedAt ?? null;
    cars.set(p.id, { ...p, shownX: prev ? prev.shownX : p.x, shownLead: prev ? prev.shownLead : p.lead, crashedAt, seenAt, pickedAt });
  }
  for (const id of cars.keys()) if (!seen.has(id)) cars.delete(id);
  $('count').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
  renderRoster();
});

socket.on('start', ({ seed, startsInMs, durationMs }) => {
  const startAt = performance.now() + startsInMs;
  const same = race?.seed === seed;
  const course = same ? race.course : buildCourse(seed, durationMs);
  race = { seed, course, startAt, endAt: startAt + durationMs, boinked: same ? race.boinked : new Map() };
  results = null;
});

socket.on('end', ({ leaderboard }) => {
  race = null;
  results = leaderboard;
  renderResults();
});

socket.on('reset', () => {
  race = null;
  results = null;
});

$('startRace').addEventListener('click', () => socket.emit('start'));

// Host controls. The ones that throw away a race in progress ask first.
$('endRace').addEventListener('click', () => {
  if (confirm('End the race now and show the results?')) socket.emit('endRace');
});
$('resetRace').addEventListener('click', () => {
  if (!race || confirm('Abandon this race? Nobody gets a score.')) socket.emit('reset');
});
$('kickAll').addEventListener('click', () => {
  if (confirm(`Remove all ${cars.size} players? They can scan the QR to join again.`)) socket.emit('kickAll');
});
$('roster').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) socket.emit('kick', { id: btn.dataset.id });
});

// Everyone connected, in join order, each with a button to remove them.
// Only rebuilt when someone joins, leaves or is renamed, not on every steering update.
let rosterKey = '';
function renderRoster() {
  const sorted = [...cars.values()].sort((a, b) => a.row - b.row);
  const key = sorted.map((c) => `${c.id}:${c.name}:${c.color}`).join('|');
  if (key === rosterKey) return;
  rosterKey = key;
  const items = sorted.map((car) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = car.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = car.name;
    const kick = document.createElement('button');
    kick.className = 'small';
    kick.dataset.id = car.id;
    kick.textContent = 'Kick';
    kick.setAttribute('aria-label', `Kick ${car.name}`);
    li.append(dot, name, kick);
    return li;
  });
  $('roster').replaceChildren(...items);
  $('kickAll').disabled = !sorted.length;
}

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
    score.textContent = `${r.score} pts · 💥 ${r.crashes}${r.coins ? ` · 🪙 ${r.coins}` : ''}`;
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

// Top-right standings during a race.
const liveRows = new Map();
minimizable($('live'), $('liveToggle'), 'driver:screenLiveMin');
function renderLive(now, ph) {
  const live = $('live');
  live.hidden = !race || cars.size === 0;
  if (live.hidden) return;
  const elapsed = (car) => (Math.min(now, race.endAt) - Math.max(race.startAt, car.seenAt)) / 1000;
  const standings = [...cars.values()]
    .map((car) => ({ ...car, score: ph === 'countdown' ? 0 : scoreFor(elapsed(car), car.crashes, car.coins) }))
    .sort(byScore);
  renderStandings($('liveBoard'), liveRows, standings);
}

// Sidebar controls and the big centred countdown / results.
function renderUi(now, ph) {
  const btn = $('startRace');
  btn.hidden = ph !== 'lobby' && ph !== 'results';
  btn.disabled = cars.size === 0;
  btn.textContent = ph === 'results' ? 'Race again' : 'Start race';
  $('endRace').hidden = ph !== 'countdown' && ph !== 'racing';
  $('resetRace').hidden = ph === 'lobby';
  $('resetRace').textContent = ph === 'results' ? 'Back to lobby' : 'Abandon race';

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

// The pickup a car grabbed last, while its effect lasts.
function carEffect(car, now) {
  const kind = car.lastPickup;
  return kind && PICKUPS[kind] && car.pickedAt != null && now - car.pickedAt < PICKUPS[kind].ms ? kind : null;
}

// Phones decide who crashed; the big screen just makes any pedestrian a car drives into hop clear.
function boinkPedestrians(sec) {
  for (const car of cars.values()) {
    const j = findPedestrian(race.course, car.shownX, dist + car.shownLead, sec, race.boinked);
    if (j >= 0) race.boinked.set(j, { sec, x: pedestrianAt(race.course.pedestrians[j], sec).x });
  }
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  const ph = phase(now);
  const sec = race ? (now - race.startAt) / 1000 : 0;
  if (race) dist = distanceAt(sec, race.endAt - race.startAt);
  else dist += dt * SPEED_START;
  if (ph === 'racing') boinkPedestrians(sec);

  for (const car of cars.values()) car.shownLead = approach(car.shownLead ?? 0, race ? car.lead ?? 0 : 0, dt, 4);

  const { ctx, w, h } = fitCanvas(canvas);
  const view = makeView(w, h);
  drawRoad(ctx, view, dist);
  drawCourse(ctx, view, race?.course, dist, { sec, boinked: race?.boinked });

  // During a race the camera follows the pack; drivers ahead on points sit further up the road.
  const sorted = [...cars.values()].sort((a, b) => a.row - b.row);
  const inRace = Boolean(race);
  const raceY = (i) => yToPixel(view, dist + sorted[i].shownLead, dist);
  const { size, rowY } = inRace ? { size: view.carSize, rowY: raceY } : rows(h, sorted.length);
  sorted.forEach((car, i) => {
    car.shownX = approach(car.shownX, car.x, dt);
    const spin = spinProgress(car.crashedAt, now, SPIN_MS);
    const kind = inRace ? carEffect(car, now) : null;
    drawCar(ctx, xToPixel(view, car.shownX), rowY(i), size, {
      color: car.color,
      label: car.name,
      alpha: inRace ? 0.85 : 1,
      angle: spin == null ? 0 : spinAngle(spin),
      crashed: spin != null,
      badge: kind ? PICKUPS[kind].emoji : null,
      glow: kind === 'star' ? now * 0.5 : null,
    });
  });

  if (!sorted.length && ph === 'lobby') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for drivers…', w / 2, h / 2);
  }

  renderUi(now, ph);
  renderLive(now, ph);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import { approach, clamp } from './steer.js';
import { fitCanvas, drawRoad, drawCar, xToPixel } from './road.js';

const $ = (id) => document.getElementById(id);
const canvas = $('road');

const joinUrl = `${location.origin}/`;
$('qr').src = `/qr.svg?u=${encodeURIComponent(joinUrl)}`;
$('url').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

const cars = new Map(); // id -> {name, color, x, shownX, row}
let scroll = 0;

const socket = io();
socket.on('connect', () => ($('status').textContent = ''));
socket.on('disconnect', () => ($('status').textContent = 'reconnecting…'));

socket.on('snapshot', ({ players }) => {
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    const prev = cars.get(p.id);
    cars.set(p.id, { ...p, shownX: prev ? prev.shownX : p.x });
  }
  for (const id of cars.keys()) if (!seen.has(id)) cars.delete(id);
  $('count').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
});

// PoC: one row per player, in join order, so people can find their car.
function layout(h, n) {
  const size = clamp(Math.floor((h * 0.9) / Math.max(n, 1) / 1.6), 22, 72);
  const gap = size * 1.6;
  const top = (h - gap * (n - 1)) / 2;
  return { size, rowY: (i) => top + i * gap };
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  scroll += dt * 240;

  const { ctx, w, h } = fitCanvas(canvas);
  drawRoad(ctx, w, h, scroll);

  const sorted = [...cars.values()].sort((a, b) => a.row - b.row);
  const { size, rowY } = layout(h, sorted.length);
  sorted.forEach((car, i) => {
    car.shownX = approach(car.shownX, car.x, dt);
    drawCar(ctx, xToPixel(car.shownX, w, size), rowY(i), size, { color: car.color, label: car.name });
  });

  if (!sorted.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for drivers…', w / 2, h / 2);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

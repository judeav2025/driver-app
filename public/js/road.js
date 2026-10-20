// Shared canvas drawing for the phone and the big screen.
// World coordinates (see course.js) map to pixels through a view, so both show the same course.

import { BOX_DRAW } from './course.js';

export const ROAD_FRACTION = 0.8; // most of the canvas width the road may take
export const EDGE = 1.15; // road half-width in world units; car centres stay inside ±1
export const MIN_VISIBLE = 6.5; // world units of road the canvas height must show
export const CAR_DRAW = 0.3; // car emoji size in world units

// Pixels per world unit, road centre, and the line the cars sit on.
export function makeView(w, h, carFrac = 0.8) {
  const unit = Math.min((w * ROAD_FRACTION) / 2 / EDGE, h / MIN_VISIBLE);
  return { w, h, unit, center: w / 2, half: unit * EDGE, carY: h * carFrac, carSize: unit * CAR_DRAW };
}

export const xToPixel = (view, x) => view.center + x * view.unit;

// World y → canvas y, with `dist` (how far we've driven) sitting on the car line.
export const yToPixel = (view, y, dist) => view.carY - (y - dist) * view.unit;

export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function drawRoad(ctx, view, dist) {
  const { w, h, center, half, unit } = view;
  const left = center - half;
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#37474f';
  ctx.fillRect(left, 0, half * 2, h);
  ctx.fillStyle = '#eceff1';
  ctx.fillRect(left, 0, 4, h);
  ctx.fillRect(left + half * 2 - 4, 0, 4, h);
  // Dashed centre line that scrolls so the road feels like it's moving.
  ctx.fillStyle = '#ffd54f';
  const dash = unit * 0.4;
  const offset = (dist * unit) % (dash * 2);
  for (let y = -dash * 2 + offset; y < h; y += dash * 2) {
    ctx.fillRect(center - 3, y, 6, dash);
  }
}

// Boxes and the finish line that are on screen at this distance.
export function drawCourse(ctx, view, course, dist) {
  if (!course) return;
  const ahead = view.carY / view.unit + 1;
  const behind = (view.h - view.carY) / view.unit + 1;

  const fy = yToPixel(view, course.finish, dist);
  if (course.finish < dist + ahead && course.finish > dist - behind) drawFinish(ctx, view, fy);

  const size = BOX_DRAW * view.unit;
  for (const box of course.boxes) {
    if (box.y < dist - behind) continue;
    if (box.y > dist + ahead) break;
    drawBox(ctx, xToPixel(view, box.x), yToPixel(view, box.y, dist), size);
  }
}

function drawFinish(ctx, view, y) {
  const { center, half } = view;
  const cells = 12;
  const cell = (half * 2) / cells;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      ctx.fillRect(center - half + c * cell, y - cell + r * cell, cell, cell);
    }
  }
}

function drawBox(ctx, px, py, size) {
  const s = size / 2;
  ctx.save();
  ctx.fillStyle = '#b07a3b';
  ctx.strokeStyle = '#5d3a17';
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.fillRect(px - s, py - s, size, size);
  ctx.strokeRect(px - s, py - s, size, size);
  ctx.beginPath();
  ctx.moveTo(px - s, py - s);
  ctx.lineTo(px + s, py + s);
  ctx.moveTo(px + s, py - s);
  ctx.lineTo(px - s, py + s);
  ctx.stroke();
  ctx.restore();
}

// Mixes a #rrggbb colour toward white (amount > 0) or black (amount < 0).
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * t);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Top-down car facing up the road, shaded to look 3D. angle rotates it for spin-outs.
export function drawCar(ctx, px, py, size, { color, label, alpha = 1, angle = 0, crashed = false }) {
  const w = size * 0.62;
  const l = size;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px, py);
  ctx.rotate(angle);

  // Shadow on the road.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, -w / 2 + size * 0.06, -l / 2 + size * 0.08, w, l, w * 0.3);
  ctx.fill();

  // Wheels poking out from under the body.
  ctx.fillStyle = '#111';
  const ww = w * 0.2;
  const wl = l * 0.22;
  for (const y of [-l * 0.3, l * 0.3 - wl]) {
    roundRect(ctx, -w / 2 - ww * 0.35, y, ww, wl, ww * 0.3);
    ctx.fill();
    roundRect(ctx, w / 2 - ww * 0.65, y, ww, wl, ww * 0.3);
    ctx.fill();
  }

  // Body: dark at the sides, bright down the middle, so it reads as curved.
  const body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  body.addColorStop(0, shade(color, -0.45));
  body.addColorStop(0.3, color);
  body.addColorStop(0.5, shade(color, 0.35));
  body.addColorStop(0.7, color);
  body.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = body;
  roundRect(ctx, -w / 2, -l / 2, w, l, w * 0.32);
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.6);
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.stroke();

  // Windscreen and rear window.
  const glass = ctx.createLinearGradient(0, -l * 0.25, 0, l * 0.3);
  glass.addColorStop(0, '#9fd3ff');
  glass.addColorStop(1, '#1b2a3a');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(-w * 0.36, -l * 0.08);
  ctx.lineTo(w * 0.36, -l * 0.08);
  ctx.lineTo(w * 0.28, -l * 0.24);
  ctx.lineTo(-w * 0.28, -l * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1b2a3a';
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, l * 0.2);
  ctx.lineTo(w * 0.34, l * 0.2);
  ctx.lineTo(w * 0.28, l * 0.3);
  ctx.lineTo(-w * 0.28, l * 0.3);
  ctx.closePath();
  ctx.fill();

  // Roof, lit from above.
  const roof = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
  roof.addColorStop(0, shade(color, -0.2));
  roof.addColorStop(0.5, shade(color, 0.5));
  roof.addColorStop(1, shade(color, -0.2));
  ctx.fillStyle = roof;
  roundRect(ctx, -w * 0.33, -l * 0.08, w * 0.66, l * 0.28, w * 0.12);
  ctx.fill();

  // Headlights and tail lights.
  ctx.fillStyle = '#fff6c2';
  roundRect(ctx, -w * 0.4, -l * 0.49, w * 0.22, l * 0.05, l * 0.02);
  ctx.fill();
  roundRect(ctx, w * 0.18, -l * 0.49, w * 0.22, l * 0.05, l * 0.02);
  ctx.fill();
  ctx.fillStyle = '#ff2b2b';
  roundRect(ctx, -w * 0.4, l * 0.44, w * 0.2, l * 0.04, l * 0.02);
  ctx.fill();
  roundRect(ctx, w * 0.2, l * 0.44, w * 0.2, l * 0.04, l * 0.02);
  ctx.fill();

  ctx.restore();
  if (crashed) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${size * 0.8}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💥', px + size * 0.45, py - size * 0.55);
    ctx.restore();
  }
  if (label) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.max(12, size * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(label, px, py + size * 0.7);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px, py + size * 0.7);
    ctx.restore();
  }
}

// How far into a spin-out a car is, 0..1, or null if it isn't spinning.
export function spinProgress(crashedAt, now, spinMs) {
  if (crashedAt == null) return null;
  const t = (now - crashedAt) / spinMs;
  return t >= 0 && t < 1 ? t : null;
}

// Two full turns, easing out, so the car ends up facing forward again.
export const spinAngle = (t) => (1 - (1 - t) ** 2) * Math.PI * 4;

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

// angle rotates the car for spin-outs.
export function drawCar(ctx, px, py, size, { color, label, alpha = 1, angle = 0, crashed = false }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Coloured halo so identical emoji are tellable apart.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, size * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🚗', 0, 0);
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

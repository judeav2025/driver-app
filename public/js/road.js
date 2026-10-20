// Shared canvas drawing for the phone and the big screen.

export const ROAD_FRACTION = 0.8; // road width as a fraction of canvas width

export function roadGeometry(width) {
  const roadW = width * ROAD_FRACTION;
  const left = (width - roadW) / 2;
  // Half the car width of margin so a car at x=±1 sits on the edge, not off it.
  const half = roadW / 2;
  return { roadW, left, center: width / 2, half };
}

// x in -1..1 → canvas pixel, leaving room for the car emoji at the edges.
export function xToPixel(x, width, carSize) {
  const { center, half } = roadGeometry(width);
  return center + x * (half - carSize * 0.6);
}

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

export function drawRoad(ctx, w, h, scroll) {
  const { roadW, left, center } = roadGeometry(w);
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#37474f';
  ctx.fillRect(left, 0, roadW, h);
  ctx.fillStyle = '#eceff1';
  ctx.fillRect(left, 0, 4, h);
  ctx.fillRect(left + roadW - 4, 0, 4, h);
  // Dashed centre line that scrolls so the road feels like it's moving.
  ctx.fillStyle = '#ffd54f';
  const dash = 40;
  const offset = scroll % (dash * 2);
  for (let y = -dash * 2 + offset; y < h; y += dash * 2) {
    ctx.fillRect(center - 3, y, 6, dash);
  }
}

export function drawCar(ctx, px, py, size, { color, label, alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Coloured halo so identical emoji are tellable apart.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, size * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🚗', px, py);
  ctx.restore();
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

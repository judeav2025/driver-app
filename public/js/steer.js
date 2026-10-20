// Pure steering helpers shared by the phone page and the tests.

export const DEADZONE_DEG = 3;
export const MAX_TILT_DEG = 25;
export const SPEED = 1.4; // road half-widths per second at full lock

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Left/right tilt in degrees for the current screen orientation.
// Portrait: gamma. Landscape: beta, signed by which way the phone is turned.
export function lateralTilt({ beta, gamma }, angle = 0) {
  if (angle === 90) return beta ?? 0;
  if (angle === 270 || angle === -90) return -(beta ?? 0);
  if (angle === 180) return -(gamma ?? 0);
  return gamma ?? 0;
}

// Maps a tilt (degrees, relative to calibrated neutral) to steer in -1..1.
// Inside the deadzone the car goes straight; past it steer ramps linearly to full lock.
export function tiltToSteer(tilt, neutral = 0, deadzone = DEADZONE_DEG, maxTilt = MAX_TILT_DEG) {
  const d = tilt - neutral;
  if (Math.abs(d) <= deadzone) return 0;
  const mag = (Math.abs(d) - deadzone) / (maxTilt - deadzone);
  return Math.sign(d) * clamp(mag, 0, 1);
}

// Steering drives lateral velocity, not position.
export function integrate(x, steer, dt, speed = SPEED) {
  return clamp(x + steer * speed * dt, -1, 1);
}

// Exponential smoothing toward a target, frame-rate independent.
export function approach(current, target, dt, rate = 12) {
  return target + (current - target) * Math.exp(-rate * dt);
}

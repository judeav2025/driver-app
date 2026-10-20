import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltToSteer, integrate, lateralTilt, approach, DEADZONE_DEG, MAX_TILT_DEG } from '../public/js/steer.js';

test('tilt inside the deadzone goes straight', () => {
  assert.equal(tiltToSteer(DEADZONE_DEG - 0.1), 0);
  assert.equal(tiltToSteer(-DEADZONE_DEG + 0.1), 0);
});

test('tilt is measured relative to the calibrated neutral', () => {
  assert.equal(tiltToSteer(12, 12), 0);
  assert.ok(tiltToSteer(12 + 10, 12) > 0);
  assert.ok(tiltToSteer(12 - 10, 12) < 0);
});

test('steer ramps to full lock and clamps', () => {
  assert.equal(tiltToSteer(MAX_TILT_DEG), 1);
  assert.equal(tiltToSteer(80), 1);
  assert.equal(tiltToSteer(-80), -1);
  const half = tiltToSteer((DEADZONE_DEG + MAX_TILT_DEG) / 2);
  assert.ok(Math.abs(half - 0.5) < 1e-9);
});

test('steering drives velocity and x stays on the road', () => {
  assert.equal(integrate(0, 0, 1), 0);
  assert.ok(integrate(0, 1, 0.1) > 0);
  assert.ok(integrate(0, -1, 0.1) < 0);
  assert.equal(integrate(0.99, 1, 1), 1);
  assert.equal(integrate(-0.99, -1, 1), -1);
});

test('lateral tilt follows screen orientation', () => {
  const e = { beta: 10, gamma: 20 };
  assert.equal(lateralTilt(e, 0), 20);
  assert.equal(lateralTilt(e, 180), -20);
  assert.equal(lateralTilt(e, 90), 10);
  assert.equal(lateralTilt(e, 270), -10);
  assert.equal(lateralTilt({ beta: null, gamma: null }, 0), 0);
});

test('approach moves toward the target without overshooting', () => {
  const v = approach(0, 1, 1 / 60);
  assert.ok(v > 0 && v < 1);
  assert.ok(Math.abs(approach(0, 1, 10) - 1) < 1e-6);
});

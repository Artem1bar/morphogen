import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, invLerp, remap, wrap, smoothstep, smootherstep, angleDelta,
  radians, degrees, dist, dist2, TAU,
  vec, vadd, vsub, vscale, vdot, vlen, vnorm, vrot, vfromAngle, vlimit, fract,
} from '../src/engine/mathx.js';

test('clamp constrains to bounds', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('lerp / invLerp are inverses', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(invLerp(0, 10, 5), 0.5);
  assert.equal(invLerp(4, 4, 4), 0, 'degenerate range returns 0');
});

test('remap maps across ranges', () => {
  assert.equal(remap(5, 0, 10, 0, 100), 50);
  assert.equal(remap(0, -1, 1, 0, 256), 128);
});

test('wrap handles negatives correctly', () => {
  assert.equal(wrap(7, 5), 2);
  assert.equal(wrap(-1, 5), 4);
  assert.equal(wrap(-6, 5), 4);
  assert.equal(wrap(0, 5), 0);
});

test('smoothstep clamps and eases', () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.ok(smoothstep(0, 1, 0.25) < 0.25, 'eased below linear at 0.25');
});

test('smootherstep endpoints and midpoint', () => {
  assert.equal(smootherstep(0, 1, 0), 0);
  assert.equal(smootherstep(0, 1, 1), 1);
  assert.ok(Math.abs(smootherstep(0, 1, 0.5) - 0.5) < 1e-9);
});

test('angleDelta returns shortest signed distance', () => {
  assert.ok(Math.abs(angleDelta(0, 0.1) - 0.1) < 1e-9);
  // from ~350deg to ~10deg should be +20deg, not -340
  const d = angleDelta(radians(350), radians(10));
  assert.ok(Math.abs(d - radians(20)) < 1e-9, `got ${degrees(d)} deg`);
});

test('radians/degrees round-trip', () => {
  assert.ok(Math.abs(degrees(radians(123)) - 123) < 1e-9);
  assert.ok(Math.abs(radians(180) - Math.PI) < 1e-9);
});

test('dist and dist2 agree', () => {
  assert.equal(dist(0, 0, 3, 4), 5);
  assert.equal(dist2(0, 0, 3, 4), 25);
});

test('vector add/sub/scale/dot', () => {
  assert.deepEqual(vadd(vec(1, 2), vec(3, 4)), { x: 4, y: 6 });
  assert.deepEqual(vsub(vec(3, 4), vec(1, 2)), { x: 2, y: 2 });
  assert.deepEqual(vscale(vec(2, 3), 2), { x: 4, y: 6 });
  assert.equal(vdot(vec(1, 0), vec(0, 1)), 0);
});

test('vnorm yields unit length and is safe at zero', () => {
  const n = vnorm(vec(3, 4));
  assert.ok(Math.abs(vlen(n) - 1) < 1e-9);
  assert.deepEqual(vnorm(vec(0, 0)), { x: 0, y: 0 });
});

test('vrot by TAU is identity', () => {
  const v = vec(1, 0);
  const r = vrot(v, TAU);
  assert.ok(Math.abs(r.x - 1) < 1e-9 && Math.abs(r.y) < 1e-9);
});

test('vfromAngle has expected length and direction', () => {
  const v = vfromAngle(0, 5);
  assert.ok(Math.abs(v.x - 5) < 1e-9 && Math.abs(v.y) < 1e-9);
  assert.ok(Math.abs(vlen(vfromAngle(1.234, 3)) - 3) < 1e-9);
});

test('vlimit caps magnitude but leaves short vectors alone', () => {
  assert.ok(Math.abs(vlen(vlimit(vec(10, 0), 4)) - 4) < 1e-9);
  assert.deepEqual(vlimit(vec(1, 0), 4), { x: 1, y: 0 });
});

test('fract returns the fractional part', () => {
  assert.ok(Math.abs(fract(3.25) - 0.25) < 1e-9);
  assert.ok(Math.abs(fract(-0.25) - 0.75) < 1e-9);
});

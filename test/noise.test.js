import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Noise } from '../src/engine/noise.js';

test('noise2D is deterministic for a given seed', () => {
  const a = new Noise(42);
  const b = new Noise(42);
  for (let i = 0; i < 50; i++) {
    const x = i * 0.37;
    const y = i * 0.21;
    assert.equal(a.noise2D(x, y), b.noise2D(x, y));
  }
});

test('different seeds give different fields', () => {
  const a = new Noise(1);
  const b = new Noise(2);
  let diff = 0;
  for (let i = 0; i < 50; i++) if (a.noise2D(i * 0.3, 1.1) !== b.noise2D(i * 0.3, 1.1)) diff++;
  assert.ok(diff > 45);
});

test('noise2D stays within roughly [-1, 1]', () => {
  const n = new Noise(7);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const v = n.noise2D(i * 0.13, i * 0.07);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(min >= -1.01 && max <= 1.01, `range [${min}, ${max}]`);
  assert.ok(min < -0.2 && max > 0.2, 'field should actually vary');
});

test('noise3D is deterministic and bounded', () => {
  const a = new Noise(11);
  const b = new Noise(11);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const va = a.noise3D(i * 0.1, i * 0.05, i * 0.02);
    const vb = b.noise3D(i * 0.1, i * 0.05, i * 0.02);
    assert.equal(va, vb);
    min = Math.min(min, va);
    max = Math.max(max, va);
  }
  assert.ok(min >= -1.01 && max <= 1.01, `range [${min}, ${max}]`);
});

test('fbm2D is deterministic and within bounds', () => {
  const a = new Noise(3);
  const b = new Noise(3);
  for (let i = 0; i < 50; i++) {
    const va = a.fbm2D(i * 0.2, i * 0.15, { octaves: 5 });
    const vb = b.fbm2D(i * 0.2, i * 0.15, { octaves: 5 });
    assert.equal(va, vb);
    assert.ok(va >= -1.01 && va <= 1.01);
  }
});

test('fbm3D respects octave count without throwing', () => {
  const n = new Noise(9);
  for (let o = 1; o <= 6; o++) {
    const v = n.fbm3D(1.5, 2.5, 0.5, { octaves: o });
    assert.ok(Number.isFinite(v));
  }
});

test('continuity: nearby samples are close (no discontinuities)', () => {
  const n = new Noise(21);
  let maxJump = 0;
  let prev = n.noise2D(0, 0);
  for (let i = 1; i < 1000; i++) {
    const v = n.noise2D(i * 0.001, 0);
    maxJump = Math.max(maxJump, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(maxJump < 0.1, `unexpected discontinuity, max jump ${maxJump}`);
});

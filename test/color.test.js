import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hslToRgb, hexToRgb, rgbToHex, rgba, sample, sampleCss, ramp,
  PALETTES, PALETTE_NAMES,
} from '../src/engine/color.js';

test('hexToRgb parses 6-digit and 3-digit hex', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('#00ff00'), [0, 255, 0]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('000000'), [0, 0, 0]);
});

test('rgbToHex round-trips with hexToRgb', () => {
  for (const hex of ['#000000', '#ffffff', '#1276a0', '#e98f86']) {
    assert.equal(rgbToHex(...hexToRgb(hex)), hex);
  }
});

test('rgbToHex clamps out-of-range channels', () => {
  assert.equal(rgbToHex(-10, 300, 128), '#00ff80');
});

test('hslToRgb known anchors', () => {
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]); // red
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]); // green
  assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 255]); // blue
  assert.deepEqual(hslToRgb(0, 0, 0.5), [128, 128, 128]); // gray
});

test('hslToRgb wraps hue', () => {
  assert.deepEqual(hslToRgb(360, 1, 0.5), hslToRgb(0, 1, 0.5));
});

test('rgba builds a valid string and rounds', () => {
  assert.equal(rgba(10.4, 20.6, 30, 0.5), 'rgba(10,21,30,0.5)');
});

test('every named palette is a non-empty array of valid hex', () => {
  for (const name of PALETTE_NAMES) {
    const stops = PALETTES[name];
    assert.ok(Array.isArray(stops) && stops.length >= 2, `${name} too short`);
    for (const s of stops) assert.match(s, /^#[0-9a-f]{6}$/i, `${name} has bad stop ${s}`);
  }
});

test('sample returns the endpoints exactly at t=0 and t=1', () => {
  const pal = ['#000000', '#ffffff'];
  assert.deepEqual(sample(pal, 0), [0, 0, 0]);
  assert.deepEqual(sample(pal, 1), [255, 255, 255]);
});

test('sample interpolates the midpoint', () => {
  const mid = sample(['#000000', '#ffffff'], 0.5);
  assert.ok(Math.abs(mid[0] - 127.5) < 1e-9);
});

test('sample clamps out-of-range t', () => {
  const pal = ['#000000', '#ffffff'];
  assert.deepEqual(sample(pal, -1), [0, 0, 0]);
  assert.deepEqual(sample(pal, 2), [255, 255, 255]);
});

test('sample accepts a palette name', () => {
  const c = sample('ember', 0.5);
  assert.equal(c.length, 3);
  assert.ok(c.every((v) => v >= 0 && v <= 255));
});

test('sampleCss emits rgb() and rgba() forms', () => {
  assert.match(sampleCss('ice', 0.5), /^rgb\(\d+,\d+,\d+\)$/);
  assert.match(sampleCss('ice', 0.5, 0.5), /^rgba\(\d+,\d+,\d+,0\.5\)$/);
});

test('ramp has the right length and matches sample at the ends', () => {
  const steps = 256;
  const r = ramp('spectral', steps);
  assert.equal(r.length, steps * 3);
  const first = sample('spectral', 0);
  assert.equal(r[0], Math.round(first[0]));
});

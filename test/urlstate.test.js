import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeState, decodeState, coerceParams, shareableUrl,
} from '../src/engine/urlstate.js';

const SPEC = [
  { key: 'count', type: 'int', default: 100 },
  { key: 'speed', type: 'range', default: 1.5 },
  { key: 'wrap', type: 'toggle', default: true },
  { key: 'palette', type: 'select', default: 'abyss' },
];

test('encode → decode round-trips system and seed', () => {
  const enc = encodeState({ sys: 'flowfield', seed: 'coral-reef-42', params: {} });
  const dec = decodeState('#' + enc);
  assert.equal(dec.sys, 'flowfield');
  assert.equal(dec.seed, 'coral-reef-42');
});

test('numeric, boolean, and select params survive a round-trip', () => {
  const params = { count: 2400, speed: 1.25, wrap: false, palette: 'ember' };
  const enc = encodeState({ sys: 's', seed: 1, params });
  const dec = decodeState(enc);
  const coerced = coerceParams(SPEC, dec.rawParams);
  assert.equal(coerced.count, 2400);
  assert.ok(Math.abs(coerced.speed - 1.25) < 1e-9);
  assert.equal(coerced.wrap, false);
  assert.equal(coerced.palette, 'ember');
});

test('coerceParams fills defaults for missing keys', () => {
  const coerced = coerceParams(SPEC, { count: '7' });
  assert.equal(coerced.count, 7);
  assert.equal(coerced.speed, 1.5);
  assert.equal(coerced.wrap, true);
  assert.equal(coerced.palette, 'abyss');
});

test('coerceParams ignores unknown keys', () => {
  const coerced = coerceParams(SPEC, { count: '5', bogus: 'x' });
  assert.ok(!('bogus' in coerced));
});

test('toggle decodes both 1/0 and true/false', () => {
  assert.equal(coerceParams(SPEC, { wrap: '1' }).wrap, true);
  assert.equal(coerceParams(SPEC, { wrap: '0' }).wrap, false);
  assert.equal(coerceParams(SPEC, { wrap: 'true' }).wrap, true);
});

test('string param values with special characters round-trip', () => {
  const spec = [{ key: 'label', type: 'select', default: 'a' }];
  const enc = encodeState({ sys: 's', seed: 'x', params: { label: 'a;b~c&d=e' } });
  const dec = decodeState(enc);
  const coerced = coerceParams(spec, dec.rawParams);
  assert.equal(coerced.label, 'a;b~c&d=e');
});

test('seeds with spaces and symbols round-trip', () => {
  const enc = encodeState({ sys: 's', seed: 'hello world & friends', params: {} });
  const dec = decodeState(enc);
  assert.equal(dec.seed, 'hello world & friends');
});

test('decodeState tolerates empty and malformed input', () => {
  assert.deepEqual(decodeState(''), { rawParams: {} });
  assert.deepEqual(decodeState('#'), { rawParams: {} });
  const dec = decodeState('#sys=x&garbage&p=a~1;;b');
  assert.equal(dec.sys, 'x');
  assert.equal(dec.rawParams.a, '1');
});

test('shareableUrl builds origin + path + hash', () => {
  const loc = { origin: 'https://example.com', pathname: '/morphogen/' };
  const url = shareableUrl({ sys: 'flowfield', seed: 7, params: { count: 10 } }, loc);
  assert.ok(url.startsWith('https://example.com/morphogen/#'));
  assert.ok(url.includes('sys=flowfield'));
  assert.ok(url.includes('seed=7'));
  assert.ok(url.includes('count~10'));
});

test('numbers are trimmed to a sane precision', () => {
  const enc = encodeState({ sys: 's', seed: 1, params: { speed: 1.123456789 } });
  // 4-decimal rounding keeps URLs short
  assert.ok(enc.includes('speed~1.1235'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashString, mulberry32, normalizeSeed, wordSeed } from '../src/engine/prng.js';

test('mulberry32 is deterministic for a given seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('mulberry32 output is always in [0, 1)', () => {
  const r = mulberry32(987654321);
  for (let i = 0; i < 10000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value ${v} out of range`);
  }
});

test('different seeds produce different streams', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  let differences = 0;
  for (let i = 0; i < 50; i++) if (a() !== b()) differences++;
  assert.ok(differences > 45, 'streams should mostly differ');
});

test('hashString is stable and unsigned 32-bit', () => {
  assert.equal(hashString('coral'), hashString('coral'));
  assert.notEqual(hashString('coral'), hashString('reef'));
  const h = hashString('a-fairly-long-seed-string');
  assert.ok(h >= 0 && h <= 0xffffffff);
  assert.ok(Number.isInteger(h));
});

test('normalizeSeed handles numbers, numeric strings, words, and empty', () => {
  assert.equal(normalizeSeed(42), 42);
  assert.equal(normalizeSeed('42'), 42);
  assert.equal(normalizeSeed('coral'), hashString('coral'));
  assert.equal(normalizeSeed(''), 0);
  assert.equal(normalizeSeed(undefined), 0);
  assert.equal(normalizeSeed(-1) >= 0, true); // unsigned
});

test('Rng is reproducible from a seed and reset() rewinds', () => {
  const r = new Rng('coral-reef-42');
  const first = Array.from({ length: 20 }, () => r.next());
  r.reset();
  const second = Array.from({ length: 20 }, () => r.next());
  assert.deepEqual(first, second);
});

test('Rng.range stays within bounds', () => {
  const r = new Rng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.range(-5, 12);
    assert.ok(v >= -5 && v < 12);
  }
});

test('Rng.int is inclusive on both ends and integral', () => {
  const r = new Rng(7);
  let sawMin = false;
  let sawMax = false;
  for (let i = 0; i < 5000; i++) {
    const v = r.int(1, 6);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 1 && v <= 6);
    if (v === 1) sawMin = true;
    if (v === 6) sawMax = true;
  }
  assert.ok(sawMin && sawMax, 'should reach both endpoints');
});

test('Rng.shuffle returns a permutation without mutating input', () => {
  const r = new Rng(99);
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = r.shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], 'input not mutated');
  assert.deepEqual([...out].sort((a, b) => a - b), input, 'same multiset');
});

test('Rng.pick returns an element of the array', () => {
  const r = new Rng(3);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(r.pick(arr)));
});

test('Rng.gaussian is roughly mean 0, stddev 1', () => {
  const r = new Rng(123);
  const n = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const g = r.gaussian();
    sum += g;
    sumSq += g * g;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.05, `mean ${mean} not near 0`);
  assert.ok(Math.abs(variance - 1) < 0.1, `variance ${variance} not near 1`);
});

test('Rng.unitVector is unit length', () => {
  const r = new Rng(5);
  for (let i = 0; i < 100; i++) {
    const v = r.unitVector();
    assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  }
});

test('wordSeed produces a stable adjective-noun-number from a seeded source', () => {
  const w1 = wordSeed(mulberry32(1));
  const w2 = wordSeed(mulberry32(1));
  assert.equal(w1, w2);
  assert.match(w1, /^[a-z]+-[a-z]+-\d{2}$/);
});

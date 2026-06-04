// prng.js — deterministic, seedable pseudo-random number generation.
//
// Everything visual in Morphogen must be reproducible from a single integer
// seed so that a render can be captured in a URL and recreated exactly. We use
// a small, fast, well-distributed generator (mulberry32) seeded through a
// string hash so seeds can be either numbers or human-friendly words.

/**
 * Hash an arbitrary string into a 32-bit unsigned integer (xmur3).
 * Used to turn word-seeds ("coral", "dusk") into numeric seeds.
 * @param {string} str
 * @returns {number} 32-bit unsigned integer
 */
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32: a compact 32-bit generator with good statistical quality for
 * visual work. Returns a function producing floats in [0, 1).
 * @param {number} seed 32-bit integer seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalize any seed input (number | string | undefined) to a 32-bit integer.
 * @param {number|string} seed
 * @returns {number}
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length) {
    const n = Number(seed);
    if (Number.isFinite(n) && seed.trim() !== '') return n >>> 0;
    return hashString(seed);
  }
  return 0;
}

/**
 * A small, rich random source wrapping a base generator. All higher-level
 * systems should draw randomness from an instance of this class so behaviour
 * stays reproducible.
 */
export class Rng {
  /** @param {number|string} seed */
  constructor(seed = 0) {
    this.seed = normalizeSeed(seed);
    this._next = mulberry32(this.seed);
  }

  /** Float in [0, 1). */
  next() {
    return this._next();
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + (max - min) * this._next();
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p (default 0.5). */
  chance(p = 0.5) {
    return this._next() < p;
  }

  /** Random sign, -1 or +1. */
  sign() {
    return this._next() < 0.5 ? -1 : 1;
  }

  /** Pick a uniformly random element from an array. */
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }

  /**
   * Standard-normal (mean 0, stddev 1) via Box–Muller. A cached second value
   * keeps the two generated normals from going to waste.
   */
  gaussian() {
    if (this._spare !== undefined) {
      const v = this._spare;
      this._spare = undefined;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this._next();
    while (v === 0) v = this._next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    this._spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  }

  /** Fisher–Yates shuffle, returns a new array (does not mutate input). */
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  /** A unit vector at a uniformly random angle: {x, y}. */
  unitVector() {
    const a = this._next() * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  /** Reset the stream back to the original seed. */
  reset() {
    this._next = mulberry32(this.seed);
    this._spare = undefined;
    return this;
  }
}

/**
 * Generate a friendly random word-seed (adjective+noun) using a base generator.
 * Used by the "randomize seed" button to produce shareable, memorable seeds.
 * @param {() => number} rand a [0,1) source
 * @returns {string}
 */
export function wordSeed(rand) {
  const adj = [
    'coral', 'dusk', 'amber', 'frost', 'ember', 'slate', 'lush', 'pale',
    'neon', 'murk', 'gilt', 'azure', 'rust', 'mint', 'dim', 'bright',
    'velvet', 'static', 'liquid', 'bloom', 'drift', 'pulse', 'silt', 'glass',
  ];
  const noun = [
    'reef', 'moth', 'tide', 'fern', 'comet', 'lattice', 'orchid', 'cinder',
    'vapor', 'spire', 'delta', 'quartz', 'marrow', 'plume', 'husk', 'flux',
    'nimbus', 'thicket', 'meadow', 'canyon', 'signal', 'fathom', 'cradle', 'echo',
  ];
  const a = adj[Math.floor(rand() * adj.length)];
  const n = noun[Math.floor(rand() * noun.length)];
  const num = Math.floor(rand() * 90 + 10);
  return `${a}-${n}-${num}`;
}

// particlelife.js — Particle Life / Clusters.
//
// N particles of K species drift in a toroidal world. An asymmetric K x K
// matrix A in [-1,1] (seeded from c.rng) sets how each species feels every
// other: universal short-range repulsion below rMin, a signed attraction band
// out to rMax, nothing beyond. Asymmetry (A[i][j] != A[j][i]) is what breeds
// chasing, orbits and self-organising "cells" — emergent life from a few rules.
//
// Performance: a uniform spatial-hash grid (cell size = rMax) is rebuilt each
// frame via a counting-sort layout so each particle only tests the particles in
// its neighbouring cells — O(N * neighbours), not O(N^2). All buffers are
// allocated in init() / on a structural change; the step() hot loop allocates
// nothing.

import { sampleCss } from '../engine/color.js';

const DT = 0.4;          // integration step (small, as the brief suggests)
const FORCE_GAIN = 24;   // scales forceScale into a lively acceleration
const RMIN_FRAC = 0.3;   // rMin = rMax * RMIN_FRAC

export default function create() {
  // Particle state (Structure-of-Arrays for cache-friendly hot loops).
  // Positions are double-buffered: every particle reads neighbours from the
  // CURRENT x/y snapshot and writes its next position into nx/ny, then we swap.
  // Without this, integrating x[i] in place would let particle i feel its
  // lower-indexed neighbours at their *already-advanced* positions — an
  // order-dependent (Gauss–Seidel) asymmetry that corrupts the dynamics. The
  // brief's force law assumes a single consistent snapshot (Jacobi update).
  let x = null, y = null, vx = null, vy = null, species = null;
  let nx = null, ny = null;     // scratch position buffers (swapped each frame)
  let N = 0, K = 0;
  let A = null;                 // flat K*K attraction matrix in [-1,1], row=feeler

  // Spatial-hash grid (rebuilt each frame; buffers reused across frames).
  let cols = 0, rows = 0, cellW = 1, cellH = 1;
  let cellCount = null, cellStart = null, cellItems = null;
  // Precomputed neighbour cells per column / row so the hot loop never
  // double-counts when the grid is small (cols/rows < 3 with toroidal wrap).
  let colNbr = null, colNbrN = null, rowNbr = null, rowNbrN = null;
  let gridW = 0, gridH = 0;     // canvas size the grid was built for
  let lastRMax = -1;

  // Build the neighbour-cell lookup for one axis. With cell size == rMax a
  // particle can only reach the adjacent cell, so 3 wrapped neighbours suffice
  // — but when there are <= 3 cells those wrapped offsets repeat (e.g. cols=2
  // gives {1,0,1}), which would count forces twice. In that case we instead
  // list every distinct cell once. Returns {flat, counts} typed arrays.
  function buildAxisNbr(n) {
    const counts = new Int32Array(n);
    const stride = 3;                       // max neighbours per cell (3-wide)
    const flat = new Int32Array(n * stride);
    for (let g = 0; g < n; g++) {
      if (n <= 3) {
        // Every cell is reachable; visit each exactly once.
        for (let c2 = 0; c2 < n; c2++) flat[g * stride + c2] = c2;
        counts[g] = n;
      } else {
        let k = -1;
        flat[g * stride + ++k] = g === 0 ? n - 1 : g - 1; // wrapped left
        flat[g * stride + ++k] = g;                        // self
        flat[g * stride + ++k] = g === n - 1 ? 0 : g + 1;  // wrapped right
        counts[g] = 3;
      }
    }
    return { flat, counts, stride };
  }

  // (Re)build grid dimensions + neighbour tables for the current rMax / canvas.
  function sizeGrid(c, rMax) {
    cols = Math.max(1, Math.floor(c.width / rMax));
    rows = Math.max(1, Math.floor(c.height / rMax));
    cellW = c.width / cols;
    cellH = c.height / rows;
    const nCells = cols * rows;
    cellCount = new Int32Array(nCells);
    cellStart = new Int32Array(nCells + 1);
    if (!cellItems || cellItems.length !== N) cellItems = new Int32Array(N);
    const cn = buildAxisNbr(cols);
    colNbr = cn.flat; colNbrN = cn.counts;
    const rn = buildAxisNbr(rows);
    rowNbr = rn.flat; rowNbrN = rn.counts;
    lastRMax = rMax;
    gridW = c.width; gridH = c.height;
  }

  // Clamp a coordinate to a valid cell index along an axis.
  function cellIdx(v, size, n) {
    let i = (v / size) | 0;
    if (i < 0) i = 0; else if (i >= n) i = n - 1;
    return i;
  }

  return {
    meta: {
      id: 'particlelife',
      name: 'Particle Life',
      blurb: 'A few asymmetric rules; colonies that chase, orbit and breathe.',
      category: 'Life',
    },
    params: [
      { key: 'particles', label: 'Particles', type: 'int', min: 300, max: 2500, step: 100, default: 1200, structural: true },
      { key: 'species', label: 'Species', type: 'int', min: 2, max: 7, step: 1, default: 5, structural: true, hint: 'Number of colors / kinds' },
      { key: 'rMax', label: 'Reach', type: 'range', min: 30, max: 170, step: 1, default: 90, hint: 'Interaction radius' },
      { key: 'forceScale', label: 'Force', type: 'range', min: 0.1, max: 3, step: 0.05, default: 1 },
      { key: 'friction', label: 'Friction', type: 'range', min: 0.5, max: 0.99, step: 0.01, default: 0.86, hint: 'Lower = more damping' },
      { key: 'fade', label: 'Trail', type: 'range', min: 0.02, max: 0.4, step: 0.01, default: 0.12, hint: 'Lower = longer trails' },
      { key: 'attract', label: 'Pointer pulls', type: 'toggle', default: true, hint: 'Off = pointer repels' },
      { key: 'palette', label: 'Palette', type: 'select', default: 'cyber', options: [
        { value: 'cyber', label: 'Cyber' }, { value: 'spectral', label: 'Spectral' },
        { value: 'ember', label: 'Ember' }, { value: 'ice', label: 'Ice' },
        { value: 'coral', label: 'Coral' }, { value: 'moss', label: 'Moss' } ] },
    ],

    init(c) {
      if (!c.width || !c.height) return;     // stage not laid out yet
      N = Math.max(1, c.params.particles | 0);
      K = Math.max(1, c.params.species | 0);

      // Seed the asymmetric attraction matrix in [-1,1] from the seeded Rng.
      A = new Float32Array(K * K);
      for (let i = 0; i < K * K; i++) A[i] = c.rng.range(-1, 1);

      // Allocate + seed particles (positions/velocities/species) deterministically.
      x = new Float32Array(N); y = new Float32Array(N);
      nx = new Float32Array(N); ny = new Float32Array(N);
      vx = new Float32Array(N); vy = new Float32Array(N);
      species = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        x[i] = c.rng.next() * c.width;
        y[i] = c.rng.next() * c.height;
        species[i] = c.rng.next() * K | 0;   // floor(rng*K) in [0, K-1]
      }

      cellItems = new Int32Array(N);
      sizeGrid(c, c.params.rMax);
      c.clear(1);                            // clean opaque opening frame
    },

    step(c) {
      if (!N || !x || !c.width || !c.height) return;
      const p = c.params, ctx = c.ctx;
      const w = c.width, h = c.height;
      const rMax = p.rMax, rMin = rMax * RMIN_FRAC;
      const rMax2 = rMax * rMax;
      const invBand = 1 / (rMax - rMin);     // (rMax>rMin always, so no div0)
      const invRMin = 1 / rMin;
      const force = p.forceScale * FORCE_GAIN;
      const friction = p.friction;
      const halfW = w * 0.5, halfH = h * 0.5;

      // Rebuild grid when rMax changed or the canvas resized under us.
      if (rMax !== lastRMax || gridW !== w || gridH !== h) sizeGrid(c, rMax);
      const cc = cols, rr = rows, cw = cellW, ch = cellH;

      // ---- Build spatial hash via counting sort (no allocations) ----
      const nCells = cc * rr;
      cellCount.fill(0, 0, nCells);
      for (let i = 0; i < N; i++) {
        const cx = cellIdx(x[i], cw, cc), cy = cellIdx(y[i], ch, rr);
        cellCount[cy * cc + cx]++;
      }
      let acc = 0;
      for (let ci = 0; ci < nCells; ci++) { cellStart[ci] = acc; acc += cellCount[ci]; }
      cellStart[nCells] = acc;
      // Reuse cellCount as a per-cell write cursor (starts at each cell's base).
      for (let ci = 0; ci < nCells; ci++) cellCount[ci] = cellStart[ci];
      for (let i = 0; i < N; i++) {
        const cx = cellIdx(x[i], cw, cc), cy = cellIdx(y[i], ch, rr);
        cellItems[cellCount[cy * cc + cx]++] = i;
      }

      const ptrActive = c.pointer.down;
      const ptrSign = p.attract ? 1 : -1;
      const ptrR = rMax * 1.8, ptrR2 = ptrR * ptrR, ptrPull = 60;
      const ptrX = c.pointer.x, ptrY = c.pointer.y;

      // ---- Accumulate forces over the neighbouring cells ----
      for (let i = 0; i < N; i++) {
        const xi = x[i], yi = y[i];
        const siRow = species[i] * K;        // matrix row base for the feeler
        let ax = 0, ay = 0;
        const gx = cellIdx(xi, cw, cc), gy = cellIdx(yi, ch, rr);
        const rBase = gy * 3, cBase = gx * 3;   // stride==3 in the nbr tables
        const rN = rowNbrN[gy], cN = colNbrN[gx];

        for (let oy = 0; oy < rN; oy++) {
          const rowBase = rowNbr[rBase + oy] * cc;
          for (let ox = 0; ox < cN; ox++) {
            const cell = rowBase + colNbr[cBase + ox];
            const start = cellStart[cell], end = cellStart[cell + 1];
            for (let k = start; k < end; k++) {
              const j = cellItems[k];
              if (j === i) continue;
              // Shortest toroidal displacement from i to j.
              let dx = x[j] - xi; if (dx > halfW) dx -= w; else if (dx < -halfW) dx += w;
              let dy = y[j] - yi; if (dy > halfH) dy -= h; else if (dy < -halfH) dy += h;
              const d2 = dx * dx + dy * dy;
              if (d2 >= rMax2 || d2 === 0) continue;   // out of range / self-overlap
              const d = Math.sqrt(d2);
              let f;
              if (d < rMin) {
                f = d * invRMin - 1;                            // short-range repulsion (<0)
              } else {
                const a = A[siRow + species[j]];
                f = a * (1 - Math.abs(2 * d - rMin - rMax) * invBand); // signed attraction band
              }
              const inv = f / d;                               // (dx,dy)/d * f, fused
              ax += dx * inv; ay += dy * inv;
            }
          }
        }

        // Pointer interaction (continuous while held): pull or push nearby ones.
        if (ptrActive) {
          let dx = ptrX - xi; if (dx > halfW) dx -= w; else if (dx < -halfW) dx += w;
          let dy = ptrY - yi; if (dy > halfH) dy -= h; else if (dy < -halfH) dy += h;
          const d2 = dx * dx + dy * dy;
          if (d2 < ptrR2 && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const fall = (1 - d / ptrR) * ptrPull * ptrSign / d;
            ax += dx * fall; ay += dy * fall;
          }
        }

        // Semi-implicit Euler with damping; forceScale folded into acceleration.
        const nvx = (vx[i] + ax * force * DT) * friction;
        const nvy = (vy[i] + ay * force * DT) * friction;
        vx[i] = nvx; vy[i] = nvy;
        // Integrate into the SCRATCH buffer + toroidal wrap (modulo handles
        // overshoot from any speed). Reading stays on the current x/y snapshot,
        // so all particles see the same positions this frame (Jacobi update).
        let px2 = (xi + nvx * DT) % w; if (px2 < 0) px2 += w;
        let py2 = (yi + nvy * DT) % h; if (py2 < 0) py2 += h;
        nx[i] = px2; ny[i] = py2;
      }

      // Commit the frame: swap scratch buffers in to become the current state.
      const tx = x; x = nx; nx = tx;
      const ty = y; y = ny; ny = ty;

      // ---- Render: faint trails, then a dot per particle coloured by species ----
      c.clear(p.fade);
      const denom = K > 1 ? K - 1 : 1;
      // One fill style per species per frame; batch all dots of a species in a
      // single path (cheap, avoids per-dot fillStyle churn).
      for (let s = 0; s < K; s++) {
        ctx.fillStyle = sampleCss(p.palette, s / denom, 0.9);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if (species[i] !== s) continue;
          ctx.moveTo(x[i] + 1.6, y[i]);                 // jump pen so subpaths don't connect
          ctx.arc(x[i], y[i], 1.6, 0, 6.283185307179586);
        }
        ctx.fill();
      }
    },

    onPointer() { /* continuous attraction handled in step() via c.pointer.down */ },
  };
}

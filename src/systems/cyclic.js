// cyclic.js — Griffeath's Cyclic Cellular Automaton.
//
// Every cell holds a state in [0, N-1] arranged as a colour wheel. A cell in
// state s "eats" forward: if at least `threshold` of its Moore neighbours (out
// to range R, toroidal) already hold the next state (s+1)%N, the cell advances
// to that state. Iterated synchronously this turns seeded noise into demons
// that consume each other and self-organise into endlessly rotating spiral
// waves. A low threshold (default 1) gives excitable-medium dynamics where
// fronts sweep the grid and curl into spirals within seconds; higher thresholds
// freeze into static domains. The grid is a fixed Uint8 buffer blitted to the
// stage via an offscreen ImageData so resolution stays independent of canvas size.

import { ramp } from '../engine/color.js';
import { clamp } from '../engine/mathx.js';

const GW = 280;   // fixed grid width; height derives from stage aspect (capped)
const HMAX = 640; // cap grid height so tall/portrait stages stay real-time
// Sized for crisp cells when blitted across a large stage while staying cheap
// (cyclic CA is just integer neighbour counts). Threshold 1 keeps spirals
// forming quickly even on the denser grid.

export default function create() {
  let W = 0, H = 0, N = 0, R = 1;
  let grid = null, next = null; // double-buffered Uint8 state grids
  let xw = null, yw = null;     // precomputed wrapped neighbour columns / rows
  let span = 0;                 // 2R+1 (neighbours per axis)
  let off = null, offCtx = null, img = null, data = null;
  let lut = null, lutPalette = null; // palette ramp LUT + the name it was built for

  // Build wrap tables so the inner loop never touches the modulo operator.
  // xw[x*span + k] = wrapped column of (x + k - R); same idea for rows.
  function buildWrap() {
    span = 2 * R + 1;
    xw = new Int32Array(W * span);
    yw = new Int32Array(H * span);
    for (let x = 0; x < W; x++)
      for (let k = 0; k < span; k++) xw[x * span + k] = ((x + k - R) % W + W) % W;
    for (let y = 0; y < H; y++)
      for (let k = 0; k < span; k++) yw[y * span + k] = ((y + k - R) % H + H) % H;
  }

  // Fill every cell with a uniformly random state in [0, N-1] from the seeded
  // RNG. Must cover the whole W*H grid — seeding only part of it leaves a near
  // uniform field that can never self-organise into spirals.
  function seed(c) {
    const cells = W * H;
    for (let i = 0; i < cells; i++) grid[i] = c.rng.int(0, N - 1);
  }

  return {
    meta: {
      id: 'cyclic',
      name: 'Cyclic Automaton',
      blurb: 'Cells devouring each other in slow, hypnotic spiral storms.',
      category: 'Reaction',
    },
    params: [
      { key: 'states', label: 'States', type: 'int', min: 3, max: 16, step: 1, default: 8, structural: true, hint: 'Colours in the cycle (N)' },
      { key: 'threshold', label: 'Threshold', type: 'int', min: 1, max: 5, step: 1, default: 1, hint: 'Neighbours needed to advance (low = excitable, spiral waves)' },
      { key: 'range', label: 'Range', type: 'int', min: 1, max: 2, step: 1, default: 1, structural: true, hint: 'Moore neighbourhood radius' },
      { key: 'speed', label: 'Speed', type: 'int', min: 1, max: 8, step: 1, default: 6, hint: 'Generations per frame (higher = spirals form sooner)' },
      { key: 'palette', label: 'Palette', type: 'select', default: 'spectral', options: [
        { value: 'spectral', label: 'Spectral' }, { value: 'cyber', label: 'Cyber' },
        { value: 'ice', label: 'Ice' }, { value: 'ember', label: 'Ember' },
        { value: 'dusk', label: 'Dusk' }, { value: 'moss', label: 'Moss' },
        { value: 'coral', label: 'Coral' }, { value: 'abyss', label: 'Abyss' } ] },
    ],

    init(c) {
      if (!c.width || !c.height) return; // stage not sized yet — bail safely
      N = clamp(c.params.states | 0, 3, 16); // state count == colour-cycle length
      R = clamp(c.params.range | 0, 1, 2);
      W = GW;
      H = clamp(Math.round(GW * c.height / c.width), 1, HMAX); // bound portrait grids
      const cells = W * H;

      grid = new Uint8Array(cells);
      next = new Uint8Array(cells);
      buildWrap();

      // Offscreen buffer sized to the grid; blit-scaled to the stage each frame.
      off = document.createElement('canvas');
      off.width = W; off.height = H;
      offCtx = off.getContext('2d');
      img = offCtx.createImageData(W, H);
      data = img.data;
      for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque alpha

      lut = ramp(c.params.palette, 256);
      lutPalette = c.params.palette;
      seed(c);
    },

    step(c) {
      if (!N) return; // not initialised (degenerate size) — bail safely
      const p = c.params;
      const thr = clamp(p.threshold | 0, 1, 5);
      const iters = clamp(p.speed | 0, 1, 8);
      const w = W, h = H, n = N, sp = span;

      // Rebuild the palette LUT only when the selection actually changes.
      if (p.palette !== lutPalette) { lut = ramp(p.palette, 256); lutPalette = p.palette; }

      // Run `speed` synchronous generations. Each cell counts Moore neighbours
      // (range R, toroidal) holding the next state (s+1)%n and advances if the
      // tally meets the threshold; otherwise it is copied unchanged.
      for (let it = 0; it < iters; it++) {
        for (let y = 0; y < h; y++) {
          const yb = y * sp, row = y * w;
          for (let x = 0; x < w; x++) {
            const i = row + x;
            const s = grid[i];
            const want = s + 1 === n ? 0 : s + 1; // (s+1) % n without the divide
            let count = 0;
            const xb = x * sp;
            for (let ky = 0; ky < sp; ky++) {
              const ny = yw[yb + ky] * w;
              for (let kx = 0; kx < sp; kx++) {
                if (grid[ny + xw[xb + kx]] === want) count++;
              }
            }
            // The centre cell holds s, never == want, so it never self-counts.
            next[i] = count >= thr ? want : s;
          }
        }
        const t = grid; grid = next; next = t; // swap buffers, no allocation
      }

      // Render state -> t in [0,1] -> palette LUT -> ImageData.
      const denom = n > 1 ? n - 1 : 1;
      const cells = w * h;
      for (let i = 0; i < cells; i++) {
        const li = ((grid[i] / denom) * 255 | 0) * 3;
        const o = i * 4;
        data[o] = lut[li];
        data[o + 1] = lut[li + 1];
        data[o + 2] = lut[li + 2];
      }
      offCtx.putImageData(img, 0, 0);

      // Blit the grid across the full logical rect (handles any aspect / dpr).
      c.ctx.imageSmoothingEnabled = true;
      c.ctx.drawImage(off, 0, 0, c.width, c.height);
    },
  };
}

// lenia.js — Lenia: smooth continuous cellular automata (Bert Chan).
//
// A fixed 120x120 toroidal grid of Float32 states in [0,1]. Each step convolves
// the field with a smooth ring kernel to get a potential U, then nudges every
// cell by dt * G(U) where G is a Gaussian "growth" curve centered on mu. With
// the right mu/sigma the field self-organizes into drifting, gliding lifeforms.
// Rendered through a palette ramp into an offscreen canvas, then drawn scaled.

import { ramp } from '../engine/color.js';
import { clamp } from '../engine/mathx.js';

const SIZE = 140; // square sim grid; convolution-bound, so balanced for crisp detail vs framerate
const RMAX = 13;  // hard cap on kernel radius — keeps the convolution real-time

export default function create() {
  let state = null, next = null;          // Float32 fields, length SIZE*SIZE
  let kdx = null, kdy = null, kw = null;  // precomputed ring-kernel offsets + weights
  let kernR = 0;                          // radius the current kernel was built for
  let wrap = null;                        // toroidal index LUT (see buildWrap)
  let off = null, octx = null, img = null, data = null; // offscreen render target
  let lut = null;                         // palette ramp (256 rgb triples)
  let lutName = null;

  // Toroidal-wrap LUT so the hot convolution loop avoids per-neighbor modulo.
  // Neighbor coords are coord = base + offset where base in [0, SIZE) and
  // |offset| <= RMAX, so coord spans [-RMAX, SIZE-1+RMAX]. We bias every lookup
  // by SIZE (the hot loop adds SIZE to y/x first), giving access indices in
  // [SIZE-RMAX, 2*SIZE-1+RMAX]; sizing the table to 2*SIZE+RMAX and filling the
  // full coordinate span guarantees every access is in-bounds and initialized.
  function buildWrap() {
    wrap = new Int16Array(2 * SIZE + RMAX);
    for (let v = -SIZE; v < 2 * SIZE + RMAX; v++) {
      const i = v + SIZE;
      if (i >= 0 && i < wrap.length) wrap[i] = ((v % SIZE) + SIZE) % SIZE;
    }
  }

  // Build the normalized ring kernel for radius R (only when R changes).
  function buildKernel(R) {
    const dx = [], dy = [], w = [];
    let sum = 0;
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const r = Math.hypot(x, y);
        if (r <= 0 || r > R) continue;
        const d = r / R;                        // normalized radius in (0,1]
        const wt = Math.exp(-((d - 0.5) * (d - 0.5)) / (2 * 0.15 * 0.15));
        dx.push(x); dy.push(y); w.push(wt); sum += wt;
      }
    }
    const inv = sum > 0 ? 1 / sum : 0;          // guard divide-by-zero (sum>0 for R>=1)
    kdx = Int8Array.from(dx);                    // |offset| <= RMAX fits int8
    kdy = Int8Array.from(dy);
    kw = Float32Array.from(w, (v) => v * inv);   // normalize weights to sum 1
    kernR = R;
    if (!wrap) buildWrap();
  }

  // Seed `state` with a smooth field whose central density sits near the growth
  // center mu, so large areas fall inside the narrow growth band and self-
  // organize into gliders instead of immediately decaying. Built from a coarse
  // random lattice, blurred smooth, then scaled and masked to a central disk.
  function seedField(c, hi, region) {
    state.fill(0);
    const cx = SIZE >> 1, cy = SIZE >> 1, step = 6;
    for (let gy = 0; gy < SIZE; gy += step) {
      for (let gx = 0; gx < SIZE; gx += step) {
        const val = c.rng.next();
        for (let y = 0; y < step; y++) {
          for (let x = 0; x < step; x++) {
            const px = gx + x, py = gy + y;
            if (px < SIZE && py < SIZE) state[py * SIZE + px] = val;
          }
        }
      }
    }
    // Blur the blocky lattice into smooth value-noise (4 box passes). Each pass
    // reads `state`, writes `next`, then swaps; an even count leaves the result
    // back in `state`.
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          let a = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = (x + dx + SIZE) % SIZE, ny = (y + dy + SIZE) % SIZE;
              a += state[ny * SIZE + nx];
            }
          }
          next[y * SIZE + x] = a / 25;
        }
      }
      const tmp = state; state = next; next = tmp;
    }
    // Scale to [0,hi] and fade outside a central disk (soft edge) -> calm border.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = Math.hypot(x - cx, y - cy);
        const mask = r < region ? 1 : Math.max(0, 1 - (r - region) / 8);
        state[y * SIZE + x] = clamp(state[y * SIZE + x] * hi * mask, 0, 1);
      }
    }
  }

  // Paint a smooth circular blob of life centered on grid cell (cx,cy).
  function blob(c, cx, cy, radius, peak) {
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const r = Math.hypot(x, y);
        if (r > radius) continue;
        const gx = ((cx + x) % SIZE + SIZE) % SIZE;
        const gy = ((cy + y) % SIZE + SIZE) % SIZE;
        const fall = 1 - r / radius;                  // 1 at center -> 0 at edge
        const v = peak * fall * (0.6 + 0.4 * c.rng.next());
        const idx = gy * SIZE + gx;
        if (v > state[idx]) state[idx] = clamp(v, 0, 1);
      }
    }
  }

  return {
    meta: {
      id: 'lenia',
      name: 'Lenia',
      blurb: 'Smooth cellular automata where gliding cells breathe and divide.',
      category: 'Life',
    },
    params: [
      { key: 'mu', label: 'Growth center', type: 'range', min: 0.10, max: 0.40, step: 0.005, default: 0.15, hint: 'Target neighborhood density' },
      { key: 'sigma', label: 'Growth width', type: 'range', min: 0.008, max: 0.05, step: 0.001, default: 0.017, hint: 'Tolerance around the center' },
      { key: 'dt', label: 'Time step', type: 'range', min: 0.04, max: 0.3, step: 0.01, default: 0.1, hint: 'Higher = livelier, less stable' },
      { key: 'R', label: 'Kernel radius', type: 'int', min: 8, max: 13, step: 1, default: 12, structural: true, hint: 'Size of each cell’s sensing ring' },
      { key: 'palette', label: 'Palette', type: 'select', default: 'spectral', options: [
        { value: 'spectral', label: 'Spectral' }, { value: 'abyss', label: 'Abyss' },
        { value: 'ember', label: 'Ember' }, { value: 'moss', label: 'Moss' },
        { value: 'ice', label: 'Ice' }, { value: 'cyber', label: 'Cyber' } ] },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard: stage not sized yet
      const n = SIZE * SIZE;
      state = new Float32Array(n);
      next = new Float32Array(n);

      // Clamp R<=RMAX for real-time even if a structural change requests more.
      buildKernel(clamp(c.params.R | 0, 1, RMAX));

      // Offscreen render target at sim resolution; smoothing on for organic look.
      off = document.createElement('canvas');
      off.width = SIZE; off.height = SIZE;
      octx = off.getContext('2d');
      img = octx.createImageData(SIZE, SIZE);
      data = img.data;
      lutName = c.params.palette;
      lut = ramp(lutName, 256);

      // Seed a smooth field tuned so the central density hovers near mu — this
      // reliably births drifting lifeforms rather than decaying to emptiness.
      seedField(c, 0.42, 34);
      c.clear(1);
    },

    step(c) {
      if (!state) return;
      const p = c.params;
      const R = clamp(p.R | 0, 1, RMAX);
      if (R !== kernR) buildKernel(R); // structural change rebuilds the kernel
      if (p.palette !== lutName) { lutName = p.palette; lut = ramp(lutName, 256); }

      const mu = p.mu, dt = p.dt;
      const sig = p.sigma > 1e-4 ? p.sigma : 1e-4; // guard divide-by-zero
      const inv2s2 = 1 / (2 * sig * sig);
      const kn = kw.length;
      const st = state, nx2 = next, kx = kdx, ky = kdy, w = kw, W = wrap; // locals = faster

      // One simulation tick: convolve with the ring kernel, then apply growth.
      // The wrap LUT replaces two modulos per neighbor with two array reads.
      for (let y = 0; y < SIZE; y++) {
        const rowBase = y * SIZE, yo = y + SIZE;
        for (let x = 0; x < SIZE; x++) {
          const xo = x + SIZE;
          let u = 0;
          for (let k = 0; k < kn; k++) {
            const row = W[yo + ky[k]] * SIZE; // wrapped neighbor row offset
            u += w[k] * st[row + W[xo + kx[k]]];
          }
          // Growth G(u) = 2*exp(-((u-mu)^2)/(2*sig^2)) - 1, in [-1,1].
          const du = u - mu;
          const g = 2 * Math.exp(-(du * du) * inv2s2) - 1;
          const v = st[rowBase + x] + dt * g;
          nx2[rowBase + x] = v < 0 ? 0 : v > 1 ? 1 : v;
        }
      }
      const tmp = state; state = next; next = tmp; // swap buffers

      // Render the live field through the palette ramp into the offscreen image.
      const cur = state;
      for (let i = 0, j = 0; i < cur.length; i++, j += 4) {
        let t = cur[i]; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const l3 = ((t * 255) | 0) * 3;
        data[j] = lut[l3]; data[j + 1] = lut[l3 + 1]; data[j + 2] = lut[l3 + 2];
        data[j + 3] = 255;
      }
      octx.putImageData(img, 0, 0);

      // Draw scaled to the full logical rect (works for any aspect ratio); blit
      // goes to c.ctx via drawImage so the dpr transform is respected.
      const ctx = c.ctx;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, SIZE, SIZE, 0, 0, c.width, c.height);
    },

    // While the pointer is down, paint a smooth blob of life at the mapped cell.
    onPointer(c, type) {
      if (!state || !c.pointer.down || type === 'up') return;
      const gx = clamp(Math.floor((c.pointer.x / c.width) * SIZE), 0, SIZE - 1);
      const gy = clamp(Math.floor((c.pointer.y / c.height) * SIZE), 0, SIZE - 1);
      blob(c, gx, gy, Math.max(6, kernR >> 1), 1.0);
    },
  };
}

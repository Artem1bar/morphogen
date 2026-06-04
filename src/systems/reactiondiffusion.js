// reactiondiffusion.js — Gray-Scott reaction-diffusion.
//
// Two virtual chemicals U and V diffuse and react on a fixed toroidal grid.
// U feeds, V is killed, and the U + 2V -> 3V autocatalytic reaction lets V
// self-organise into coral mazes, mitosing spots, and pulsing waves depending
// on the feed/kill balance. The sim runs at a fixed resolution independent of
// canvas size and is blitted to the stage via an offscreen ImageData.

import { ramp } from '../engine/color.js';
import { clamp } from '../engine/mathx.js';

// Grid resolution on the long edge. Higher = crisper coral filaments when the
// buffer is blitted across the stage; the Gray-Scott update stays real-time.
const MAXDIM = 300;
const DU = 1.0; // U diffusion rate
const DV = 0.5; // V diffusion rate

export default function create() {
  let SIMW = 0, SIMH = 0, N = 0;
  let u = null, v = null, u2 = null, v2 = null;
  let off = null, offCtx = null, img = null, data = null;
  let lut = null, lutPalette = null; // precomputed palette ramp + its name

  // Seed ~12 square patches of V (U dips to 0.5) so growth has nuclei to spread from.
  function seed(c) {
    for (let i = 0; i < N; i++) { u[i] = 1; v[i] = 0; }
    const patches = 12;
    for (let p = 0; p < patches; p++) {
      const cx = c.rng.int(0, SIMW - 1);
      const cy = c.rng.int(0, SIMH - 1);
      const r = c.rng.int(3, 7);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = ((cx + dx) % SIMW + SIMW) % SIMW;
          const y = ((cy + dy) % SIMH + SIMH) % SIMH;
          const idx = y * SIMW + x;
          v[idx] = 1; u[idx] = 0.5;
        }
      }
    }
  }

  // Paint V into a small circular brush at sim cell (cx,cy) — drives interaction.
  function paint(cx, cy) {
    const r = 6;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = ((cx + dx) % SIMW + SIMW) % SIMW;
        const y = ((cy + dy) % SIMH + SIMH) % SIMH;
        const idx = y * SIMW + x;
        v[idx] = 1; u[idx] = 0.2;
      }
    }
  }

  return {
    meta: {
      id: 'reactiondiffusion',
      name: 'Reaction–Diffusion',
      blurb: 'Two restless chemicals negotiating coral, spots, and mazes.',
      category: 'Reaction',
    },
    params: [
      { key: 'feed', label: 'Feed', type: 'range', min: 0.01, max: 0.09, step: 0.0005, default: 0.0545, hint: 'How fast U is replenished' },
      { key: 'kill', label: 'Kill', type: 'range', min: 0.04, max: 0.07, step: 0.0005, default: 0.062, hint: 'How fast V decays' },
      { key: 'steps', label: 'Iterations / frame', type: 'int', min: 1, max: 14, step: 1, default: 8, hint: 'Higher = faster growth' },
      { key: 'scale', label: 'Contrast', type: 'range', min: 1, max: 6, step: 0.1, default: 3.2, hint: 'Maps V concentration to brightness' },
      { key: 'palette', label: 'Palette', type: 'select', default: 'ember', options: [
        { value: 'ember', label: 'Ember' }, { value: 'coral', label: 'Coral' },
        { value: 'ice', label: 'Ice' }, { value: 'moss', label: 'Moss' },
        { value: 'dusk', label: 'Dusk' }, { value: 'spectral', label: 'Spectral' },
        { value: 'cyber', label: 'Cyber' }, { value: 'mono', label: 'Mono' } ] },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard: stage not sized yet
      // Long edge -> MAXDIM, short edge by aspect (also capped). Never assume square.
      if (c.width >= c.height) {
        SIMW = MAXDIM;
        SIMH = Math.max(1, Math.min(MAXDIM, Math.round(MAXDIM * c.height / c.width)));
      } else {
        SIMH = MAXDIM;
        SIMW = Math.max(1, Math.min(MAXDIM, Math.round(MAXDIM * c.width / c.height)));
      }
      N = SIMW * SIMH;
      u = new Float32Array(N); v = new Float32Array(N);
      u2 = new Float32Array(N); v2 = new Float32Array(N);

      // Offscreen buffer sized to the SIM grid; blit-scaled to the stage each frame.
      off = document.createElement('canvas');
      off.width = SIMW; off.height = SIMH;
      offCtx = off.getContext('2d');
      img = offCtx.createImageData(SIMW, SIMH);
      data = img.data;
      for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque alpha

      lut = ramp(c.params.palette, 256);
      lutPalette = c.params.palette;
      seed(c);
    },

    step(c) {
      if (!N) return; // not initialised (degenerate size) — bail safely
      const p = c.params;
      const feed = p.feed, kill = p.kill;
      const iters = clamp(p.steps | 0, 1, 14);
      const w = SIMW, h = SIMH;

      // Rebuild the palette LUT only when the selection actually changes.
      if (p.palette !== lutPalette) { lut = ramp(p.palette, 256); lutPalette = p.palette; }

      // Run several Gray-Scott iterations per displayed frame.
      for (let it = 0; it < iters; it++) {
        for (let y = 0; y < h; y++) {
          const yu = (y - 1 + h) % h, yd = (y + 1) % h;
          const row = y * w, rowU = yu * w, rowD = yd * w;
          for (let x = 0; x < w; x++) {
            const xl = (x - 1 + w) % w, xr = (x + 1) % w;
            const i = row + x;
            const uc = u[i], vc = v[i];
            // Weighted toroidal Laplacian: ortho +0.2, diag +0.05, center -1.
            const lu =
              (u[row + xl] + u[row + xr] + u[rowU + x] + u[rowD + x]) * 0.2 +
              (u[rowU + xl] + u[rowU + xr] + u[rowD + xl] + u[rowD + xr]) * 0.05 - uc;
            const lv =
              (v[row + xl] + v[row + xr] + v[rowU + x] + v[rowD + x]) * 0.2 +
              (v[rowU + xl] + v[rowU + xr] + v[rowD + xl] + v[rowD + xr]) * 0.05 - vc;
            const uvv = uc * vc * vc;
            u2[i] = uc + (DU * lu - uvv + feed * (1 - uc));
            v2[i] = vc + (DV * lv + uvv - (feed + kill) * vc);
          }
        }
        // Swap front/back buffers (no allocation).
        let t = u; u = u2; u2 = t;
        t = v; v = v2; v2 = t;
      }

      // Render V -> brightness -> palette LUT -> ImageData.
      const scale = p.scale;
      for (let i = 0; i < N; i++) {
        let t = v[i] * scale;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const li = ((t * 255) | 0) * 3;
        const o = i * 4;
        data[o] = lut[li];
        data[o + 1] = lut[li + 1];
        data[o + 2] = lut[li + 2];
      }
      offCtx.putImageData(img, 0, 0);

      // Blit the sim grid across the full logical rect (handles any aspect / dpr).
      c.ctx.imageSmoothingEnabled = true;
      c.ctx.drawImage(off, 0, 0, c.width, c.height);
    },

    onPointer(c) {
      if (!N || !c.pointer.down) return;
      const cx = clamp((c.pointer.x / c.width) * SIMW | 0, 0, SIMW - 1);
      const cy = clamp((c.pointer.y / c.height) * SIMH | 0, 0, SIMH - 1);
      paint(cx, cy);
    },
  };
}

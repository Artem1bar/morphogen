// attractors.js — strange attractors as accumulating density plots.
//
// A single orbit (x, y) is iterated through a chosen 2D map thousands of times
// per frame. Each visited point is binned into a fixed-size Float32 density
// grid (independent of canvas size). The density softly fades each frame so the
// plot keeps breathing as the live a/b/c/d params reshape the attractor. The
// grid is tone-mapped (log of density, normalised by a running max) through a
// palette LUT and blitted to the stage via an offscreen ImageData.

import { ramp } from '../engine/color.js';

// Fixed sim grid: 640 on the long edge keeps the per-frame binning real-time.
const DW_MAX = 860;
const DH_MAX = 860;

export default function create() {
  let DW = 0, DH = 0, N = 0;
  let density = null;            // Float32 accumulator, length N
  let off = null, offCtx = null, img = null, data = null;
  let lut = null, lutPalette = null; // palette ramp + the name it was built for
  let ox = 0, oy = 0;            // running orbit state, carried across frames
  let maxDensity = 1;            // tracked peak for log tone-mapping

  // Reset the orbit to small values (the standard attractor starting seed).
  function resetOrbit(c) {
    ox = c.rng.range(-0.1, 0.1);
    oy = c.rng.range(-0.1, 0.1);
  }

  return {
    meta: {
      id: 'attractors',
      name: 'Strange Attractors',
      blurb: 'A single restless orbit smouldering into luminous density.',
      category: 'Math',
    },
    params: [
      { key: 'type', label: 'Map', type: 'select', default: 'clifford', options: [
        { value: 'clifford', label: 'Clifford' },
        { value: 'dejong', label: 'De Jong' },
        { value: 'svensson', label: 'Svensson' } ] },
      { key: 'a', label: 'Parameter a', type: 'range', min: -3, max: 3, step: 0.01, default: -1.7, hint: 'Reshapes the orbit live' },
      { key: 'b', label: 'Parameter b', type: 'range', min: -3, max: 3, step: 0.01, default: 1.8, hint: 'Reshapes the orbit live' },
      { key: 'c', label: 'Parameter c', type: 'range', min: -3, max: 3, step: 0.01, default: -1.9, hint: 'Reshapes the orbit live' },
      { key: 'd', label: 'Parameter d', type: 'range', min: -3, max: 3, step: 0.01, default: -0.4, hint: 'Reshapes the orbit live' },
      { key: 'pointsPerFrame', label: 'Points / frame', type: 'int', min: 10000, max: 150000, step: 10000, default: 60000, hint: 'Density of the plot' },
      { key: 'palette', label: 'Palette', type: 'select', default: 'sand', options: [
        { value: 'sand', label: 'Sand' }, { value: 'ember', label: 'Ember' },
        { value: 'ice', label: 'Ice' }, { value: 'dusk', label: 'Dusk' },
        { value: 'spectral', label: 'Spectral' }, { value: 'cyber', label: 'Cyber' },
        { value: 'abyss', label: 'Abyss' }, { value: 'mono', label: 'Mono' } ] },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard: stage not sized yet
      // Long edge -> max, short edge by aspect (also capped). Never assume square.
      if (c.width >= c.height) {
        DW = DW_MAX;
        DH = Math.max(1, Math.min(DH_MAX, Math.round(DW_MAX * c.height / c.width)));
      } else {
        DH = DH_MAX;
        DW = Math.max(1, Math.min(DW_MAX, Math.round(DH_MAX * c.width / c.height)));
      }
      N = DW * DH;
      density = new Float32Array(N);
      maxDensity = 1;

      // Offscreen buffer sized to the SIM grid; blit-scaled to the stage each frame.
      off = document.createElement('canvas');
      off.width = DW; off.height = DH;
      offCtx = off.getContext('2d');
      img = offCtx.createImageData(DW, DH);
      data = img.data;
      for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque alpha

      lut = ramp(c.params.palette, 256);
      lutPalette = c.params.palette;
      resetOrbit(c);
      c.clear(1);
    },

    step(c) {
      if (!N) return; // not initialised (degenerate size) — bail safely
      const p = c.params;

      // Rebuild the palette LUT only when the selection actually changes.
      if (p.palette !== lutPalette) { lut = ramp(p.palette, 256); lutPalette = p.palette; }

      // Centre the attractor and scale its (~[-2,2]) extent into the grid.
      const scale = Math.min(DW, DH) * 0.22;
      const cx = DW * 0.5, cy = DH * 0.5;
      const a = p.a, b = p.b, cc = p.c, d = p.d;
      const type = p.type;
      const iters = p.pointsPerFrame | 0;

      // Fade the whole accumulator so the plot keeps evolving with live params.
      for (let i = 0; i < N; i++) density[i] *= 0.96;
      maxDensity *= 0.96;
      if (maxDensity < 1) maxDensity = 1;

      // Iterate the chosen map, binning each new point into a density cell.
      let x = ox, y = oy;
      for (let i = 0; i < iters; i++) {
        let xn, yn;
        if (type === 'dejong') {
          xn = Math.sin(a * y) - Math.cos(b * x);
          yn = Math.sin(cc * x) - Math.cos(d * y);
        } else if (type === 'svensson') {
          xn = d * Math.sin(a * x) - Math.sin(b * y);
          yn = cc * Math.cos(a * x) + Math.cos(b * y);
        } else { // clifford (default)
          xn = Math.sin(a * y) + cc * Math.cos(a * x);
          yn = Math.sin(b * x) + d * Math.cos(b * y);
        }
        x = xn; y = yn;

        // floor() (not | 0) so signed, centred coords bin correctly: a value in
        // (-1, 0] must map to cell -1 (rejected) rather than collapsing into 0,
        // which would smear a false bias line along the top/left edges.
        const px = Math.floor(cx + x * scale);
        const py = Math.floor(cy + y * scale);
        // Positive in-range test: a non-finite px/py (NaN from a divergent orbit)
        // fails every comparison and is skipped here, so it can never index the
        // density buffer. A negated || guard would instead let NaN slip through.
        if (px >= 0 && px < DW && py >= 0 && py < DH) {
          const idx = py * DW + px;
          const v = density[idx] + 1;
          density[idx] = v;
          if (v > maxDensity) maxDensity = v;
        }
      }
      // Guard against NaN runaway (some param combos diverge): reseed if needed.
      if (!Number.isFinite(x) || !Number.isFinite(y)) resetOrbit(c);
      else { ox = x; oy = y; }

      // Tone-map: t = log(1+density) / log(1+maxDensity) -> palette LUT.
      const invLogMax = 1 / Math.log(1 + maxDensity);
      for (let i = 0; i < N; i++) {
        const dv = density[i];
        let t = dv > 0 ? Math.log(1 + dv) * invLogMax : 0;
        if (t > 1) t = 1;
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

    dispose() {
      density = null; off = null; offCtx = null; img = null; data = null; lut = null;
    },
  };
}

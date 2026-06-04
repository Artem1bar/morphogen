// domainwarp.js — domain-warped fBm field (Inigo Quilez style).
//
// The classic IQ recipe: feed fBm noise through itself twice. The base
// coordinate p is warped by a first fBm vector q, that result is warped again
// by a second vector r, and the final value v = fbm(p + warp*r) is colored
// through a precomputed palette ramp. Animation drifts the field by advancing
// one of the final noise coordinates with time*speed.
//
// Rendered into a FIXED-SIZE offscreen buffer (SIM=240 wide) so cost is
// independent of canvas/dpr, then drawImage-scaled to fill the logical rect.
// Both axes use the SAME noise frequency per source pixel (invW == invH), which
// keeps features round on any aspect: the source grid is already proportional
// to the stage, so equal noise/source-px means equal noise/screen-px.

import { ramp, PALETTES } from '../engine/color.js';
import { clamp } from '../engine/mathx.js';

// Five fBm evaluations per pixel make this the heaviest field. We claw back
// budget by sampling the two WARP vectors at low detail (only the final colour
// value needs full octaves), which buys a higher-resolution sim grid so the
// blitted result stays crisp instead of mushy.
const SIM = 220;       // sim width; height derived from canvas aspect
const SIM_H_MAX = 440; // cap derived height so extreme portrait stages stay real-time
const WARP_OCT = 2;    // low-detail octaves for the inner warp vectors

export default function create() {
  let off = null;      // offscreen canvas at sim resolution
  let octx = null;     // its 2D context
  let img = null;      // ImageData backing the offscreen
  let data = null;     // img.data (Uint8ClampedArray, RGBA)
  let sw = 0, sh = 0;  // sim width/height in pixels
  let lut = null;      // Uint8ClampedArray palette ramp (256*3)
  let lutName = '';    // palette the lut was built for (rebuild on change)
  const opts = { octaves: 4 };       // full-detail octaves for the final value
  const warpOpts = { octaves: WARP_OCT }; // cheap octaves for the warp vectors

  function ensureLut(name) {
    if (name !== lutName || !lut) {
      // sample() already falls back for unknown names; guard here too so the
      // cache key (lutName) stays meaningful across frames.
      lut = ramp(PALETTES[name] ? name : 'abyss', 256);
      lutName = name;
    }
  }

  return {
    meta: {
      id: 'domainwarp',
      name: 'Domain Warp',
      blurb: 'Noise folded through itself into slow, liquid topographies.',
      category: 'Fields',
    },
    params: [
      { key: 'freq', label: 'Frequency', type: 'range', min: 1, max: 8, step: 0.1, default: 3, hint: 'Base scale of the field' },
      { key: 'warp', label: 'Warp', type: 'range', min: 0, max: 4, step: 0.05, default: 1.6, hint: 'Strength of recursive distortion' },
      { key: 'octaves', label: 'Octaves', type: 'int', min: 1, max: 6, step: 1, default: 4, hint: 'fBm detail of the final value' },
      { key: 'speed', label: 'Drift', type: 'range', min: 0, max: 0.3, step: 0.005, default: 0.06, hint: 'Animation speed' },
      { key: 'contrast', label: 'Contrast', type: 'range', min: 0.5, max: 2.5, step: 0.05, default: 1.2 },
      { key: 'palette', label: 'Palette', type: 'select', default: 'abyss', options: [
        { value: 'abyss', label: 'Abyss' }, { value: 'ice', label: 'Ice' }, { value: 'dusk', label: 'Dusk' },
        { value: 'ember', label: 'Ember' }, { value: 'spectral', label: 'Spectral' }, { value: 'moss', label: 'Moss' },
        { value: 'cyber', label: 'Cyber' }, { value: 'sand', label: 'Sand' } ] },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard against zero-size init
      sw = SIM;
      sh = clamp(Math.round(SIM * c.height / c.width), 1, SIM_H_MAX);
      off = document.createElement('canvas');
      off.width = sw;
      off.height = sh;
      octx = off.getContext('2d');
      img = octx.createImageData(sw, sh);
      data = img.data;
      // Opaque alpha for every pixel; only RGB changes per frame.
      for (let p = 3; p < data.length; p += 4) data[p] = 255;
      ensureLut(c.params.palette);
      c.ctx.imageSmoothingEnabled = true;
    },

    step(c) {
      if (!off) return; // not initialised (zero-size at init time) — bail safely
      const p = c.params, noise = c.noise;
      ensureLut(p.palette);

      const freq = p.freq;
      const warp = p.warp;
      opts.octaves = clamp(p.octaves | 0, 1, 6); // live + clamped (fbm needs >=1)
      const contrast = p.contrast;
      const inv = freq / sw;            // noise units per source px; same on both axes
      const tdrift = c.time * p.speed;  // drifts the final coordinate over time
      const d = data, L = lut;

      let idx = 0;
      for (let j = 0; j < sh; j++) {
        const fy = j * inv;
        for (let i = 0; i < sw; i++, idx += 4) {
          const fx = i * inv;

          // First warp vector q (low detail — only the final value needs full octaves).
          const qx = noise.fbm2D(fx, fy, warpOpts);
          const qy = noise.fbm2D(fx + 5.2, fy + 1.3, warpOpts);

          // Second warp vector r, displaced by warp*q.
          const wx = warp * qx, wy = warp * qy;
          const rx = noise.fbm2D(fx + wx + 1.7, fy + wy + 9.2, warpOpts);
          const ry = noise.fbm2D(fx + wx + 8.3, fy + wy + 2.8, warpOpts);

          // Final field value, drifting over time via the y coordinate.
          const v = noise.fbm2D(fx + warp * rx, fy + warp * ry + tdrift, opts);

          // [-1,1] -> [0,1], then apply contrast around the midpoint.
          let t = (v + 1) * 0.5;
          t = clamp((t - 0.5) * contrast + 0.5, 0, 1);

          const li = ((t * 255) | 0) * 3; // ramp index (0..255)*3, max 765 (< 768)
          d[idx] = L[li];
          d[idx + 1] = L[li + 1];
          d[idx + 2] = L[li + 2];
        }
      }

      octx.putImageData(img, 0, 0);
      // Blit the sim buffer across the full logical rect (handles any aspect/dpr).
      c.ctx.imageSmoothingEnabled = true;
      c.ctx.drawImage(off, 0, 0, c.width, c.height);
    },

    dispose() {
      off = octx = img = data = lut = null;
      lutName = '';
    },
  };
}

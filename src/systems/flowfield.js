// flowfield.js — particles advected through an animated simplex-noise vector
// field, leaving fading trails. This file is also the *reference* system: it
// demonstrates the full interface contract (meta, params, init, step,
// onPointer) and the house style other systems follow.

import { sampleCss } from '../engine/color.js';
import { TAU } from '../engine/mathx.js';

export default function create() {
  // Per-instance state. Allocated in init() once sizes are known.
  let px = null; // Float32Array x
  let py = null; // Float32Array y
  let life = null; // Float32Array remaining life (frames) before respawn
  let hue = null; // Float32Array per-particle palette offset [0,1)
  let count = 0;

  function spawn(c, i) {
    px[i] = c.rng.next() * c.width;
    py[i] = c.rng.next() * c.height;
    life[i] = c.rng.range(40, 220);
    hue[i] = c.rng.next();
  }

  return {
    meta: {
      id: 'flowfield',
      name: 'Flow Field',
      blurb: 'Particles drifting through an animated noise field.',
      category: 'Fields',
    },

    params: [
      { key: 'count', label: 'Particles', type: 'int', min: 200, max: 6000, step: 100, default: 2600, structural: true },
      { key: 'scale', label: 'Field scale', type: 'range', min: 0.0005, max: 0.006, step: 0.0001, default: 0.0018 },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 4, step: 0.05, default: 1.3 },
      { key: 'drift', label: 'Time drift', type: 'range', min: 0, max: 0.4, step: 0.005, default: 0.08, hint: 'How fast the field itself evolves' },
      { key: 'octaves', label: 'Detail', type: 'int', min: 1, max: 5, step: 1, default: 2 },
      { key: 'curl', label: 'Curl', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.6, hint: 'Rotate field vectors toward perpendicular flow' },
      { key: 'fade', label: 'Trail length', type: 'range', min: 0.004, max: 0.2, step: 0.002, default: 0.03, hint: 'Lower = longer trails' },
      { key: 'lineWidth', label: 'Line width', type: 'range', min: 0.4, max: 3, step: 0.1, default: 0.9 },
      { key: 'palette', label: 'Palette', type: 'select', default: 'abyss', options: [
        { value: 'abyss', label: 'Abyss' }, { value: 'ember', label: 'Ember' },
        { value: 'ice', label: 'Ice' }, { value: 'spectral', label: 'Spectral' },
        { value: 'moss', label: 'Moss' }, { value: 'cyber', label: 'Cyber' },
        { value: 'coral', label: 'Coral' }, { value: 'sand', label: 'Sand' },
      ] },
      { key: 'colorBy', label: 'Color by', type: 'select', default: 'angle', options: [
        { value: 'angle', label: 'Flow angle' }, { value: 'speed', label: 'Speed' },
        { value: 'particle', label: 'Particle' },
      ] },
    ],

    init(c) {
      count = c.params.count | 0;
      px = new Float32Array(count);
      py = new Float32Array(count);
      life = new Float32Array(count);
      hue = new Float32Array(count);
      for (let i = 0; i < count; i++) spawn(c, i);
      // Start from a clean dark frame.
      c.clear(1);
    },

    step(c) {
      const p = c.params;
      const { ctx, noise } = c;
      const w = c.width;
      const h = c.height;
      const z = c.time * p.drift;
      const sc = p.scale;
      const sp = p.speed;
      const curl = p.curl;
      const oct = p.octaves | 0;
      const fbmOpts = { octaves: oct }; // hoisted out of the loop — no per-particle alloc

      // Fade previous frame for trails.
      c.clear(p.fade);

      ctx.lineWidth = p.lineWidth;
      ctx.lineCap = 'round';

      for (let i = 0; i < count; i++) {
        const x0 = px[i];
        const y0 = py[i];
        // Field angle from animated fBm; curl rotates toward perpendicular.
        const n = noise.fbm3D(x0 * sc, y0 * sc, z, fbmOpts);
        const angle = n * TAU * 1.5 + curl * Math.PI * 0.5;
        const vx = Math.cos(angle) * sp;
        const vy = Math.sin(angle) * sp;
        const x1 = x0 + vx;
        const y1 = y0 + vy;

        let t;
        if (p.colorBy === 'angle') t = (n + 1) * 0.5;
        else if (p.colorBy === 'speed') t = Math.min(1, Math.hypot(vx, vy) / sp);
        else t = hue[i];

        ctx.strokeStyle = sampleCss(p.palette, t, 0.85);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        px[i] = x1;
        py[i] = y1;
        life[i] -= 1;

        // Respawn when off-screen or aged out.
        if (life[i] <= 0 || x1 < -2 || x1 > w + 2 || y1 < -2 || y1 > h + 2) {
          spawn(c, i);
        }
      }
    },

    onPointer(c, type) {
      // Dragging injects a swirl: nudge nearby particles outward from pointer.
      if (!c.pointer.down && type !== 'down') return;
      const { x, y } = c.pointer;
      for (let i = 0; i < count; i++) {
        const dx = px[i] - x;
        const dy = py[i] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 9000) {
          const inv = 1 / Math.sqrt(d2 + 1);
          px[i] += dx * inv * 6;
          py[i] += dy * inv * 6;
        }
      }
    },
  };
}

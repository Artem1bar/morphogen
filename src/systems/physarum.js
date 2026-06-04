// physarum.js — Physarum polycephalum transport networks (Jones, 2010).
//
// Thousands of agents wander a shared chemo-attractant field. Each samples the
// trail at three points ahead (centre/left/right), steers toward the strongest
// scent, and deposits a little trail of its own. The field diffuses (3x3 box
// blur) and decays each frame. From pure local rules, sprawling vein-like
// transport networks self-organise — the slime mould "solving" the plane.
//
// This is a fixed-grid pixel system: the trail lives in a TW x TH Float32
// buffer that is independent of canvas size. We colour it into an offscreen
// ImageData and drawImage() it (scaled) onto the dpr-transformed stage, so the
// look is identical at any window size or aspect ratio.

import { ramp } from '../engine/color.js';
import { TAU, clamp } from '../engine/mathx.js';

const TW = 500; // grid width in cells; height derived from canvas aspect (crisp when blitted)

export default function create() {
  // Fixed-size simulation state, allocated in init().
  let trail = null; // Float32Array(TW*TH) current chemo field
  let next = null; // Float32Array(TW*TH) scratch for the diffuse/decay pass
  let ax = null; // agent x in grid space [0,TW)
  let ay = null; // agent y in grid space [0,TH)
  let ah = null; // agent heading (radians)
  let agents = 0;
  let TH = 0;
  let img = null; // ImageData(TW,TH) reused every frame
  let off = null; // offscreen <canvas> we putImageData into
  let octx = null;
  let lut = null; // Uint8ClampedArray palette ramp (256*3)
  let lutName = ''; // palette the lut was built for (rebuild on change)

  // Sample the trail at a continuous (toroidal) grid coordinate via the cell.
  // Math.floor (NOT | 0) so negative sensor coords wrap correctly at the seam:
  // gx=-0.3 must land on cell TW-1, but (-0.3 | 0) === 0 would mis-map it to 0.
  function senseAt(gx, gy) {
    let x = Math.floor(gx) % TW;
    let y = Math.floor(gy) % TH;
    if (x < 0) x += TW;
    if (y < 0) y += TH;
    return trail[y * TW + x];
  }

  return {
    meta: {
      id: 'physarum',
      name: 'Physarum',
      blurb: 'Slime-mould agents sniffing out living transport networks.',
      category: 'Life',
    },

    params: [
      { key: 'agents', label: 'Agents', type: 'int', min: 2000, max: 60000, step: 1000, default: 18000, structural: true, hint: 'More agents = denser, faster-forming networks' },
      { key: 'sensorAngle', label: 'Sensor angle', type: 'range', min: 0.2, max: 1.4, step: 0.01, default: 0.6, hint: 'Spread of the left/right feelers (radians)' },
      { key: 'sensorDist', label: 'Sensor distance', type: 'range', min: 2, max: 24, step: 0.5, default: 9, hint: 'How far ahead each agent smells' },
      { key: 'turnSpeed', label: 'Turn speed', type: 'range', min: 0.1, max: 1.2, step: 0.01, default: 0.4, hint: 'Steering response (radians/step)' },
      { key: 'deposit', label: 'Deposit', type: 'range', min: 1, max: 16, step: 0.5, default: 5, hint: 'Trail strength left behind' },
      { key: 'decay', label: 'Decay', type: 'range', min: 0.80, max: 0.99, step: 0.005, default: 0.92, hint: 'Higher = trails persist longer' },
      { key: 'brightness', label: 'Brightness', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
      { key: 'palette', label: 'Palette', type: 'select', default: 'moss', options: [
        { value: 'moss', label: 'Moss' }, { value: 'ember', label: 'Ember' },
        { value: 'ice', label: 'Ice' }, { value: 'abyss', label: 'Abyss' },
        { value: 'spectral', label: 'Spectral' }, { value: 'cyber', label: 'Cyber' },
        { value: 'coral', label: 'Coral' }, { value: 'mono', label: 'Mono' },
      ] },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard against zero-size stage
      // Derive grid height from aspect; clamp so the buffer stays bounded.
      TH = clamp(Math.round(TW * (c.height / c.width)), 60, 900);
      const N = TW * TH;
      trail = new Float32Array(N);
      next = new Float32Array(N);

      agents = c.params.agents | 0;
      ax = new Float32Array(agents);
      ay = new Float32Array(agents);
      ah = new Float32Array(agents);
      for (let i = 0; i < agents; i++) {
        ax[i] = c.rng.next() * TW;
        ay[i] = c.rng.next() * TH;
        ah[i] = c.rng.next() * TAU;
      }

      // Offscreen buffer at grid resolution; drawImage scales it to the stage.
      off = document.createElement('canvas');
      off.width = TW;
      off.height = TH;
      octx = off.getContext('2d');
      img = octx.createImageData(TW, TH);
      // Opaque alpha channel once; we only rewrite RGB each frame.
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) d[i] = 255;

      lutName = c.params.palette;
      lut = ramp(lutName, 256);

      c.clear(1);
    },

    step(c) {
      if (!trail) return;
      const p = c.params;
      const sd = p.sensorDist;
      const sa = p.sensorAngle;
      const ts = p.turnSpeed;
      const dep = p.deposit;
      const decay = p.decay;

      // ---- 1) sense + steer + move + deposit ------------------------------
      for (let i = 0; i < agents; i++) {
        const x = ax[i], y = ay[i], hgt = ah[i];
        // Three feelers ahead of the agent.
        const cF = senseAt(x + Math.cos(hgt) * sd, y + Math.sin(hgt) * sd);
        const lF = senseAt(x + Math.cos(hgt - sa) * sd, y + Math.sin(hgt - sa) * sd);
        const rF = senseAt(x + Math.cos(hgt + sa) * sd, y + Math.sin(hgt + sa) * sd);

        let nh = hgt;
        if (cF >= lF && cF >= rF) {
          // straight ahead is best — keep heading
        } else if (lF > rF) {
          nh = hgt - ts;
        } else if (rF > lF) {
          nh = hgt + ts;
        } else {
          // ambiguous: pick a random turn (deterministic via seeded rng)
          nh = hgt + (c.rng.next() < 0.5 ? -ts : ts);
        }

        // Advance one cell along the new heading (speed = 1.0), wrap toroidally.
        // cos/sin in [-1,1] and x in [0,TW) => nx in (-1, TW+1): one shift wraps it.
        let nx = x + Math.cos(nh);
        let ny = y + Math.sin(nh);
        if (nx < 0) nx += TW; else if (nx >= TW) nx -= TW;
        if (ny < 0) ny += TH; else if (ny >= TH) ny -= TH;

        ax[i] = nx; ay[i] = ny; ah[i] = nh;

        // Deposit at the destination cell. Clamp the integer cell defensively so
        // a floating-point value landing exactly on TW/TH can never index out of
        // bounds (rule: step() must not throw).
        let cx = nx | 0; if (cx >= TW) cx = TW - 1;
        let cy = ny | 0; if (cy >= TH) cy = TH - 1;
        trail[cy * TW + cx] += dep;
      }

      // ---- 2) diffuse (3x3 box blur) then decay, into `next`, then swap ---
      const inv9 = 1 / 9;
      for (let y = 0; y < TH; y++) {
        const ym = (y - 1 + TH) % TH, yp = (y + 1) % TH;
        const r0 = ym * TW, r1 = y * TW, r2 = yp * TW;
        for (let x = 0; x < TW; x++) {
          const xm = x === 0 ? TW - 1 : x - 1;
          const xp = x === TW - 1 ? 0 : x + 1;
          const sum =
            trail[r0 + xm] + trail[r0 + x] + trail[r0 + xp] +
            trail[r1 + xm] + trail[r1 + x] + trail[r1 + xp] +
            trail[r2 + xm] + trail[r2 + x] + trail[r2 + xp];
          next[r1 + x] = sum * inv9 * decay;
        }
      }
      const tmp = trail; trail = next; next = tmp; // swap buffers

      // ---- 3) render trail -> palette -> ImageData -> drawImage -----------
      if (p.palette !== lutName) { lutName = p.palette; lut = ramp(lutName, 256); }
      const bright = p.brightness;
      const data = img.data;
      const N = TW * TH;
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        // Brief: t = clamp(trail * brightness, 0, 1), then palette lookup.
        let t = trail[i] * bright;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const k = ((t * 255) | 0) * 3; // 0..255 -> ramp index (lut is 256*3)
        data[j] = lut[k];
        data[j + 1] = lut[k + 1];
        data[j + 2] = lut[k + 2];
      }
      octx.putImageData(img, 0, 0);
      // drawImage respects the dpr transform; scale grid -> full logical rect.
      // Smooth the upscale so thin veins read as soft filaments, not blocky cells.
      c.ctx.imageSmoothingEnabled = true;
      c.ctx.drawImage(off, 0, 0, c.width, c.height);
    },

    onPointer(c, type) {
      // While dragging, stamp a soft blob of trail at the pointer so the user
      // can seed new colonies and watch networks rewire toward them.
      // (!trail guard also covers the zero-size stage, where width/height are 0.)
      if (!trail || (!c.pointer.down && type !== 'down')) return;
      const gx = Math.floor((c.pointer.x / c.width) * TW);
      const gy = Math.floor((c.pointer.y / c.height) * TH);
      const R = 6;
      const amp = c.params.deposit * 8;
      const r2 = R * R;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          // Math.floor-based wrap (handles negative gx+dx at the seam correctly).
          let x = (gx + dx) % TW; if (x < 0) x += TW;
          let y = (gy + dy) % TH; if (y < 0) y += TH;
          trail[y * TW + x] += amp * (1 - d2 / r2);
        }
      }
    },
  };
}

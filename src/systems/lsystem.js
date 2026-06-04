// lsystem.js — L-system turtle graphics grown into plants and fractals.
//
// A rewriting grammar (axiom + production rules) is expanded `iterations`
// times, then a turtle walks the resulting string emitting line segments:
//   F or G  draw forward      +  turn right      -  turn left
//   [        push state        ]  pop state
// We do ONE build walk that both records every segment {x1,y1,x2,y2,depth}
// (with deterministic per-branch noise jitter baked in) and tracks the bounding
// box, then fit that box into the logical rect with a ~10% margin. Growth is
// animated by drawing `drawSpeed` segments per frame onto a persistent offscreen
// canvas (never cleared) which step() blits with drawImage. Bracket depth drives
// both color (palette t) and a line-width taper, so trunks read heavy and dark
// while twigs taper to bright tips.
//
// Param liveness: `preset`/`iterations` are structural (engine re-runs init()).
// `angle`/`jitter` are NOT structural but DO change geometry, so step() watches
// them (plus the seed) and rebuilds the segments + repaints the offscreen the
// moment they change — that keeps the live controls honest without paying the
// expand/walk cost on frames where nothing relevant moved.

import { sample, rgba } from '../engine/color.js';
import { clamp, lerp } from '../engine/mathx.js';

const MAX_LEN = 250000; // hard cap on the expanded string length
const COLOR_STEPS = 96; // precomputed CSS-string ramp resolution (no per-seg alloc)
const STROKE_ALPHA = 0.92;

// preset → { axiom, rules, angle (degrees) }. G is also a draw-forward symbol.
const PRESETS = {
  plant: { axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25 },
  bush: { axiom: 'F', rules: { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: 22 },
  dragon: { axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90 },
  koch: { axiom: 'F', rules: { F: 'F+F-F-F+F' }, angle: 90 },
  sierpinski: { axiom: 'F-G-G', rules: { F: 'F-G+F+G-F', G: 'GG' }, angle: 120 },
};

/** Expand `axiom` under `rules` for `iters` passes, capped at MAX_LEN chars. */
function expand(axiom, rules, iters) {
  let s = axiom;
  for (let n = 0; n < iters; n++) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      out += rules[ch] !== undefined ? rules[ch] : ch;
      if (out.length > MAX_LEN) return out.slice(0, MAX_LEN); // stop early
    }
    s = out;
    if (s.length >= MAX_LEN) break;
  }
  return s;
}

export default function create() {
  let off = null; // offscreen canvas (device-pixel sized, dpr transform applied)
  let octx = null;
  let segs = null; // Float32Array packed [x1,y1,x2,y2] * count, fitted to rect
  let depths = null; // Uint16Array bracket depth per segment
  let count = 0; // total segment count
  let maxDepth = 1; // deepest bracket depth (for color/width normalization)
  let drawn = 0; // segments committed to the offscreen so far
  let colorLut = null; // COLOR_STEPS prebuilt "rgba(...)" strings, indexed by t
  let lutPalette = ''; // palette the colorLut was built for
  // Signature of the geometry currently baked into `segs`. step() rebuilds when
  // any of these change (preset/iterations come via structural init too, but
  // including them keeps the guard self-contained and cheap).
  let geomSig = '';

  function geometrySignature(c) {
    const p = c.params;
    return `${p.preset}|${p.iterations | 0}|${p.angle}|${p.jitter}|${c.seed}`;
  }

  // (Re)build the offscreen canvas to match the current device-pixel size and
  // paint it with the background. Resets the committed-segment cursor so growth
  // replays from the trunk. Returns false if the stage has no size yet.
  function buildOffscreen(c) {
    if (c.width <= 0 || c.height <= 0) return false;
    off = document.createElement('canvas');
    off.width = c.pixelWidth;
    off.height = c.pixelHeight;
    octx = off.getContext('2d');
    // Draw in logical coords: device-pixel canvas + dpr scale = crisp 1:1 blit.
    octx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    octx.fillStyle = c.background; // seed the dark stage so growth sits on it
    octx.fillRect(0, 0, c.width, c.height);
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    drawn = 0;
    return true;
  }

  // Repaint the offscreen background without reallocating the canvas (used when
  // geometry changes but the size did not — restart growth on the same buffer).
  function clearOffscreen(c) {
    if (!octx) return;
    octx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    octx.fillStyle = c.background;
    octx.fillRect(0, 0, c.width, c.height);
    drawn = 0;
  }

  // Expand the grammar, walk the turtle to record raw segments + bbox, then fit
  // the bbox into the logical rect with a ~10% margin (aspect-preserving).
  function buildGeometry(c) {
    const w = c.width;
    const h = c.height;
    const p = c.params;
    if (w <= 0 || h <= 0) return; // guard zero-size init

    const preset = PRESETS[p.preset] || PRESETS.plant;
    const str = expand(preset.axiom, preset.rules, p.iterations | 0);

    // First sweep: count draw segments so we can size typed arrays exactly.
    let nSeg = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === 'F' || ch === 'G') nSeg++;
    }
    count = nSeg;
    maxDepth = 1;
    segs = new Float32Array(Math.max(1, nSeg) * 4);
    depths = new Uint16Array(Math.max(1, nSeg));
    geomSig = geometrySignature(c);
    if (nSeg === 0) return;

    // Build sweep: turtle in arbitrary units, recording raw segments + bbox.
    const base = (clamp(p.angle, 1, 179) * Math.PI) / 180; // turn (deg → rad)
    const jit = clamp(p.jitter, 0, 1);
    const stack = []; // flattened [x, y, angle, depth] quads
    let x = 0;
    let y = 0;
    let ang = -Math.PI / 2; // grow upward
    let depth = 0;
    let si = 0;
    // Seed the bbox with the turtle origin (0,0). Below we only fold in segment
    // ENDPOINTS; every branch-start is a previously-stacked endpoint, so the one
    // point that would otherwise be missed is the very first start at (0,0) —
    // the base of the trunk. Including it keeps the fit centred and unclipped.
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === 'F' || ch === 'G') {
        const nx = x + Math.cos(ang);
        const ny = y + Math.sin(ang);
        const o = si * 4;
        segs[o] = x;
        segs[o + 1] = y;
        segs[o + 2] = nx;
        segs[o + 3] = ny;
        depths[si] = depth;
        if (depth > maxDepth) maxDepth = depth;
        si++;
        x = nx;
        y = ny;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else if (ch === '+' || ch === '-') {
        // Per-branch organic jitter from seeded noise (deterministic).
        const wobble = jit > 0 ? c.noise.noise2D(si * 0.21, depth * 1.7) * jit : 0;
        ang += (ch === '+' ? 1 : -1) * (base + wobble);
      } else if (ch === '[') {
        stack.push(x, y, ang, depth);
        depth++;
      } else if (ch === ']' && stack.length >= 4) {
        // Guard the pop: a string truncated at MAX_LEN can be unbalanced, and
        // popping an empty stack would poison every later coord with NaN.
        depth = stack.pop();
        ang = stack.pop();
        y = stack.pop();
        x = stack.pop();
      }
    }

    // Fit the bbox into the logical rect with ~10% margin, preserving aspect.
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const margin = 0.1;
    const scale = Math.min(
      (w * (1 - 2 * margin)) / spanX,
      (h * (1 - 2 * margin)) / spanY,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Map model point → logical pixel, centered in the stage.
    for (let i = 0; i < si; i++) {
      const o = i * 4;
      segs[o] = (segs[o] - cx) * scale + w / 2;
      segs[o + 1] = (segs[o + 1] - cy) * scale + h / 2;
      segs[o + 2] = (segs[o + 2] - cx) * scale + w / 2;
      segs[o + 3] = (segs[o + 3] - cy) * scale + h / 2;
    }
  }

  // Precompute a small ramp of "rgba(...)" strings so the per-segment draw loop
  // never allocates a color string (sampleCss would, on every segment).
  function ensureColorLut(palette) {
    if (palette === lutPalette && colorLut) return;
    colorLut = new Array(COLOR_STEPS);
    for (let i = 0; i < COLOR_STEPS; i++) {
      const t = i / (COLOR_STEPS - 1);
      const [r, g, b] = sample(palette, 0.18 + t * 0.78);
      colorLut[i] = rgba(r, g, b, STROKE_ALPHA);
    }
    lutPalette = palette;
  }

  // Commit up to `n` more segments to the offscreen (without clearing it).
  function drawBatch(c, n) {
    if (!octx || count === 0 || drawn >= count) return;
    ensureColorLut(c.params.palette);
    const end = Math.min(count, drawn + n);
    const invD = 1 / maxDepth;
    const invN = 1 / count;
    // Branching forms (deep stacks) color by depth; bracket-free curves
    // (Koch, Dragon, Sierpinski) have ~no depth variation, so blend in path
    // progress to give them a gradient instead of one flat hue.
    const depthMix = clamp((maxDepth - 1) / 4, 0, 1);
    const lutMax = COLOR_STEPS - 1;
    const lut = colorLut;
    for (let i = drawn; i < end; i++) {
      const o = i * 4;
      const dt = clamp(depths[i] * invD, 0, 1);
      const pt = i * invN; // progress along the emission order
      const t = lerp(pt, dt, depthMix);
      // Deeper branches: brighter palette stop + thinner stroke (taper).
      octx.strokeStyle = lut[(t * lutMax + 0.5) | 0];
      octx.lineWidth = lerp(2.6, 0.6, dt);
      octx.beginPath();
      octx.moveTo(segs[o], segs[o + 1]);
      octx.lineTo(segs[o + 2], segs[o + 3]);
      octx.stroke();
    }
    drawn = end;
  }

  return {
    meta: {
      id: 'lsystem',
      name: 'L-System Botany',
      blurb: 'Rewriting grammars unfurling into procedural plants and fractals.',
      category: 'Growth',
    },

    params: [
      { key: 'preset', label: 'Form', type: 'select', default: 'plant', structural: true, options: [
        { value: 'plant', label: 'Plant' }, { value: 'bush', label: 'Bush' },
        { value: 'dragon', label: 'Dragon Curve' }, { value: 'koch', label: 'Koch Island' },
        { value: 'sierpinski', label: 'Sierpinski' },
      ] },
      { key: 'iterations', label: 'Generations', type: 'int', min: 1, max: 7, step: 1, default: 5, structural: true, hint: 'Rewrite passes — higher is denser' },
      { key: 'angle', label: 'Branch angle', type: 'range', min: 5, max: 120, step: 1, default: 25, hint: 'Degrees per turn' },
      { key: 'jitter', label: 'Wobble', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.12, hint: 'Organic per-branch angle variation' },
      { key: 'drawSpeed', label: 'Growth rate', type: 'int', min: 20, max: 4000, step: 20, default: 600, hint: 'Segments drawn per frame' },
      { key: 'palette', label: 'Palette', type: 'select', default: 'moss', options: [
        { value: 'moss', label: 'Moss' }, { value: 'ember', label: 'Ember' },
        { value: 'spectral', label: 'Spectral' }, { value: 'coral', label: 'Coral' },
        { value: 'sand', label: 'Sand' }, { value: 'ice', label: 'Ice' },
        { value: 'dusk', label: 'Dusk' }, { value: 'cyber', label: 'Cyber' },
      ] },
    ],

    init(c) {
      // Structural rebuild: fresh offscreen + fresh geometry, growth from zero.
      if (!buildOffscreen(c)) return; // zero-size stage; step() retries later
      buildGeometry(c);
      ensureColorLut(c.params.palette);
      c.clear(1);
    },

    step(c) {
      // Guard: if init bailed on a zero-size stage, build once we have a size.
      if (!off && c.width > 0 && c.height > 0) {
        if (buildOffscreen(c)) buildGeometry(c);
      }
      if (!off) return;

      // Recover from a stage resize that left the offscreen the wrong size.
      if (off.width !== c.pixelWidth || off.height !== c.pixelHeight) {
        buildOffscreen(c);
        buildGeometry(c);
      }

      // Live non-structural geometry params (angle/jitter) or a seed change:
      // rebuild the segments and replay growth on the existing offscreen.
      if (geomSig !== geometrySignature(c)) {
        buildGeometry(c);
        clearOffscreen(c);
      }

      // Grow: commit the next batch, then blit the whole offscreen.
      if (drawn < count) drawBatch(c, Math.max(1, c.params.drawSpeed | 0));
      c.clear(1);
      c.ctx.drawImage(off, 0, 0, c.width, c.height);
    },

    onPointer(c, type) {
      // Tap to instantly grow the rest of the plant.
      if (type === 'down') drawBatch(c, count);
    },

    dispose() {
      off = null;
      octx = null;
      segs = null;
      depths = null;
      colorLut = null;
      lutPalette = '';
      geomSig = '';
    },
  };
}

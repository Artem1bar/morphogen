// wavefunctioncollapse.js — tiled Wave Function Collapse with edge-socket
// matching. Cells hold a bitmask of still-possible tile ids; each "observation"
// collapses the lowest-entropy cell (weighted random) then propagates socket
// constraints to neighbours until the wave is consistent again. On any
// contradiction — or once the whole grid is decided — we reseed and start over,
// so the field keeps weaving fresh tilings forever.
//
// Edges are indexed N=0, E=1, S=2, W=3. A socket is 1 if a path crosses that
// edge's midpoint, else 0; two cells may sit side by side only if their facing
// edge sockets match. Truchet arcs (all sockets 1) always fit, so there we bias
// collapse weights toward continuing a neighbour's arc into long loops. The
// "pipes" set adds blanks and straights for genuine constraint propagation.
//
// This is a VECTOR system: tiles are stroked directly onto c.ctx in logical
// pixels (no ImageData/offscreen needed — that pattern is only for pixel grids).

import { sampleCss } from '../engine/color.js';
import { TAU, PI, HALF_PI } from '../engine/mathx.js';

// A tile = { sockets:[N,E,S,W], draw(ctx,x,y,s), w }. `s` is the cell size in px.
// Each quarter-arc is its OWN subpath (beginPath + arc + stroke). Drawing two
// arcs in a single subpath would make canvas connect them with a stray chord.
function arcA(ctx, x, y, s) {
  const r = s * 0.5;
  // N-W: quarter circle centred on the NW corner (N-mid → W-mid).
  ctx.beginPath();
  ctx.arc(x, y, r, 0, HALF_PI);
  ctx.stroke();
  // S-E: quarter circle centred on the SE corner (S-mid → E-mid).
  ctx.beginPath();
  ctx.arc(x + s, y + s, r, PI, PI + HALF_PI);
  ctx.stroke();
}
function arcB(ctx, x, y, s) {
  const r = s * 0.5;
  // N-E: centred on the NE corner (E-mid → N-mid).
  ctx.beginPath();
  ctx.arc(x + s, y, r, HALF_PI, PI);
  ctx.stroke();
  // S-W: centred on the SW corner (W-mid → S-mid).
  ctx.beginPath();
  ctx.arc(x, y + s, r, PI + HALF_PI, TAU);
  ctx.stroke();
}
function straightH(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.5);
  ctx.lineTo(x + s, y + s * 0.5);
  ctx.stroke();
}
function straightV(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y);
  ctx.lineTo(x + s * 0.5, y + s);
  ctx.stroke();
}
function blank() { /* draws nothing */ }

const TILESETS = {
  truchet: [
    { sockets: [1, 1, 1, 1], draw: arcA, w: 1 },
    { sockets: [1, 1, 1, 1], draw: arcB, w: 1 },
  ],
  pipes: [
    { sockets: [0, 0, 0, 0], draw: blank, w: 1.4 },
    { sockets: [0, 1, 0, 1], draw: straightH, w: 1 },
    { sockets: [1, 0, 1, 0], draw: straightV, w: 1 },
    { sockets: [1, 1, 1, 1], draw: arcA, w: 1.2 },
    { sockets: [1, 1, 1, 1], draw: arcB, w: 1.2 },
  ],
};

const OPP = [2, 3, 0, 1];      // facing edge for N,E,S,W
const DX = [0, 1, 0, -1];      // neighbour delta x for each edge dir
const DY = [-1, 0, 1, 0];      // neighbour delta y
const HOLD_FRAMES = 150;       // frames to admire a finished weave before reseeding

export default function create() {
  let GW = 0, GH = 0, cell = 0;            // grid dims & cell size in px
  let originX = 0, originY = 0;            // top-left to centre the grid
  let tiles = null, full = 0;             // active tileset & all-bits mask
  let permit = null;                      // permit[t*4+e] = neighbour tiles ok
  let masks = null, hue = null;           // Int32 bitmask + per-cell base hue
  let work = null, workCap = 0;           // preallocated propagation ring queue
  let inQueue = null;                     // dedup flag so each cell queues once
  let optIds = null, optW = null;         // preallocated weighted-collapse scratch
  let activeSet = 'truchet';
  let cycle = 0;                          // increments each reset (hue variety)
  let solved = false;                     // grid fully collapsed?
  let holdTimer = 0;                      // frames left to hold a finished weave

  function popcount(m) { let n = 0; while (m) { m &= m - 1; n++; } return n; }

  // Precompute, for tile `t` across edge `e`, the bitmask of neighbour tiles
  // whose facing socket matches — the only constraint WFC needs at runtime.
  function buildPermit() {
    permit = new Int32Array(tiles.length * 4);
    for (let t = 0; t < tiles.length; t++) {
      for (let e = 0; e < 4; e++) {
        let allow = 0;
        const sv = tiles[t].sockets[e], face = OPP[e];
        for (let n = 0; n < tiles.length; n++) {
          if (tiles[n].sockets[face] === sv) allow |= (1 << n);
        }
        permit[t * 4 + e] = allow;
      }
    }
  }

  // Reset the whole grid to a fresh superposition and reseed colours.
  function reset(c) {
    activeSet = TILESETS[c.params.tileset] ? c.params.tileset : 'truchet';
    tiles = TILESETS[activeSet];
    full = (1 << tiles.length) - 1;
    buildPermit();
    cycle++;
    solved = false;
    holdTimer = 0;
    const total = GW * GH;
    // A contradiction can leave stale inQueue flags from the aborted propagate;
    // clear them so the next weave starts from a clean queue.
    if (inQueue) inQueue.fill(0);
    // Rotate the hue field slightly each cycle so successive weaves recolour
    // (deterministic — derived from the reset counter, never from wall time).
    const hShift = (cycle * 0.137) % 1;
    for (let i = 0; i < total; i++) {
      masks[i] = full;
      const gx = i % GW, gy = (i / GW) | 0;
      const n = c.noise.fbm2D(gx * 0.16, gy * 0.16, { octaves: 3 }); // ~[-1,1]
      const h = (n + 1) * 0.5 + hShift;
      hue[i] = h - Math.floor(h);            // wrap into [0,1)
    }
  }

  // Propagate constraints outward from the just-collapsed cell until stable.
  // Returns false on contradiction (some cell emptied). `work` is used as a
  // RING queue and `inQueue` dedups, so a cell is queued at most once at a time:
  // the live queue can never exceed the cell count, so it cannot overflow and
  // silently drop a constraint (which an earlier bounded-stack version could).
  function propagate(start) {
    const cap = workCap;
    let head = 0, tail = 0;
    work[tail] = start; tail = (tail + 1) % cap; inQueue[start] = 1;
    while (head !== tail) {
      const ci = work[head]; head = (head + 1) % cap; inQueue[ci] = 0;
      const cx = ci % GW, cy = (ci / GW) | 0;
      const m = masks[ci];
      for (let e = 0; e < 4; e++) {
        const nx = cx + DX[e], ny = cy + DY[e];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const ni = ny * GW + nx;
        // Union of neighbour tiles permitted by ANY remaining option of `ci`.
        let allow = 0, mm = m, idx = 0;
        while (mm) {
          if (mm & 1) allow |= permit[idx * 4 + e];
          mm >>= 1; idx++;
        }
        const before = masks[ni];
        const after = before & allow;
        if (after !== before) {
          masks[ni] = after;
          if (after === 0) return false;           // contradiction
          if (!inQueue[ni]) { inQueue[ni] = 1; work[tail] = ni; tail = (tail + 1) % cap; }
        }
      }
    }
    return true;
  }

  // One observation: collapse the lowest-entropy undecided cell, then propagate.
  // Returns 'done' (all decided), 'contra' (restart needed), or 'ok'.
  function observe(c) {
    const total = GW * GH;
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < total; i++) {
      const m = masks[i];
      // Skip decided (single bit) and — defensively — empty cells.
      if (m === 0 || (m & (m - 1)) === 0) continue;
      const n = popcount(m);
      // Tiny deterministic jitter breaks ties via the seeded rng.
      const score = n + c.rng.next() * 0.5;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return 'done';

    // Weighted random collapse. Bias toward options matching already-decided
    // neighbours so arcs chain into long continuous loops.
    const m = masks[best];
    const bx = best % GW, by = (best / GW) | 0;
    let nOpts = 0, totW = 0;
    for (let t = 0; t < tiles.length; t++) {
      if (!(m & (1 << t))) continue;
      let w = tiles[t].w;
      for (let e = 0; e < 4; e++) {
        const nx = bx + DX[e], ny = by + DY[e];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const nm = masks[ny * GW + nx];
        if (nm === 0 || (nm & (nm - 1)) !== 0) continue; // only decided neighbours
        const nt = 31 - Math.clz32(nm);
        if (tiles[nt].sockets[OPP[e]] === tiles[t].sockets[e]) w *= 2.2; // continuity bonus
      }
      optIds[nOpts] = t; optW[nOpts] = w; totW += w; nOpts++;
    }
    // totW >= 1 here (at least one option, each weight >= 1) — no divide-by-zero.
    let r = c.rng.next() * totW, chosen = optIds[0];
    for (let k = 0; k < nOpts; k++) {
      r -= optW[k];
      if (r <= 0) { chosen = optIds[k]; break; }
    }
    masks[best] = (1 << chosen);
    return propagate(best) ? 'ok' : 'contra';
  }

  function drawCell(ctx, p, i) {
    const m = masks[i];
    if (m === 0 || (m & (m - 1)) !== 0) return;      // undecided/empty → leave dark
    const t = 31 - Math.clz32(m);
    const gx = i % GW, gy = (i / GW) | 0;
    const x = originX + gx * cell, y = originY + gy * cell;
    ctx.strokeStyle = sampleCss(p.palette, hue[i], 0.95);
    tiles[t].draw(ctx, x, y, cell);
  }

  return {
    meta: {
      id: 'wavefunctioncollapse',
      name: 'Wave Function Collapse',
      blurb: 'Constraint-solved tiles weaving themselves into endless looping mazes.',
      category: 'Tiles',
    },

    params: [
      { key: 'tileset', label: 'Tileset', type: 'select', default: 'truchet', options: [
        { value: 'truchet', label: 'Truchet arcs' }, { value: 'pipes', label: 'Pipes' },
      ], hint: 'Truchet always connects; pipes add blanks & straights', structural: true },
      { key: 'cellsAcross', label: 'Cells across', type: 'int', min: 8, max: 40, step: 1, default: 20, structural: true },
      { key: 'speed', label: 'Observations / frame', type: 'int', min: 1, max: 30, step: 1, default: 6 },
      { key: 'palette', label: 'Palette', type: 'select', default: 'dusk', options: [
        { value: 'dusk', label: 'Dusk' }, { value: 'abyss', label: 'Abyss' },
        { value: 'spectral', label: 'Spectral' }, { value: 'ember', label: 'Ember' },
        { value: 'ice', label: 'Ice' }, { value: 'moss', label: 'Moss' },
        { value: 'cyber', label: 'Cyber' }, { value: 'coral', label: 'Coral' },
      ] },
    ],

    init(c) {
      if (!c.width || !c.height) return;             // guard 0-size at startup
      const across = Math.max(1, c.params.cellsAcross | 0);
      cell = Math.max(4, Math.floor(Math.min(c.width, c.height) / across));
      GW = Math.max(1, Math.floor(c.width / cell));
      GH = Math.max(1, Math.floor(c.height / cell));
      // Centre the grid in the (possibly non-square) stage.
      originX = (c.width - GW * cell) * 0.5;
      originY = (c.height - GH * cell) * 0.5;
      const total = GW * GH;
      masks = new Int32Array(total);
      hue = new Float32Array(total);
      // Ring queue for propagation. inQueue dedups so at most `total` cells are
      // ever queued at once; sizing the ring well above that guarantees the head
      // is never lapped, so no constraint is dropped and step() never allocates.
      workCap = total + 16;
      work = new Int32Array(workCap);
      inQueue = new Uint8Array(total);
      // Scratch for the largest possible option list (one entry per tile).
      let maxTiles = 1;
      for (const k in TILESETS) maxTiles = Math.max(maxTiles, TILESETS[k].length);
      optIds = new Int32Array(maxTiles);
      optW = new Float64Array(maxTiles);
      cycle = 0;
      reset(c);
    },

    step(c) {
      if (!masks || !GW || !GH) return;
      const p = c.params, ctx = c.ctx;
      const speed = Math.max(1, p.speed | 0);

      // Advance the solver, then HOLD the finished weave for a beat before
      // reseeding. Without this the grid resets the instant its last cell
      // collapses, so the completed (fully-connected) tiling is never seen and
      // the field looks perpetually sparse.
      if (solved) {
        if (--holdTimer <= 0) reset(c);
      } else {
        for (let s = 0; s < speed; s++) {
          const r = observe(c);
          if (r === 'done') { solved = true; holdTimer = HOLD_FRAMES; break; }
          if (r === 'contra') { reset(c); break; }
        }
      }

      // Repaint: clean dark frame, then every decided cell's tile art.
      c.clear(1);
      ctx.lineWidth = Math.max(1, cell * 0.16);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const total = GW * GH;
      for (let i = 0; i < total; i++) drawCell(ctx, p, i);
    },

    onPointer(c, type) {
      // Click anywhere to start a fresh weave.
      if (type === 'down' && masks) reset(c);
    },
  };
}

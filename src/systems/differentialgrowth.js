// differentialgrowth.js — a closed curve that grows by accumulating length.
// Each node is pulled toward the midpoint of its ring-neighbours (keeps spacing
// even) and pushed away from any node within `repelRadius` (found through a
// uniform spatial-hash grid so the per-frame cost stays ~O(N) not O(N²)). When
// a segment stretches past `splitDist` a new node is inserted at its midpoint,
// so the ring lengthens and is forced to buckle and fold — the brain-coral look.
//
// Topology is a DOUBLY-linked ring (nextIdx/prevIdx) over fixed-size typed
// arrays sized to maxNodes, with a free-list for recycled slots. The back-links
// give O(1) mid-ring insertion and let both the force pass and the renderer read
// each node's two neighbours without any per-frame ring walk. Positions are
// double-buffered so every node steers off the same snapshot, and every buffer
// is allocated once in init() so step() does no allocation in its hot loops.

import { sampleCss } from '../engine/color.js';
import { TAU } from '../engine/mathx.js';

export default function create() {
  // Node storage (indices into these are stable until a slot is freed).
  let nx = null, ny = null;     // current positions
  let bx = null, by = null;     // next positions (double buffer)
  let nextIdx = null;           // ring successor of each live node
  let prevIdx = null;           // ring predecessor of each live node
  let free = null;              // stack of free slot indices
  let freeTop = 0;              // free-stack pointer
  let head = 0;                 // any live node — entry into the ring
  let count = 0;                // live node count
  let cap = 0;                  // == maxNodes

  // Spatial-hash scratch (intrusive per-cell linked lists), sized once for the
  // worst case so the per-frame build never allocates.
  let cellHead = null;          // first node index in each cell, -1 if empty
  let cellNext = null;          // next-in-cell list over node slots
  let gridCap = 0;

  const PAL = [
    { value: 'coral', label: 'Coral' }, { value: 'ember', label: 'Ember' },
    { value: 'ice', label: 'Ice' }, { value: 'moss', label: 'Moss' },
    { value: 'spectral', label: 'Spectral' }, { value: 'cyber', label: 'Cyber' },
    { value: 'dusk', label: 'Dusk' }, { value: 'sand', label: 'Sand' },
    { value: 'abyss', label: 'Abyss' }, { value: 'mono', label: 'Mono' },
  ];

  // Pull one slot from the free list (caller guarantees count < cap).
  function alloc() { return free[--freeTop]; }

  // Seed a small jittered circle of `n` nodes, wired into a closed ring.
  function seedRing(c, n) {
    const cxp = c.width * 0.5, cyp = c.height * 0.5;
    const r = Math.min(c.width, c.height) * 0.08;
    freeTop = cap;                       // all slots free, top → bottom
    for (let i = 0; i < cap; i++) free[i] = cap - 1 - i;
    count = 0;
    let prev = -1;
    head = -1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const s = alloc();
      nx[s] = cxp + Math.cos(a) * r + c.rng.range(-1, 1);
      ny[s] = cyp + Math.sin(a) * r + c.rng.range(-1, 1);
      if (prev === -1) head = s;
      else { nextIdx[prev] = s; prevIdx[s] = prev; }
      prev = s;
      count++;
    }
    nextIdx[prev] = head;                // close the loop (forward …
    prevIdx[head] = prev;                // … and backward)
  }

  return {
    meta: {
      id: 'differentialgrowth',
      name: 'Differential Growth',
      blurb: 'A closed thread that crowds, buckles, and folds into coral.',
      category: 'Growth',
    },

    params: [
      { key: 'repelRadius', label: 'Repel radius', type: 'range', min: 8, max: 40, step: 1, default: 18, hint: 'How far nodes push each other apart (px)' },
      { key: 'attraction', label: 'Attraction', type: 'range', min: 0, max: 2, step: 0.05, default: 0.9, hint: 'Pull toward neighbour midpoint — evens spacing' },
      { key: 'repulsion', label: 'Repulsion', type: 'range', min: 0, max: 2, step: 0.05, default: 1.1, hint: 'Crowding force that drives the folding' },
      { key: 'splitDist', label: 'Split distance', type: 'range', min: 6, max: 22, step: 1, default: 11, hint: 'Insert a node when a segment exceeds this' },
      { key: 'noiseW', label: 'Wobble', type: 'range', min: 0, max: 1.2, step: 0.02, default: 0.35, hint: 'Organic noise nudge' },
      { key: 'rate', label: 'Growth rate', type: 'range', min: 0.2, max: 2, step: 0.05, default: 1, hint: 'Overall step size per frame' },
      { key: 'maxNodes', label: 'Max nodes', type: 'int', min: 400, max: 3500, step: 100, default: 1800, structural: true, hint: 'Ring stops growing here' },
      { key: 'lineWidth', label: 'Line width', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.1 },
      { key: 'pointer', label: 'Pointer', type: 'select', default: 'attract', options: [
        { value: 'attract', label: 'Attract toward cursor' }, { value: 'off', label: 'Ignore cursor' } ] },
      { key: 'palette', label: 'Palette', type: 'select', default: 'coral', options: PAL },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard zero-size stage
      cap = Math.max(8, c.params.maxNodes | 0);
      nx = new Float32Array(cap); ny = new Float32Array(cap);
      bx = new Float32Array(cap); by = new Float32Array(cap);
      nextIdx = new Int32Array(cap);
      prevIdx = new Int32Array(cap);
      free = new Int32Array(cap);

      // Grid sized for the worst case: smallest repel radius on this stage,
      // generously padded so a live resize can never overflow the buckets.
      const minCell = 8;
      const cols = Math.ceil(c.width / minCell) + 2;
      const rows = Math.ceil(c.height / minCell) + 2;
      gridCap = cols * rows;
      cellHead = new Int32Array(gridCap);
      cellNext = new Int32Array(cap);

      seedRing(c, Math.min(70, cap));
      c.clear(1); // clean opening frame
    },

    step(c) {
      if (!nx || !c.width || !c.height || count < 3) return;
      const p = c.params, ctx = c.ctx, noise = c.noise;
      const w = c.width, h = c.height;
      const rate = p.rate;
      const attW = p.attraction, repW = p.repulsion, noiseW = p.noiseW;
      const repelR = Math.max(1e-3, p.repelRadius), repelR2 = repelR * repelR;

      // Choose a cell size ≈ repel radius, never so small the grid overflows.
      let cell = repelR;
      let cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
      while ((cols + 2) * (rows + 2) > gridCap && cell < Math.max(w, h)) {
        cell += 2; cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
      }
      const nCells = cols * rows;
      const lastCol = cols - 1, lastRow = rows - 1;

      // ---- Build spatial hash: intrusive per-cell linked lists (no alloc) ----
      cellHead.fill(-1, 0, nCells);
      let node = head;
      for (let i = 0; i < count; i++) {
        let cx = (nx[node] / cell) | 0; if (cx < 0) cx = 0; else if (cx > lastCol) cx = lastCol;
        let cy = (ny[node] / cell) | 0; if (cy < 0) cy = 0; else if (cy > lastRow) cy = lastRow;
        const cI = cy * cols + cx;
        cellNext[node] = cellHead[cI];
        cellHead[cI] = node;
        node = nextIdx[node];
      }

      // ---- Force pass: write new positions into the b-buffer ----
      const nt = c.time * 0.12;              // noise time drift
      const ptrOn = p.pointer === 'attract' && c.pointer.down;
      const ptrX = c.pointer.x, ptrY = c.pointer.y;
      node = head;
      for (let i = 0; i < count; i++) {
        const next = nextIdx[node];
        const prev = prevIdx[node];          // O(1) thanks to the back-links
        const x = nx[node], y = ny[node];

        // Attraction: toward midpoint of the two path-neighbours.
        const mx = (nx[prev] + nx[next]) * 0.5;
        const my = (ny[prev] + ny[next]) * 0.5;
        let fx = (mx - x) * attW;
        let fy = (my - y) * attW;

        // Repulsion: sum direction-weighted pushes from other nodes in the 3×3
        // cell block, with a linear falloff to zero at repelRadius.
        let cx = (x / cell) | 0; if (cx < 0) cx = 0; else if (cx > lastCol) cx = lastCol;
        let cy = (y / cell) | 0; if (cy < 0) cy = 0; else if (cy > lastRow) cy = lastRow;
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy > lastRow) continue;
          const rowBase = gy * cols;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx > lastCol) continue;
            let j = cellHead[rowBase + gx];
            while (j !== -1) {
              if (j !== node) {
                const dx = x - nx[j], dy = y - ny[j];
                const d2 = dx * dx + dy * dy;
                if (d2 > 0 && d2 < repelR2) {
                  const d = Math.sqrt(d2);
                  const f = (1 - d / repelR) / d * repW; // d > 0 → no div-by-zero
                  fx += dx * f; fy += dy * f;
                }
              }
              j = cellNext[j];
            }
          }
        }

        // Organic wobble from a slowly drifting noise field.
        if (noiseW !== 0) {
          const a = noise.noise3D(x * 0.01, y * 0.01, nt) * TAU;
          fx += Math.cos(a) * noiseW;
          fy += Math.sin(a) * noiseW;
        }

        // Optional pointer attraction (gentle, falls off with distance).
        if (ptrOn) {
          const dx = ptrX - x, dy = ptrY - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1) { const inv = 1 / Math.sqrt(d2); fx += dx * inv * 1.4; fy += dy * inv * 1.4; }
        }

        // Integrate; clamp inside the stage so the curve never escapes.
        let X = x + fx * rate, Y = y + fy * rate;
        if (X < 1) X = 1; else if (X > w - 1) X = w - 1;
        if (Y < 1) Y = 1; else if (Y > h - 1) Y = h - 1;
        bx[node] = X; by[node] = Y;

        node = next;
      }

      // Commit positions (single sweep over the ring).
      node = head;
      for (let i = 0; i < count; i++) { nx[node] = bx[node]; ny[node] = by[node]; node = nextIdx[node]; }

      // ---- Growth: insert a midpoint into any over-stretched segment ----
      if (count < cap) {
        const split2 = p.splitDist * p.splitDist;
        node = head;
        const startCount = count;
        // Walk exactly the nodes that existed at frame start; the fresh midpoint
        // is skipped this frame (we advance straight to `next`).
        for (let i = 0; i < startCount && count < cap; i++) {
          const next = nextIdx[node];
          const dx = nx[next] - nx[node], dy = ny[next] - ny[node];
          if (dx * dx + dy * dy > split2) {
            const s = alloc();
            nx[s] = (nx[node] + nx[next]) * 0.5;
            ny[s] = (ny[node] + ny[next]) * 0.5;
            // Splice s between node and next (keep both link directions intact).
            nextIdx[node] = s; prevIdx[s] = node;
            nextIdx[s] = next; prevIdx[next] = s;
            count++;
          }
          node = next;          // either way, continue past the original segment
        }
      }

      // ---- Render: clean frame, then the closed curve with midpoint smoothing.
      // Each segment is a quadratic from the midpoint of (prev,node) to the
      // midpoint of (node,next), with `node` as the control point — the standard
      // midpoint scheme, which makes the curve C1-continuous and seamlessly
      // closed (the last arc returns to the very first midpoint). Stroking each
      // segment on its own lets the hue advance once around the ring.
      c.clear(1);
      ctx.lineWidth = p.lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const pal = p.palette;
      node = head;
      const invCount = 1 / count;
      for (let i = 0; i < count; i++) {
        const next = nextIdx[node];
        const prev = prevIdx[node];
        const aX = (nx[prev] + nx[node]) * 0.5;  // start: midpoint of incoming segment
        const aY = (ny[prev] + ny[node]) * 0.5;
        const bX2 = (nx[node] + nx[next]) * 0.5; // end: midpoint of outgoing segment
        const bY2 = (ny[node] + ny[next]) * 0.5;
        ctx.strokeStyle = sampleCss(pal, 0.18 + i * invCount * 0.72, 0.95);
        ctx.beginPath();
        ctx.moveTo(aX, aY);
        ctx.quadraticCurveTo(nx[node], ny[node], bX2, bY2);
        ctx.stroke();
        node = next;
      }
    },

    onPointer() { /* attraction is read live from pointer state in step() */ },
  };
}

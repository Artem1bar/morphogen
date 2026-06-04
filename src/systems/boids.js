// boids.js — Reynolds flocking. N agents carry position + velocity; three
// steering urges (separation, alignment, cohesion) computed over neighbours
// found through a uniform spatial-hash grid (cell = perception radius), so the
// per-frame cost stays ~O(N) instead of O(N²). Each boid draws as a small
// triangle pointing along its heading; optional fading trails.

import { sampleCss } from '../engine/color.js';
import { TAU } from '../engine/mathx.js';

export default function create() {
  // Agent state (flat arrays — zero per-frame allocation).
  let px = null, py = null, vx = null, vy = null;
  let count = 0;

  // Spatial-hash scratch, sized once in init() for the worst-case grid.
  // We bucket boids by cell with a count-sort: counts → prefix starts → order.
  let cellCount = null;   // boids per cell
  let cellStart = null;   // prefix-sum start offset per cell (+1 sentinel)
  let order = null;       // boid indices grouped by cell
  let gridCap = 0;        // allocated cell capacity
  // Smallest cell size we can afford without overflowing gridCap, recomputed
  // live so perception can shrink without exceeding the buffer.
  const PALETTES = [
    { value: 'ice', label: 'Ice' }, { value: 'ember', label: 'Ember' },
    { value: 'spectral', label: 'Spectral' }, { value: 'cyber', label: 'Cyber' },
    { value: 'coral', label: 'Coral' }, { value: 'moss', label: 'Moss' },
    { value: 'abyss', label: 'Abyss' }, { value: 'dusk', label: 'Dusk' },
  ];

  function spawn(c, i, maxSpeed) {
    px[i] = c.rng.next() * c.width;
    py[i] = c.rng.next() * c.height;
    const a = c.rng.next() * TAU;
    const s = c.rng.range(maxSpeed * 0.5, maxSpeed);
    vx[i] = Math.cos(a) * s;
    vy[i] = Math.sin(a) * s;
  }

  return {
    meta: {
      id: 'boids',
      name: 'Boids',
      blurb: 'A restless flock, conjured from three simple rules.',
      category: 'Life',
    },

    params: [
      { key: 'count', label: 'Flock size', type: 'int', min: 100, max: 1500, step: 50, default: 700, structural: true },
      { key: 'separation', label: 'Separation', type: 'range', min: 0, max: 3, step: 0.05, default: 1.6, hint: 'Avoid crowding neighbours' },
      { key: 'alignment', label: 'Alignment', type: 'range', min: 0, max: 3, step: 0.05, default: 1.0, hint: 'Match neighbour heading' },
      { key: 'cohesion', label: 'Cohesion', type: 'range', min: 0, max: 3, step: 0.05, default: 0.9, hint: 'Steer toward flock centre' },
      { key: 'perception', label: 'Perception', type: 'range', min: 16, max: 90, step: 1, default: 42, hint: 'Neighbour sensing radius (px)' },
      { key: 'maxSpeed', label: 'Max speed', type: 'range', min: 1, max: 6, step: 0.1, default: 3 },
      { key: 'trail', label: 'Trail', type: 'range', min: 0.04, max: 1, step: 0.02, default: 1, hint: '1 = no trail' },
      { key: 'pointerPull', label: 'Pointer', type: 'select', default: 'flee', options: [
        { value: 'flee', label: 'Flee pointer' }, { value: 'seek', label: 'Seek pointer' } ] },
      { key: 'palette', label: 'Palette', type: 'select', default: 'ice', options: PALETTES },
    ],

    init(c) {
      if (!c.width || !c.height) return; // guard against zero-size stage
      count = c.params.count | 0;
      px = new Float32Array(count); py = new Float32Array(count);
      vx = new Float32Array(count); vy = new Float32Array(count);
      const ms = c.params.maxSpeed;
      for (let i = 0; i < count; i++) spawn(c, i, ms);

      // Worst case: smallest perception (16) on this stage. Size generously
      // (+ margin) so the live grid never overflows even after a resize.
      const minCell = 16;
      const cols = Math.ceil(c.width / minCell) + 2;
      const rows = Math.ceil(c.height / minCell) + 2;
      gridCap = cols * rows;
      cellCount = new Int32Array(gridCap);
      cellStart = new Int32Array(gridCap + 1);
      order = new Int32Array(count);

      c.clear(1); // clean opening frame
    },

    step(c) {
      if (!px || !c.width || !c.height) return;
      const p = c.params, ctx = c.ctx;
      const w = c.width, h = c.height;
      const maxSpeed = p.maxSpeed;
      const maxForce = 0.08 + maxSpeed * 0.04; // steering authority scales w/ speed
      const sepW = p.separation, aliW = p.alignment, cohW = p.cohesion;

      // Choose a cell size: perception, but never so small the grid overflows.
      let cell = p.perception;
      let cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
      while ((cols + 2) * (rows + 2) > gridCap && cell < Math.max(w, h)) {
        cell += 2; cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
      }
      const nCells = cols * rows;
      const perc = p.perception, perc2 = perc * perc;
      const sepR = perc * 0.4, sepR2 = sepR * sepR;
      const cellOf = (x, y) => {
        let cx = (x / cell) | 0; if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
        let cy = (y / cell) | 0; if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
        return cy * cols + cx;
      };

      // ---- Build spatial hash via count-sort (allocation-free) ----
      cellCount.fill(0, 0, nCells);
      for (let i = 0; i < count; i++) cellCount[cellOf(px[i], py[i])]++;
      let acc = 0;
      for (let cI = 0; cI < nCells; cI++) { cellStart[cI] = acc; acc += cellCount[cI]; }
      cellStart[nCells] = acc;
      // temp write cursor reuses cellCount as offset-from-start
      cellCount.fill(0, 0, nCells);
      for (let i = 0; i < count; i++) {
        const cI = cellOf(px[i], py[i]);
        order[cellStart[cI] + cellCount[cI]++] = i;
      }

      // Fade for trails (trail=1 → opaque clear, no streak).
      c.clear(p.trail);
      ctx.lineJoin = 'round';

      // ---- Steer & integrate ----
      for (let i = 0; i < count; i++) {
        const x = px[i], y = py[i];
        const cx = Math.min(cols - 1, Math.max(0, (x / cell) | 0));
        const cy = Math.min(rows - 1, Math.max(0, (y / cell) | 0));

        let sx = 0, sy = 0;            // separation accumulator
        let ax = 0, ay = 0, aN = 0;    // alignment (avg velocity)
        let cxs = 0, cys = 0, cN = 0;  // cohesion (avg position)

        // Scan the 3×3 block of cells around this boid.
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= rows) continue;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= cols) continue;
            const cI = gy * cols + gx;
            const start = cellStart[cI], end = cellStart[cI + 1];
            for (let k = start; k < end; k++) {
              const j = order[k];
              if (j === i) continue;
              const dx = x - px[j], dy = y - py[j];
              const d2 = dx * dx + dy * dy;
              if (d2 > perc2 || d2 === 0) continue;
              // alignment + cohesion use every neighbour in perception
              ax += vx[j]; ay += vy[j]; aN++;
              cxs += px[j]; cys += py[j]; cN++;
              // separation only repels close neighbours, weighted by 1/d
              if (d2 < sepR2) {
                const inv = 1 / Math.sqrt(d2);
                sx += dx * inv * inv; sy += dy * inv * inv;
              }
            }
          }
        }

        // Convert each urge into a steering force: desired→normalized→×maxSpeed,
        // minus current velocity, then clamped to maxForce (Reynolds).
        let fx = 0, fy = 0;
        if (sx !== 0 || sy !== 0) { const s = steerScale(sx, sy, maxSpeed); fx += (sx * s - vx[i]) * sepW; fy += (sy * s - vy[i]) * sepW; }
        if (aN > 0) { const s = steerScale(ax, ay, maxSpeed); fx += (ax * s - vx[i]) * aliW; fy += (ay * s - vy[i]) * aliW; }
        if (cN > 0) { const dx = cxs / cN - x, dy = cys / cN - y; const s = steerScale(dx, dy, maxSpeed); fx += (dx * s - vx[i]) * cohW; fy += (dy * s - vy[i]) * cohW; }

        // Pointer interaction: steer toward or away from the cursor.
        if (c.pointer.down) {
          const dir = p.pointerPull === 'seek' ? 1 : -1;
          let dx = (c.pointer.x - x) * dir, dy = (c.pointer.y - y) * dir;
          const d2 = dx * dx + dy * dy;
          if (d2 < 40000 && d2 > 0) { const s = steerScale(dx, dy, maxSpeed); fx += (dx * s - vx[i]) * 1.8; fy += (dy * s - vy[i]) * 1.8; }
        }

        // Limit force, integrate velocity, limit speed.
        const fl2 = fx * fx + fy * fy;
        if (fl2 > maxForce * maxForce) { const inv = maxForce / Math.sqrt(fl2); fx *= inv; fy *= inv; }
        let nvx = vx[i] + fx, nvy = vy[i] + fy;
        const sp2 = nvx * nvx + nvy * nvy;
        if (sp2 > maxSpeed * maxSpeed) { const inv = maxSpeed / Math.sqrt(sp2); nvx *= inv; nvy *= inv; }
        else if (sp2 < 0.0001) { nvx = vx[i] || 0.01; nvy = vy[i] || 0.01; } // avoid stalls/NaN
        vx[i] = nvx; vy[i] = nvy;

        // Advance and wrap toroidally.
        let nx = x + nvx, ny = y + nvy;
        if (nx < 0) nx += w; else if (nx >= w) nx -= w;
        if (ny < 0) ny += h; else if (ny >= h) ny -= h;
        px[i] = nx; py[i] = ny;

        // Draw a ~7px triangle pointing along velocity; color by heading.
        const ang = Math.atan2(nvy, nvx);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const t = (ang + Math.PI) / TAU; // heading → [0,1]
        ctx.fillStyle = sampleCss(p.palette, t, 0.95);
        ctx.beginPath();
        ctx.moveTo(nx + ca * 7, ny + sa * 7);                       // nose
        ctx.lineTo(nx - ca * 3 - sa * 2.6, ny - sa * 3 + ca * 2.6); // left tail
        ctx.lineTo(nx - ca * 3 + sa * 2.6, ny - sa * 3 - ca * 2.6); // right tail
        ctx.closePath();
        ctx.fill();
      }
    },

    onPointer() { /* steering handled live in step() from pointer state */ },
  };

  // Normalize (dx,dy) to length maxSpeed; returns the scalar multiplier so the
  // caller can build the "desired velocity" without allocating a vector.
  function steerScale(dx, dy, maxSpeed) {
    const l = Math.sqrt(dx * dx + dy * dy);
    return l > 0 ? maxSpeed / l : 0;
  }
}

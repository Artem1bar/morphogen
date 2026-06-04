// gen-stubs.mjs — generate placeholder system files so the shell boots and the
// gallery is fully navigable before the real implementations land. Each stub is
// a valid System per the interface contract and draws an animated placeholder.
// The build workflow overwrites these (except flowfield, which is hand-authored).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const systemsDir = join(here, '..', 'src', 'systems');
if (!existsSync(systemsDir)) mkdirSync(systemsDir, { recursive: true });

// Manifest of all systems. flowfield is real and skipped here.
const MANIFEST = [
  ['domainwarp', 'Domain Warp', 'Recursively warped fBm noise rendered as a field.', 'Fields', 'abyss'],
  ['reactiondiffusion', 'Reaction–Diffusion', 'Gray–Scott chemistry growing coral and spots.', 'Reaction', 'ember'],
  ['lenia', 'Lenia', 'Smooth continuous cellular automata — drifting lifeforms.', 'Life', 'spectral'],
  ['physarum', 'Physarum', 'Slime-mould agents sniffing out transport networks.', 'Life', 'moss'],
  ['particlelife', 'Particle Life', 'Asymmetric attraction between colored species.', 'Life', 'cyber'],
  ['boids', 'Boids', 'Flocking from separation, alignment, cohesion.', 'Life', 'ice'],
  ['differentialgrowth', 'Differential Growth', 'A wandering curve that crowds and folds.', 'Growth', 'coral'],
  ['attractors', 'Strange Attractors', 'Clifford & De Jong orbits traced as point clouds.', 'Math', 'sand'],
  ['lsystem', 'L-System Botany', 'Rewriting grammars grown into procedural plants.', 'Growth', 'moss'],
  ['wavefunctioncollapse', 'Wave Function Collapse', 'Constraint-solved tilings from a small pattern set.', 'Tiles', 'dusk'],
  ['cyclic', 'Cyclic Automaton', 'Rock-paper-scissors cells forming spiral waves.', 'Reaction', 'spectral'],
];

const stub = (id, name, blurb, category, palette) => `// ${id}.js — PLACEHOLDER stub. Replaced by the real implementation.
import { sampleCss } from '../engine/color.js';

export default function create() {
  return {
    meta: { id: '${id}', name: ${JSON.stringify(name)}, blurb: ${JSON.stringify(blurb)}, category: '${category}' },
    params: [
      { key: 'tempo', label: 'Tempo', type: 'range', min: 0.1, max: 3, step: 0.1, default: 1 },
    ],
    init(c) { c.clear(1); },
    step(c) {
      const { ctx } = c; const w = c.width, h = c.height;
      c.clear(0.08);
      const t = c.time * c.params.tempo;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2 + t * 0.3;
        const r = (Math.min(w, h) * 0.32) * (0.6 + 0.4 * Math.sin(t + i * 0.4));
        ctx.fillStyle = sampleCss('${palette}', (i / 64 + t * 0.05) % 1, 0.9);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 3 + 2 * Math.sin(t * 2 + i), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(${JSON.stringify(name)} + ' — coming soon', 0, 0);
      ctx.restore();
    },
  };
}
`;

let written = 0;
for (const [id, name, blurb, category, palette] of MANIFEST) {
  const file = join(systemsDir, `${id}.js`);
  writeFileSync(file, stub(id, name, blurb, category, palette));
  written++;
}
console.log(`Wrote ${written} stub system files to ${systemsDir}`);

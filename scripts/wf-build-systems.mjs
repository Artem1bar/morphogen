export const meta = {
  name: 'morphogen-build-systems',
  description: 'Implement 11 generative systems against the Morphogen interface contract, each with a self-repair refine pass.',
  phases: [
    { title: 'Build', detail: 'one agent implements each system from a detailed brief' },
    { title: 'Refine', detail: 'a second agent self-repairs each implementation against the contract + gotchas' },
  ],
};

// ---------------------------------------------------------------------------
// Shared reference material handed to every agent.
// ---------------------------------------------------------------------------

const CONTRACT = [
  'MORPHOGEN SYSTEM INTERFACE CONTRACT',
  '',
  'A system file lives at src/systems/<id>.js and DEFAULT-EXPORTS a factory:',
  '    export default function create() { return System }',
  '',
  'System = {',
  '  meta:   { id, name, blurb, category },',
  '  params: ParamSpec[],',
  '  init(c): void,            // allocate buffers, seed initial state',
  '  step(c): void,            // advance + draw exactly one frame',
  '  onPointer?(c, type): void // type is "down" | "move" | "up"  (optional)',
  '  dispose?(): void          // optional cleanup',
  '}',
  '',
  'ParamSpec = { key, label, type, default, min?, max?, step?, options?, hint?, structural? }',
  '  type is one of: "range" | "int" | "toggle" | "select" | "color"',
  '  options (for select) = [{ value, label }]',
  '  structural:true  => changing this param re-runs init() (use for buffer sizes,',
  '                      particle counts, grid resolution, species count, etc.)',
  '',
  'SystemContext c = {',
  '  ctx,                      // CanvasRenderingContext2D; a dpr transform is ALREADY applied,',
  '                            //   so you draw in LOGICAL (CSS) pixel coordinates.',
  '  width, height,            // logical size in CSS px (may be any aspect; never assume square)',
  '  pixelWidth, pixelHeight,  // device pixels (= width*dpr); only needed for raw ImageData sizing',
  '  dpr,',
  '  rng,                      // SEEDED Rng: rng.next() [0,1), rng.range(a,b), rng.int(a,b),',
  '                            //   rng.chance(p), rng.sign(), rng.pick(arr), rng.gaussian(), rng.unitVector()',
  '  noise,                    // SEEDED Noise: noise.noise2D(x,y), noise.noise3D(x,y,z),',
  '                            //   noise.fbm2D(x,y,{octaves,lacunarity,gain}), noise.fbm3D(x,y,z,{...})',
  '  seed,                     // integer',
  '  time, dt, frame,          // seconds, seconds, integer frame counter',
  '  params,                   // CURRENT values; READ THESE LIVE each step()',
  '  pointer: { x, y, px, py, down },  // logical px; px/py are previous',
  '  clear(alpha?),            // fill whole stage with background at alpha (use small alpha for trails)',
  '  background,               // background color string',
  '}',
].join('\n');

const APIS = [
  'MODULES YOU MAY IMPORT (only these; everything else must be self-contained):',
  '',
  "import { sampleCss, sample, ramp, PALETTES, PALETTE_NAMES } from '../engine/color.js';",
  '  sampleCss(paletteNameOrArray, t in [0,1], alpha=1) -> "rgb(...)" / "rgba(...)" string',
  '  sample(palette, t) -> [r,g,b] floats 0..255',
  '  ramp(palette, steps=256) -> Uint8ClampedArray length steps*3  (FAST per-pixel lookup; precompute once)',
  '  PALETTE names: ember, ice, moss, dusk, mono, spectral, coral, cyber, sand, abyss',
  '',
  "import { TAU, PI, clamp, lerp, invLerp, remap, wrap, smoothstep, smootherstep,",
  "         dist, dist2, vec, vadd, vsub, vscale, vnorm, vrot, vfromAngle, vlimit } from '../engine/mathx.js';",
  '',
  "import { Rng } from '../engine/prng.js';   // only if you need a SECOND independent stream; c.rng is preferred",
  "import { Noise } from '../engine/noise.js'; // c.noise is preferred; import only for a second field",
].join('\n');

const GOTCHAS = [
  'CRITICAL RULES AND GOTCHAS (most first-pass bugs come from these):',
  '',
  '1. DEFAULT EXPORT a factory function. Not a named export, not an object.',
  '2. Determinism: ALL randomness must come from c.rng (or a Rng seeded from c.seed).',
  '   Never call Math.random(). Same seed must reproduce the same result.',
  '3. Pixel/grid systems (reaction-diffusion, lenia, physarum, domain-warp, cyclic,',
  '   attractors, WFC): keep a FIXED-SIZE simulation buffer independent of canvas size.',
  '   Render by writing pixels into an OFFSCREEN canvas via putImageData, then in step()',
  '   do c.ctx.drawImage(offscreen, 0, 0, c.width, c.height). Do NOT putImageData onto',
  '   c.ctx directly — putImageData ignores the dpr transform and uses device pixels,',
  '   which will mis-scale. Create offscreen with document.createElement("canvas").',
  '4. Size the sim buffer for ~60fps on a 1440x900 stage. Suggested caps are in each brief.',
  '   Heavy convolutions/among-all-pairs need spatial hashing or small grids.',
  '5. Allocate ALL buffers in init() (not step()). step() must avoid per-frame allocations',
  '   in hot loops. init() may run again on resize or when a structural param changes.',
  '6. Guard against c.width/c.height being 0 at init time (return early if so).',
  '7. Read params live from c.params inside step(). Mark size-affecting params structural:true.',
  '8. step() must not throw. Clamp indices into buffers; avoid NaN (guard divides by zero).',
  '9. Line/particle systems (boids, particle-life, differential-growth, flow-field):',
  '   use c.clear(fade) for trails or c.clear(1) for a clean frame; do not rely on the',
  '   engine clearing for you (it only paints the background once at init).',
  '10. Aspect ratio: never assume width==height. Map sim grid to the full logical rect.',
  '11. Keep the file focused and readable (roughly 90-200 lines). Comment the algorithm briefly.',
  '12. Return the COMPLETE file contents in `code` with NO markdown code fences.',
].join('\n');

// The canonical reference system, conveying house style and exact interface usage.
const REFERENCE = [
  'REFERENCE SYSTEM (src/systems/flowfield.js) — match this style and interface exactly:',
  '',
  "import { sampleCss } from '../engine/color.js';",
  "import { TAU } from '../engine/mathx.js';",
  '',
  'export default function create() {',
  '  let px = null, py = null, life = null, hue = null, count = 0;',
  '  function spawn(c, i) {',
  '    px[i] = c.rng.next() * c.width;',
  '    py[i] = c.rng.next() * c.height;',
  '    life[i] = c.rng.range(40, 220);',
  '    hue[i] = c.rng.next();',
  '  }',
  '  return {',
  "    meta: { id: 'flowfield', name: 'Flow Field', blurb: 'Particles drifting through an animated noise field.', category: 'Fields' },",
  '    params: [',
  "      { key: 'count', label: 'Particles', type: 'int', min: 200, max: 6000, step: 100, default: 2600, structural: true },",
  "      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 4, step: 0.05, default: 1.3 },",
  "      { key: 'fade', label: 'Trail length', type: 'range', min: 0.004, max: 0.2, step: 0.002, default: 0.03, hint: 'Lower = longer trails' },",
  "      { key: 'palette', label: 'Palette', type: 'select', default: 'abyss', options: [",
  "        { value: 'abyss', label: 'Abyss' }, { value: 'ember', label: 'Ember' }, { value: 'spectral', label: 'Spectral' } ] },",
  '    ],',
  '    init(c) {',
  '      count = c.params.count | 0;',
  '      px = new Float32Array(count); py = new Float32Array(count);',
  '      life = new Float32Array(count); hue = new Float32Array(count);',
  '      for (let i = 0; i < count; i++) spawn(c, i);',
  '      c.clear(1);',
  '    },',
  '    step(c) {',
  '      const p = c.params, ctx = c.ctx, noise = c.noise;',
  '      c.clear(p.fade);',
  '      for (let i = 0; i < count; i++) {',
  '        const n = noise.fbm3D(px[i] * 0.0018, py[i] * 0.0018, c.time * 0.08, { octaves: 2 });',
  '        const a = n * TAU * 1.5;',
  '        const x1 = px[i] + Math.cos(a) * p.speed, y1 = py[i] + Math.sin(a) * p.speed;',
  '        ctx.strokeStyle = sampleCss(p.palette, (n + 1) * 0.5, 0.85);',
  '        ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(x1, y1); ctx.stroke();',
  '        px[i] = x1; py[i] = y1;',
  '        if (--life[i] <= 0 || x1 < -2 || x1 > c.width + 2 || y1 < -2 || y1 > c.height + 2) spawn(c, i);',
  '      }',
  '    },',
  '    onPointer(c, type) { /* optional interaction */ },',
  '  };',
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// Per-system briefs.
// ---------------------------------------------------------------------------

const SYSTEMS = [
  {
    id: 'domainwarp', name: 'Domain Warp', category: 'Fields',
    brief: [
      'Domain-warped fBm noise rendered as a smooth, slowly-evolving field (Inigo Quilez style).',
      'Use an offscreen sim canvas at fixed width SIM=240 (height = round(SIM*c.height/c.width)).',
      'Precompute a palette ramp with ramp(palette,256). For each sim pixel (i,j):',
      '  let fx = i/SIM*freq, fy = j/SIM*freq*aspect;',
      '  q = ( noise.fbm2D(fx, fy, {octaves}), noise.fbm2D(fx+5.2, fy+1.3, {octaves}) );',
      '  r = ( noise.fbm2D(fx+warp*q.x+1.7, fy+warp*q.y+9.2, {octaves}),',
      '        noise.fbm2D(fx+warp*q.x+8.3, fy+warp*q.y+2.8, {octaves}) );',
      '  v = noise.fbm2D(fx+warp*r.x, fy+warp*r.y + time*speed, {octaves});',
      'Map v in [-1,1] -> t in [0,1], apply contrast (t = clamp((t-0.5)*contrast+0.5,0,1)),',
      'look up ramp -> write rgba into an ImageData. putImageData to offscreen; step() drawImages it scaled.',
      'Animate by advancing time*speed in one of the noise coords (above) so it drifts.',
      'Params: freq(range 1..8 default 3), warp(range 0..4 default 1.6), octaves(int 1..6 default 4),',
      '  speed(range 0..0.3 default 0.06), contrast(range 0.5..2.5 default 1.2), palette(select, default abyss).',
      'No pointer needed. Fills whole frame so no c.clear needed. Set ctx.imageSmoothingEnabled=true.',
    ].join('\n'),
  },
  {
    id: 'reactiondiffusion', name: 'Reaction–Diffusion', category: 'Reaction',
    brief: [
      'Classic Gray-Scott reaction-diffusion. Offscreen sim grid ~220 wide (height by aspect, cap ~220).',
      'Float32Array u,v plus next buffers u2,v2. init: u=1 everywhere, v=0; seed ~12 random square',
      'patches of v=1 (and u=0.5) using c.rng. Laplacian kernel (toroidal wrap): center -1,',
      'orthogonal +0.2, diagonal +0.05.',
      'Per frame, run `steps` iterations of: lu=lap(u), lv=lap(v); uvv=u*v*v;',
      '  u2 = u + (Du*lu - uvv + feed*(1-u)); v2 = v + (Dv*lv + uvv - (feed+kill)*v); then swap.',
      'Du=1.0, Dv=0.5. Render v -> t=clamp(v*scale,0,1) -> palette ramp -> ImageData -> drawImage scaled.',
      'Params: feed(range 0.01..0.09 default 0.0545, step 0.0005), kill(range 0.04..0.07 default 0.062, step 0.0005),',
      '  steps(int 1..14 default 8), scale(range 1..6 default 3.2), palette(select default ember).',
      'onPointer: while pointer.down, paint v=1,u=0.2 in a small brush (radius ~6 sim cells) at the mapped',
      '  sim coordinate (map pointer.x/c.width*SIMW, pointer.y/c.height*SIMH). This lets the user draw.',
      'Defaults (0.0545/0.062) should grow coral-like mazes. imageSmoothingEnabled=true.',
    ].join('\n'),
  },
  {
    id: 'lenia', name: 'Lenia', category: 'Life',
    brief: [
      'Lenia — smooth continuous cellular automata (Bert Chan). Square offscreen grid SIZE=120,',
      'Float32 state in [0,1]. Precompute a ring kernel of radius R: for each offset (dx,dy) with',
      'r=hypot(dx,dy) in (0,R], normalized d=r/R, weight=exp(-((d-0.5)^2)/(2*0.15^2)); collect',
      '(dx,dy,weight) into arrays and normalize weights to sum 1. Growth G(u)=2*exp(-((u-mu)^2)/(2*sig^2))-1.',
      'init: seed a random circular blob of smooth noise near center (values ~0.4..1) via c.rng; rest 0.',
      'Per frame (toroidal wrap): for each cell compute potential U = sum(weight*state[neighbor]);',
      '  next = clamp(state + dt*G(U), 0, 1). Use a second buffer; swap.',
      'Render state -> palette ramp -> ImageData -> drawImage scaled (smoothing on for organic look).',
      'Params: mu(range 0.10..0.40 default 0.15, step 0.005), sigma(range 0.008..0.05 default 0.017, step 0.001),',
      '  dt(range 0.04..0.3 default 0.1, step 0.01), R(int 8..16 default 12, structural:true), palette(select default spectral).',
      'Keep SIZE=120, R<=13 for real-time. Precompute kernel offsets in init (rebuild when R changes).',
      'onPointer: while down, add a smooth blob of state at the mapped cell (paint life).',
    ].join('\n'),
  },
  {
    id: 'physarum', name: 'Physarum', category: 'Life',
    brief: [
      'Physarum / slime-mould transport networks (Jones 2010). Trail map Float32 at grid TW x TH,',
      'TW=360 (TH by aspect). Agents: AGENTS particles {x,y,heading}. init random positions+headings.',
      'Per frame: for each agent, sense trail at 3 points at sensorDist ahead: center (heading),',
      '  left (heading - sensorAngle), right (heading + sensorAngle). If center>=both keep heading;',
      '  else if left>right turn by -turnSpeed; else if right>left turn by +turnSpeed; else random turn.',
      '  Move forward by speed=1.0; wrap toroidally; deposit `deposit` into trail at the cell.',
      'After moving all agents: diffuse trail with a 3x3 box blur into a temp buffer, then multiply by',
      '  decay (e.g. 0.92). Swap. Render trail -> t=clamp(trail*brightness,0,1) -> palette ramp -> ImageData -> drawImage.',
      'Params: agents(int 2000..60000 default 18000, step 1000, structural:true), sensorAngle(range 0.2..1.4 rad default 0.6),',
      '  sensorDist(range 2..24 default 9), turnSpeed(range 0.1..1.2 rad default 0.4), deposit(range 1..16 default 5),',
      '  decay(range 0.80..0.99 default 0.92, step 0.005), brightness(range 0.2..3 default 1), palette(select default moss).',
      'Angles in radians. Store trail as Float32Array(TW*TH). onPointer: while down, deposit a blob of trail at pointer.',
    ].join('\n'),
  },
  {
    id: 'particlelife', name: 'Particle Life', category: 'Life',
    brief: [
      'Particle Life / Clusters — asymmetric attraction between colored species produces emergent life.',
      'N particles, K species. Seed a K x K matrix A in [-1,1] from c.rng (structural on N, K, seed).',
      'State: Float32 x,y,vx,vy and Int8/Uint8 species (assign species i = floor(rng*K)).',
      'Force law for an ordered pair (i feels j) at distance d (with toroidal wrap, dx,dy shortest):',
      '  if d < rMin: f = (d/rMin - 1)              // universal short-range repulsion (negative)',
      '  else if d < rMax: f = A[si][sj] * (1 - abs(2*d - rMin - rMax)/(rMax - rMin))  // attraction band',
      '  else f = 0.   Apply acceleration along the unit vector (dx,dy)/d * f * forceScale.',
      'Use a spatial hash grid with cell size = rMax to gather neighbors (build each frame).',
      'Integrate: vx=(vx+ax*dt)*friction; vy=(vy+ay*dt)*friction; x+=vx*dt; y+=vy*dt; wrap to [0,w)x[0,h).',
      'dt~ small (e.g. 0.4). Render: faint trails via c.clear(fade); draw each particle as a 1.6px filled',
      '  circle colored by species: sampleCss(palette, si/(K-1), 0.9).',
      'Params: particles(int 300..2500 default 1200, step 100, structural:true), species(int 2..7 default 5, structural:true),',
      '  rMax(range 30..170 default 90), forceScale(range 0.1..3 default 1), friction(range 0.5..0.99 default 0.86, step 0.01),',
      '  fade(range 0.02..0.4 default 0.12, step 0.01), palette(select default cyber). rMin ~ rMax*0.3.',
      'onPointer: while down, attract (or repel) particles toward pointer within a radius.',
    ].join('\n'),
  },
  {
    id: 'boids', name: 'Boids', category: 'Life',
    brief: [
      'Boids flocking (Reynolds). N agents with position+velocity. Spatial hash grid (cell=perception)',
      'for neighbor queries. Three steering forces within perception radius:',
      '  separation: steer away from neighbors closer than ~perception*0.4 (sum of normalized (self-other)/d);',
      '  alignment: steer toward average neighbor velocity; cohesion: steer toward average neighbor position.',
      'accel = sepW*sep + aliW*ali + cohW*coh, limited to maxForce; v = limit(v+accel, maxSpeed); pos += v;',
      'wrap at edges. Render each boid as a small triangle (length ~7px) pointing along velocity, filled with',
      '  sampleCss(palette, headingOrSpeed, 0.95). Optional faint trails via c.clear(fade) when trails on.',
      'Params: count(int 100..1500 default 700, step 50, structural:true), separation(range 0..3 default 1.6),',
      '  alignment(range 0..3 default 1.0), cohesion(range 0..3 default 0.9), perception(range 16..90 default 42),',
      '  maxSpeed(range 1..6 default 3, step 0.1), trail(range 0.04..1 default 1, step 0.02, hint:"1 = no trail"),',
      '  palette(select default ice). onPointer: boids steer away from (or toward) the pointer.',
    ].join('\n'),
  },
  {
    id: 'differentialgrowth', name: 'Differential Growth', category: 'Growth',
    brief: [
      'Differential growth — a closed curve that lengthens, crowds, and folds into brain-coral forms.',
      'Nodes: arrays nx,ny (use plain arrays or Float32 with a length counter). init: ~70 nodes on a',
      'small circle (radius ~ min(w,h)*0.08) at center, with tiny random jitter from c.rng.',
      'Per frame, for each node i compute a force:',
      '  attraction: pull toward the midpoint of its two path-neighbors (i-1,i+1) (keeps spacing even);',
      '  repulsion: push away from all OTHER nodes within repelRadius (use a spatial hash rebuilt each frame);',
      '  small noise nudge from c.noise (organic wobble).',
      '  newPos = pos + (attractW*attraction + repelW*repulsion + noiseW*nudge) * rate.',
      'After moving, walk the ring: if distance(node, next) > splitDist, insert a midpoint node between them',
      '  (until length reaches maxNodes). Keep it a CLOSED loop. Render: c.clear(1) each frame, then stroke the',
      '  closed path (use quadratic midpoint smoothing) with lineWidth, color by node index via sampleCss(palette,...).',
      'Params: repelRadius(range 8..40 default 18), attraction(range 0..2 default 0.9), repulsion(range 0..2 default 1.1),',
      '  splitDist(range 6..22 default 11), maxNodes(int 400..3500 default 1800, step 100, structural:true),',
      '  lineWidth(range 0.5..3 default 1.1, step 0.1), palette(select default coral).',
      'Cap work: if nodes >= maxNodes stop splitting. No pointer required (optional: attract toward pointer).',
    ].join('\n'),
  },
  {
    id: 'attractors', name: 'Strange Attractors', category: 'Math',
    brief: [
      'Strange attractors rendered as accumulating density plots. Offscreen sim buffer Float32 density of',
      'size DW x DH (DW=640, DH by aspect, cap 640). Keep running orbit state (x,y) across frames.',
      'Each frame iterate the chosen 2D map `pointsPerFrame` times; for each new (x,y) map attractor coords',
      'to a density cell (center the attractor: px = DW/2 + x*scale, py = DH/2 + y*scale, scale=min(DW,DH)*0.22)',
      'and increment density[idx] (guard bounds). Maps:',
      '  clifford: xn = sin(a*y) + c*cos(a*x); yn = sin(b*x) + d*cos(b*y);',
      '  dejong:   xn = sin(a*y) - cos(b*x);   yn = sin(c*x) - cos(d*y);',
      '  svensson: xn = d*sin(a*x) - sin(b*y); yn = c*cos(a*x) + cos(b*y);',
      'Each frame fade density *= 0.96 (so it keeps evolving), then render: t = log(1+density)/log(1+maxDensity)',
      '  (track a running max, or compute), map t -> palette ramp -> ImageData -> drawImage scaled.',
      'Params: type(select clifford|dejong|svensson, default clifford), a(range -3..3 default -1.7, step 0.01),',
      '  b(range -3..3 default 1.8, step 0.01), c(range -3..3 default -1.9, step 0.01), d(range -3..3 default -0.4, step 0.01),',
      '  pointsPerFrame(int 10000..150000 default 60000, step 10000), palette(select default sand).',
      'a,b,c,d are NOT structural (live re-evaluation is the fun). On any a/b/c/d change keep the buffer but it',
      'will re-converge. Reset orbit (x,y) to small values in init. imageSmoothingEnabled=true.',
    ].join('\n'),
  },
  {
    id: 'lsystem', name: 'L-System Botany', category: 'Growth',
    brief: [
      'L-system turtle graphics grown into plants/fractals. Provide presets (axiom + rules + default angle):',
      "  plant:  axiom 'X', rules { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle 25;",
      "  bush:   axiom 'F', rules { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle 22;",
      "  dragon: axiom 'FX', rules { X: 'X+YF+', Y: '-FX-Y' }, angle 90;",
      "  koch:   axiom 'F', rules { F: 'F+F-F-F+F' }, angle 90;",
      "  sierpinski: axiom 'F-G-G', rules { F:'F-G+F+G-F', G:'GG' }, angle 120 (treat G as a draw-forward too).",
      'Expand the axiom `iterations` times (CAP the resulting string length at ~250000; stop expanding if exceeded).',
      'Turtle symbols: F or G = draw forward; + = turn right by angle; - = turn left; [ = push state; ] = pop.',
      'FIRST pass (no drawing): walk the string to compute the bounding box, then compute a transform (scale+translate)',
      'that fits the drawing into the logical rect with ~10% margin. Precompute all segments {x1,y1,x2,y2,depth}.',
      'Animate growth: maintain an OFFSCREEN canvas (logical size); each frame draw the next batch of segments',
      '(drawSpeed segments/frame) onto it WITHOUT clearing; step() blits it with drawImage. depth (bracket depth)',
      'controls color via sampleCss(palette, depth-based t) and line width taper. Add small angle jitter per branch',
      'using c.noise*jitter for organic variation. When all segments drawn, hold.',
      'Params: preset(select plant|bush|dragon|koch|sierpinski, default plant), iterations(int 1..7 default 5, structural:true),',
      '  angle(range 5..120 default 25), jitter(range 0..0.5 default 0.12, step 0.01), drawSpeed(int 20..4000 default 600, step 20),',
      '  palette(select default moss). Rebuild offscreen+segments in init (also on resize). c.clear(1) at init.',
    ].join('\n'),
  },
  {
    id: 'wavefunctioncollapse', name: 'Wave Function Collapse', category: 'Tiles',
    brief: [
      'Tiled Wave Function Collapse with edge-socket matching. Default tileset = TRUCHET arcs (most reliable):',
      'Two base tiles, each a unit cell drawing two quarter-arcs connecting opposite edge midpoints. Tile variant',
      'A connects N-W and S-E; variant B connects N-E and S-W. Each edge has a binary socket (1 if a path crosses',
      'that edge midpoint, else 0). For truchet arcs every edge socket = 1, so any tile fits any neighbor; to make',
      'it interesting, ALSO include a blank tile (all sockets 0) and straight tiles, OR weight toward continuity.',
      'SIMPLER RELIABLE PLAN: tiles = [arcA, arcB] only (sockets all 1) but choose orientation by min-entropy +',
      'weighted rng so arcs chain into loops; render arcs colored by a per-cell hue from c.rng/noise via palette.',
      'Grid GW x GH cells (cell px = floor(min(w,h)/cellsAcross)). Each cell holds a set (bitmask/array) of possible',
      'tile ids. Algorithm per observation: pick the undecided cell with FEWEST options (ties broken by c.rng),',
      'collapse to one option (weighted random), then propagate: push neighbors, remove options whose facing socket',
      'cannot match any remaining option of the collapsed/!updated cell; repeat until stable. If a cell reaches 0',
      'options (contradiction) OR all cells decided, RESET the whole grid (reseed) to keep it animating.',
      'Do `speed` observations per frame; render each decided cell by drawing its tile art (arcs) at its rect with',
      'a palette color. Undecided cells: leave dark. Params: tileset(select truchet|pipes, default truchet),',
      '  cellsAcross(int 8..40 default 20, structural:true), speed(int 1..30 default 6), palette(select default dusk).',
      'Keep it ROBUST: on any contradiction, just restart the grid. Draw tiles with round line caps, lineWidth ~ cellpx*0.16.',
    ].join('\n'),
  },
  {
    id: 'cyclic', name: 'Cyclic Automaton', category: 'Reaction',
    brief: [
      'Cyclic Cellular Automaton (Griffeath) — self-organizes random noise into rotating spiral waves.',
      'Offscreen grid GW x GH, GW=240 (GH by aspect). Uint8 state grid in [0,N-1]. init random states via c.rng.',
      'Update rule (double-buffered, all cells at once): a cell in state s becomes (s+1)%N if the number of',
      'neighbors (Moore neighborhood, range R) currently in state (s+1)%N is >= threshold; else unchanged.',
      'Run `speed` updates per frame. Render state -> t = state/(N-1) -> palette ramp -> ImageData -> drawImage.',
      'Params: states(int 3..16 default 8, structural:true), threshold(int 1..5 default 3),',
      '  range(int 1..2 default 1, structural:true), speed(int 1..4 default 1), palette(select default spectral).',
      'Toroidal wrap. With N=8, threshold=3, R=1 it forms classic spirals after a few hundred steps. No pointer needed.',
      'imageSmoothingEnabled can be false for crisp cells or true for soft; pick true.',
    ].join('\n'),
  },
];

// ---------------------------------------------------------------------------
// Schema for each system's structured output.
// ---------------------------------------------------------------------------

const SYSTEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'the system id, must match the brief' },
    code: {
      type: 'string',
      description: 'COMPLETE contents of src/systems/<id>.js. No markdown fences. Self-contained, default-exports the factory.',
    },
    approach: { type: 'string', description: '2-4 sentences: algorithm + how you kept it real-time.' },
    selfCheck: {
      type: 'string',
      description: 'Confirm each: default export factory; imports only ../engine/*; randomness only via c.rng; pixel systems use offscreen+drawImage (never putImageData to c.ctx); buffers sized for ~60fps; no allocation in step hot loop; handles non-square aspect.',
    },
  },
  required: ['id', 'code', 'approach', 'selfCheck'],
};

function buildPrompt(sys) {
  return [
    'You are implementing ONE generative system for "Morphogen", a creative-coding studio.',
    'Produce a single self-contained ES module that strictly follows the interface contract.',
    'Make it visually striking and genuinely correct — this ships to users.',
    '',
    CONTRACT, '', APIS, '', GOTCHAS, '', REFERENCE, '',
    '=================  YOUR SYSTEM  =================',
    'id: ' + sys.id,
    'name: ' + sys.name,
    'category: ' + sys.category,
    '',
    sys.brief,
    '',
    'Write meta.blurb as a short evocative one-liner. Choose sensible param labels/hints.',
    'Return the COMPLETE file in `code` (no fences). Double-check against the gotchas before returning.',
  ].join('\n');
}

function refinePrompt(sys, built) {
  return [
    'You are reviewing and REPAIRING a first-pass implementation of the Morphogen system "' + sys.id + '".',
    'Apply the contract and gotchas below as a strict checklist. Fix every real bug you find. Common ones:',
    ' - putImageData called on c.ctx instead of an offscreen canvas (mis-scales under the dpr transform)',
    ' - missing/!default export; wrong import paths; importing things that do not exist',
    ' - Math.random used instead of c.rng (breaks determinism)',
    ' - allocations inside the step() hot loop; buffers not sized for ~60fps',
    ' - assuming a square canvas; not handling c.width/c.height = 0',
    ' - NaN from divide-by-zero; out-of-bounds buffer indices; off-by-one in neighbor/wrap math',
    ' - params not read live from c.params; size params not marked structural',
    'If the implementation is already correct, return it unchanged (but still verify).',
    'Keep it self-contained and readable. Return the COMPLETE corrected file in `code` (no fences).',
    '',
    CONTRACT, '', APIS, '', GOTCHAS, '',
    '=================  SYSTEM BRIEF  =================',
    sys.brief,
    '',
    '=================  FIRST-PASS CODE  =================',
    built.code,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Run: build then self-repair each system, fully pipelined.
//
// The Workflow runtime executes this body as an async function, so a top-level
// `return` is the workflow's result. We keep that body inside an explicit
// `run()` so the file is ALSO a valid ES module (parses under `node --check`);
// the workflow globals (agent, pipeline, log) are injected by the runtime.
// ---------------------------------------------------------------------------

export default async function run() {
  log('Building ' + SYSTEMS.length + ' systems (build -> refine, pipelined)…');

  const results = await pipeline(
    SYSTEMS,
    (sys) => agent(buildPrompt(sys), { label: 'build:' + sys.id, phase: 'Build', schema: SYSTEM_SCHEMA }),
    (built, sys) =>
      built
        ? agent(refinePrompt(sys, built), { label: 'refine:' + sys.id, phase: 'Refine', schema: SYSTEM_SCHEMA })
        : null,
  );

  const ok = results.filter(Boolean);
  log('Completed ' + ok.length + '/' + SYSTEMS.length + ' systems.');

  return ok.map((r) => ({ id: r.id, code: r.code, approach: r.approach, selfCheck: r.selfCheck }));
}

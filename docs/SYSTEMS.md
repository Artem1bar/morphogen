# The Systems

Twelve worlds, six families. Each is one file in `src/systems/` implementing the
[interface contract](ARCHITECTURE.md#the-system-interface). This is a tour of
what each one is, how it works, and what to reach for on the control panel.

Every system is seeded — the same seed reproduces the same run — and most
respond to dragging on the canvas.

---

## Fields

### Flow Field
*`src/systems/flowfield.js` — the reference implementation.*

Thousands of particles are pushed through an animated vector field. The field
angle at each point comes from 3D fractal noise (`fbm3D(x, y, time)`), so the
flow slowly evolves as the third coordinate drifts. Particles leave fading
trails (each frame paints a low-alpha background over the last), which is what
turns moving points into silk-like streamlines.

- **Trail length** is the fade alpha — lower means longer, ghostlier trails.
- **Curl** rotates every flow vector toward the perpendicular, swirling the field.
- **Color by** maps hue to the flow angle, the particle's speed, or a per-particle constant.
- *Drag* to shove nearby particles outward.

### Domain Warp
*`src/systems/domainwarp.js`*

Inigo Quilez's recursive trick: take fractal noise and feed it through itself.
A base coordinate `p` is displaced by a first noise vector `q = fbm(p)`, that is
displaced again by a second vector `r = fbm(p + q)`, and the final color is
`fbm(p + r)`. Two rounds of warping produce the marbled, fluid topographies.
Rendered into a small offscreen buffer and scaled up, because each pixel costs
five noise evaluations.

- **Warp** is the displacement strength — 0 is plain noise, high values churn.
- **Frequency** sets the base scale; **Octaves** the fractal detail.
- **Drift** advances one final-noise coordinate over time to animate it.

---

## Reaction

### Reaction–Diffusion
*`src/systems/reactiondiffusion.js`*

The Gray–Scott model: two virtual chemicals **U** and **V** diffuse across a
grid while the reaction U + 2V → 3V consumes U and produces V. U is replenished
at the **feed** rate; V is removed at the **kill** rate. That balance is
everything — small changes flip the system between coral mazes, mitosing spots,
and pulsing waves. Each frame runs several diffusion steps (a 9-point Laplacian
with the classic 0.2 / 0.05 weights) for stability.

- **Feed / Kill** are the control knobs of the whole zoo. The defaults grow coral.
- **Steps/frame** trades speed for smoothness.
- *Drag* to paint fresh V and seed new growth.

### Cyclic Automaton
*`src/systems/cyclic.js`*

Griffeath's cyclic cellular automaton. Each cell holds a state on a color wheel
`0…N-1`. A cell "eats forward": if at least **threshold** of its neighbors
already hold the *next* state `(s+1) mod N`, it advances to that state. From
random noise this produces "demons" that consume each other and curl the
boundaries into endlessly rotating spiral waves. A low threshold gives
excitable-medium dynamics (fronts sweep fast); a high threshold freezes into
static domains.

- **States** is the cycle length — more colors, finer waves.
- **Threshold** is the regime dial: 1 spirals, high values freeze.

---

## Life

### Lenia
*`src/systems/lenia.js`*

Conway's Game of Life made continuous (Bert Chan, 2019). State is a real number
in `[0,1]` on every cell. Instead of counting 8 discrete neighbors, each cell
convolves its surroundings with a smooth **ring kernel** of radius *R*, then
applies a bell-shaped growth function centered on **µ** with width **σ**:
`next = clip(state + dt · G(potential))`. The result is *Orbium* — smooth,
gliding, self-healing lifeforms that genuinely swim across the grid.

- **µ / σ** define which neighborhood densities mean "grow" vs "die." They are delicate.
- **Time step** is how fast the rule is applied; high values get unstable.
- *Drag* to paint living matter.

### Physarum
*`src/systems/physarum.js`*

A slime-mould simulation (Jeff Jones, 2010). Tens of thousands of agents each
sense the trail map at three points ahead — left, center, right — and steer
toward the strongest scent, depositing trail as they go. The trail diffuses and
decays each frame. With nothing more than that, the swarm discovers and
reinforces transport networks that look uncannily like a living organism solving
a maze.

- **Sensor angle / distance** reshape what the agents can "smell," and so the network's character.
- **Decay** sets how fast trails evaporate — the network's memory.
- *Drag* to deposit a blob the agents will swarm toward.

### Particle Life
*`src/systems/particlelife.js`*

Each particle belongs to one of *K* colored species, and a seeded *K×K* matrix
says how strongly species *i* is attracted to (or repelled by) species *j* —
**asymmetrically**, which is the secret. A universal short-range repulsion keeps
particles from collapsing. From those simple forces emerge membranes, cells,
chasing predators, and self-replicating clumps. Neighbor lookups use a spatial
hash so thousands of particles stay real-time.

- **Species** and **Particles** reshape the ecosystem (both reseed it).
- **Force range** and **Friction** tune how far interactions reach and how lively the motion is.
- Each **seed** is a different matrix — a different little biology. *Drag* to stir.

### Boids
*`src/systems/boids.js`*

Craig Reynolds' 1986 flocking model, the ancestor of every CGI bird swarm. Three
steering rules, summed: **separation** (avoid crowding close neighbors),
**alignment** (match neighbors' heading), **cohesion** (steer toward the local
center). A spatial grid keeps the neighbor search cheap. Tilt the three weights
and the flock shifts from tight murmurations to loose, restless drift.

- **Separation / Alignment / Cohesion** are the whole character of the flock.
- **Perception** is how far each boid sees; **Trail** leaves motion streaks.
- *Drag* and the flock flees (or seeks) the pointer.

---

## Growth

### Differential Growth
*`src/systems/differentialgrowth.js`*

A closed loop of nodes that wants two contradictory things: each node is pulled
toward the midpoint of its neighbors (keeping spacing even) while being pushed
away from every other node nearby (avoiding crowding). When an edge stretches too
far, a new node is inserted. The loop has to keep lengthening, so it buckles and
folds — exactly how brain coral, cabbage leaves, and intestinal walls get their
convolutions.

- **Repulsion / Attraction** are the tug-of-war that drives the folding.
- **Split distance** controls how readily new nodes appear (and how fine the folds get).
- **Max nodes** is where growth stops. Watch it for a minute — it starts as a small ring.

### L-System Botany
*`src/systems/lsystem.js`*

A Lindenmayer system: start with an axiom string, rewrite it with production
rules a few times, then read the result as turtle-graphics commands (`F` draw,
`+`/`-` turn, `[`/`]` branch). `X → F+[[X]-X]-F[-FX]+X` iterated five times
unfurls into a fern. The drawing fits itself to the canvas and grows on
progressively; a touch of seeded angle jitter keeps each plant from looking
mechanical.

- **Form** picks the grammar: plant, bush, dragon curve, Koch, Sierpinski.
- **Generations** is how many rewrites — denser with each one.
- **Branch angle** and **Wobble** are the difference between a stiff diagram and a living plant.

---

## Math

### Strange Attractors
*`src/systems/attractors.js`*

Some absurdly simple 2D maps — iterate `x,y → (sin(a·y)+c·cos(a·x), …)` — never
settle and never repeat, tracing out infinitely detailed orbits. Plotting
millions of points and coloring by how often each pixel is hit (log density)
reveals the attractor's filigree structure. Clifford, De Jong, and Svensson maps
are included; the four constants reshape the whole form.

- **Type** switches the map; **a / b / c / d** are its constants — nudge them and the figure morphs live.
- **Points/frame** trades convergence speed for framerate.

---

## Tiles

### Wave Function Collapse
*`src/systems/wavefunctioncollapse.js`*

A constraint solver borrowed from quantum-flavored procedural generation. Every
cell starts in a superposition of all possible tiles. Repeatedly: find the cell
with the fewest remaining options (lowest entropy), collapse it to one tile
(weighted random), then propagate the consequences to its neighbors via
edge-socket matching — a tile's east edge must match its neighbor's west. If a
cell runs out of options, the grid contradicts itself and restarts. The default
Truchet arc tiles always connect, so a finished grid is a single tangle of loops.
The completed weave is held on screen for a beat before reseeding.

- **Tileset** chooses Truchet arcs (always connect) or pipes (blanks + straights, harder constraints).
- **Cells across** sets the grid resolution; **Observations/frame** the solve speed.
- *Click* to start a fresh weave.

---

*Want to add a thirteenth? Copy `flowfield.js`, implement the interface, and
register it in `src/main.js`. The panel, seeding, sharing, export, and recording
are already done for you.*

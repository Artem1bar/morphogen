# Architecture

Morphogen is built around one idea: **a system should only describe itself and
how to draw a frame — the engine does everything else.** This keeps each of the
twelve systems small and focused, and means new features (sharing, recording,
randomization) light up for every system at once.

```
                 ┌─────────────────────────────────────────────┐
   index.html ──▶│  main.js   (register systems, wire the UI)   │
                 └───────────────┬─────────────────────────────┘
                                 │
                          ┌──────▼───────┐     builds each frame
                          │   Engine     │──────────────────────────┐
                          │ (engine.js)  │                          ▼
       ┌───────────┬──────┴──────┬───────┴───────┐         ┌────────────────┐
       ▼           ▼             ▼               ▼         │ SystemContext  │
   ┌───────┐  ┌─────────┐   ┌─────────┐    ┌─────────┐     │  ctx, rng,     │
   │ Stage │  │  Loop   │   │ Param   │    │ URLState│     │  noise, time,  │
   │canvas │  │  RAF    │   │ Panel   │    │  hash   │     │  params, …     │
   └───────┘  └─────────┘   └─────────┘    └─────────┘     └───────┬────────┘
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │ active System    │
                                                          │ init(c)/step(c)  │
                                                          └──────────────────┘
```

## The system interface

A system is a default-exported factory returning an object:

```js
export default function create() {
  return {
    meta:   { id, name, blurb, category },
    params: [ /* ParamSpec[] */ ],
    init(c) { /* allocate buffers, seed initial state */ },
    step(c) { /* advance the simulation + draw one frame */ },
    onPointer(c, type) { /* optional: 'down' | 'move' | 'up' */ },
    dispose() { /* optional cleanup */ },
  };
}
```

### ParamSpec

Parameters are **declarative**. The engine renders them into controls and feeds
their live values back through the context — a system never touches the DOM.

```js
{ key: 'count', label: 'Particles', type: 'int',
  min: 200, max: 6000, step: 100, default: 2600, structural: true }
```

| field | meaning |
|---|---|
| `type` | `range` · `int` · `toggle` · `select` · `color` |
| `structural` | when `true`, changing it re-runs `init()` (buffer sizes, particle counts, grid resolution) |
| `options` | `[{ value, label }]` for `select` |
| `hint` | a one-line explanation shown under the control |

The split between **structural** and **live** parameters is the key performance
decision: a slider like *speed* or *palette* is read fresh every `step()` with no
reallocation, while changing *particle count* tears down and rebuilds buffers
exactly once.

### SystemContext

Built once and mutated in place each frame (no per-frame allocation):

| field | what it gives a system |
|---|---|
| `ctx` | a 2D context with the DPR transform already applied — **draw in logical pixels** |
| `width`, `height` | logical (CSS) size; never assume square |
| `pixelWidth`, `pixelHeight`, `dpr` | device pixels, for raw `ImageData` sizing |
| `rng` | a **seeded** `Rng` — `.next()`, `.range()`, `.int()`, `.gaussian()`, `.pick()`, … |
| `noise` | a **seeded** `Noise` — `.noise2D/3D`, `.fbm2D/3D` |
| `seed`, `time`, `dt`, `frame` | the seed, seconds elapsed, frame delta, frame index |
| `params` | current values; read live each `step()` |
| `pointer` | `{ x, y, px, py, down }` in logical pixels |
| `clear(alpha?)` | fill the stage with the background at `alpha` (trails when small) |

## Determinism & seeding

Everything visual flows from a single integer seed:

- Word-seeds (`coral-reef-42`) are hashed to 32 bits with **xmur3**.
- The generator is **mulberry32** — small, fast, statistically good for visuals.
- `Noise` builds its permutation table from the same seeded stream, so noise
  fields are reproducible too.

Because the only entropy sources are `c.rng` and `c.noise`, a system that obeys
the rule *"never call `Math.random()`"* is fully reproducible. That is the whole
basis for sharing: the URL needs only the system id, the seed, and the parameter
values.

## Rendering pipeline & the DPR transform

The `Stage` sizes the canvas backing store to `cssSize × devicePixelRatio`
(capped at 2 to bound the pixel budget) and applies a `setTransform(dpr, …)` so
systems can think purely in logical pixels.

This has one important consequence for the **grid/pixel systems**
(reaction–diffusion, Lenia, physarum, domain-warp, cyclic, attractors, WFC):
`putImageData` ignores the canvas transform and writes raw device pixels. So
those systems keep a **fixed-size offscreen simulation buffer**, `putImageData`
into it, and then `ctx.drawImage(offscreen, 0, 0, width, height)` — which *does*
respect the transform and scales the simulation up to fill the stage. The
simulation resolution is therefore decoupled from the display resolution, which
is what keeps heavy convolutions real-time.

The **line/particle systems** (flow field, boids, particle life, differential
growth) draw directly and manage their own trails via `c.clear(fade)`.

## State ⇄ URL

`urlstate.js` encodes `{ sys, seed, params }` into a readable, tweakable hash:

```
#sys=flowfield&seed=coral-reef-42&p=count~2600;speed~1.3;palette~s:abyss
```

Values carry just enough type information to round-trip (booleans as `1/0`,
strings prefixed `s:`). Param *types* are resolved against the active system's
spec on load via `coerceParams`, which also fills defaults for any missing keys
and ignores unknown ones — so a URL stays valid even as a system's params evolve.
Writes use `history.replaceState`, so tuning a slider never spams the back button.

## The single-file build

`build.js` ships the studio as one `dist/morphogen.html` that opens by
double-clicking — `file://`, no server. That constraint drives the whole design:
a `file://` page has an opaque `null` origin, so **every ES-module loading
strategy is blocked there** — `<script type="module">`, dynamic `import()`, and
blob-URL imports all trip cross-origin checks. The only thing that behaves
identically on `file://` and `http://` is a single *classic* inline `<script>`
with no network, no modules, and no blobs.

So the build transpiles the ES modules into a tiny synchronous **module
registry** inside one classic script:

1. collect all modules and parse their relative imports into a dependency graph,
2. validate that every relative import resolves (also a good check on generated systems),
3. topologically sort the graph (with cycle detection),
4. transform each module — rewrite `import`s into registry lookups and strip
   `export` keywords into registrations on a per-module `__exports` object —
   wrapping each in an IIFE so module scope is preserved (no global collisions,
   even though every system default-exports a function named `create`),
5. concatenate the factories in dependency order; the entry (`main.js`) runs last.

The transform is deliberately narrow: it matches only this codebase's disciplined
import/export style and anchors its regexes to line-start, so `export`/`import`
text appearing inside comments or strings (the contract sketch in `engine.js`, for
instance) is never rewritten. The result is a ~180 KB file that runs offline from
disk with zero ceremony, verified by booting it and exercising every system.

## Why this shape

- **Small surface per system.** Authors write an algorithm, not UI plumbing.
- **Uniform features.** Sharing, export, recording, randomize, and the control
  panel are engine concerns, so all twelve systems get them identically.
- **Testable core.** The deterministic pieces (PRNG, noise, math, color,
  URL-state) are pure and covered by `node:test` — see `test/`.
- **Zero dependencies.** Nothing to install, audit, or out-date.

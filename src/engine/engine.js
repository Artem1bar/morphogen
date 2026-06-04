// engine.js — the heart of Morphogen. Owns the active system's lifecycle and
// builds the SystemContext handed to every system each frame.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ System interface contract (implemented by every file in src/systems): │
// │                                                                        │
// │   export default function create() => System                          │
// │                                                                        │
// │   System = {                                                           │
// │     meta:   { id, name, blurb, category },                            │
// │     params: ParamSpec[],            // declarative controls            │
// │     init(c: SystemContext): void,   // allocate buffers, seed state    │
// │     step(c: SystemContext): void,   // advance + draw one frame        │
// │     onPointer?(c, type): void,      // 'down' | 'move' | 'up'          │
// │     dispose?(): void,                                                  │
// │   }                                                                    │
// │                                                                        │
// │   ParamSpec = { key, label, type, default, min?, max?, step?,         │
// │                 options?, hint?, structural? }                         │
// │     type ∈ 'range' | 'int' | 'toggle' | 'select' | 'color'           │
// │     structural:true  → changing it re-runs init()                      │
// │                                                                        │
// │   SystemContext (c) = {                                                │
// │     ctx,                       // 2D context, dpr transform applied    │
// │     width, height,             // logical (CSS) pixels                 │
// │     pixelWidth, pixelHeight,   // device pixels (for ImageData work)   │
// │     dpr,                                                               │
// │     rng:   Rng,                // seeded; .next() .range() .int() …     │
// │     noise: Noise,              // seeded simplex/fbm                    │
// │     seed:  number,                                                     │
// │     time, dt, frame,                                                   │
// │     params,                    // current values, read live each step  │
// │     pointer: { x, y, px, py, down },                                   │
// │     clear(alpha?), background, // fill helper + bg color string        │
// │   }                                                                    │
// └──────────────────────────────────────────────────────────────────────┘

import { Stage } from './canvas.js';
import { Loop } from './loop.js';
import { Rng, normalizeSeed, wordSeed, mulberry32 } from './prng.js';
import { Noise } from './noise.js';
import { ParamPanel, defaultsOf } from './params.js';
import {
  decodeState,
  coerceParams,
  writeHash,
  shareableUrl,
} from './urlstate.js';

const BACKGROUND = '#07080c';

export class Engine {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLElement} deps.paramRoot mount point for the control panel
   * @param {Registry} deps.registry
   */
  constructor({ canvas, paramRoot, registry }) {
    this.stage = new Stage(canvas);
    this.registry = registry;
    this.panel = new ParamPanel(paramRoot, (key, value) =>
      this._onParamChange(key, value),
    );
    this.loop = new Loop((t, dt, frame) => this._frame(t, dt, frame));

    this.system = null; // active System instance
    this.systemId = null;
    this.seed = 0;
    this.params = {};
    this._needsInit = false;
    this._listeners = { state: [], fps: [] };

    // Stable context object, mutated in place each frame.
    this.context = {
      ctx: this.stage.ctx,
      width: 0,
      height: 0,
      pixelWidth: 0,
      pixelHeight: 0,
      dpr: 1,
      rng: new Rng(0),
      noise: new Noise(0),
      seed: 0,
      time: 0,
      dt: 0,
      frame: 0,
      params: {},
      pointer: { x: 0, y: 0, px: 0, py: 0, down: false },
      background: BACKGROUND,
      clear: (alpha = 1) => this._clear(alpha),
    };

    this._installPointer(canvas);
    this._installResize(canvas);
  }

  // -- event subscription ---------------------------------------------------

  on(evt, fn) {
    (this._listeners[evt] ||= []).push(fn);
    return () => {
      this._listeners[evt] = this._listeners[evt].filter((f) => f !== fn);
    };
  }

  _emit(evt, payload) {
    for (const fn of this._listeners[evt] || []) fn(payload);
  }

  // -- boot -----------------------------------------------------------------

  /** Start the studio, honoring any state encoded in the URL hash. */
  boot() {
    const fromUrl = decodeState(globalThis.location?.hash || '');
    const id =
      (fromUrl.sys && this.registry.has(fromUrl.sys) && fromUrl.sys) ||
      this.registry.firstId();
    const seed = fromUrl.seed ?? wordSeed(mulberry32(0x9e3779b9));
    this.stage.resize();
    this._loadSystem(id, { seed, rawParams: fromUrl.rawParams });
    this.loop.start();
  }

  // -- system lifecycle -----------------------------------------------------

  /**
   * Switch to a system, optionally seeding initial params (raw strings from a
   * URL) and a seed. Falls back to spec defaults for any unspecified params.
   */
  _loadSystem(id, { seed, rawParams } = {}) {
    const factory = this.registry.get(id);
    if (!factory) return;
    if (this.system?.dispose) {
      try {
        this.system.dispose();
      } catch (e) {
        console.warn('system dispose failed', e);
      }
    }
    this.system = factory();
    this.systemId = id;
    const spec = this.system.params || [];

    this.params = rawParams
      ? coerceParams(spec, rawParams)
      : defaultsOf(spec);
    if (seed !== undefined) this.seed = normalizeSeed(seed);
    this._rawSeed = seed ?? this.seed;

    this.panel.build(spec, this.params);
    this._reinit();
    this._syncUrl();
    this._emit('state', this.snapshot());
  }

  /** Re-run the active system's init() with current seed/params/size. */
  _reinit() {
    if (!this.system) return;
    const changed = this.stage.resize();
    void changed;
    const c = this.context;
    c.dpr = this.stage.dpr;
    c.width = this.stage.width;
    c.height = this.stage.height;
    c.pixelWidth = this.stage.canvas.width;
    c.pixelHeight = this.stage.canvas.height;
    c.rng = new Rng(this.seed);
    c.noise = new Noise(this.seed);
    c.seed = this.seed;
    c.params = this.params;
    c.time = 0;
    c.dt = 0;
    c.frame = 0;

    this.loop.reset();
    this.stage.applyTransform();
    this._paintBackground();
    try {
      this.system.init(c);
    } catch (e) {
      console.error(`init() failed for "${this.systemId}"`, e);
    }
    this._needsInit = false;
  }

  _frame(t, dt, frame) {
    if (!this.system) return;
    if (this._needsInit) this._reinit();
    const c = this.context;
    c.time = t;
    c.dt = dt;
    c.frame = frame;
    c.params = this.params;
    this.stage.applyTransform();
    try {
      this.system.step(c);
    } catch (e) {
      console.error(`step() failed for "${this.systemId}"`, e);
      this.loop.stop();
    }
    if (frame % 30 === 0) this._emit('fps', this.loop.fps);
  }

  // -- public controls ------------------------------------------------------

  setSystem(id) {
    if (id === this.systemId) return;
    this._loadSystem(id, { seed: this._rawSeed });
  }

  setSeed(seed) {
    this.seed = normalizeSeed(seed);
    this._rawSeed = seed;
    this._reinit();
    this._syncUrl();
    this._emit('state', this.snapshot());
  }

  randomizeSeed() {
    const word = wordSeed(this.context.rng.next.bind(this.context.rng));
    this.setSeed(word);
    return word;
  }

  /** Randomize all non-fixed params within their declared ranges. */
  randomizeParams() {
    const spec = this.system?.params || [];
    const rng = new Rng((this.seed ^ 0x5bf03635) >>> 0);
    const next = {};
    for (const p of spec) {
      if (p.fixed) {
        next[p.key] = this.params[p.key];
        continue;
      }
      next[p.key] = randomValueFor(p, rng);
    }
    this.params = next;
    this.panel.setValues(next);
    this._reinit();
    this._syncUrl();
    this._emit('state', this.snapshot());
  }

  restart() {
    this._reinit();
  }

  togglePlay() {
    return this.loop.toggle();
  }

  stepOnce() {
    if (!this.loop.running) this.loop.stepOnce();
  }

  exportPng() {
    const name = `morphogen-${this.systemId}-${this._rawSeed}.png`;
    this.stage.exportPng(name);
  }

  toggleRecording() {
    if (this.stage.isRecording) {
      this.stage.stopRecording();
      return false;
    }
    return this.stage.startRecording({
      filename: `morphogen-${this.systemId}-${this._rawSeed}.webm`,
    });
  }

  shareUrl() {
    return shareableUrl(this._stateForUrl());
  }

  snapshot() {
    return {
      systemId: this.systemId,
      meta: this.system?.meta,
      seed: this._rawSeed,
      params: { ...this.params },
      running: this.loop.running,
    };
  }

  // -- internals ------------------------------------------------------------

  _onParamChange(key, value) {
    this.params = { ...this.params, [key]: value };
    const spec = (this.system?.params || []).find((p) => p.key === key);
    if (spec?.structural) {
      this._needsInit = true;
    }
    this._syncUrl();
  }

  _stateForUrl() {
    return { sys: this.systemId, seed: this._rawSeed, params: this.params };
  }

  _syncUrl() {
    writeHash(this._stateForUrl());
  }

  _paintBackground() {
    const { ctx } = this.stage;
    ctx.save();
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.stage.width, this.stage.height);
    ctx.restore();
  }

  _clear(alpha) {
    const { ctx } = this.stage;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.stage.width, this.stage.height);
    ctx.restore();
  }

  _installPointer(canvas) {
    const toLogical = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * this.stage.width,
        y: ((e.clientY - r.top) / r.height) * this.stage.height,
      };
    };
    const update = (e, type) => {
      const p = toLogical(e);
      const ptr = this.context.pointer;
      ptr.px = ptr.x;
      ptr.py = ptr.y;
      ptr.x = p.x;
      ptr.y = p.y;
      if (type === 'down') ptr.down = true;
      if (type === 'up') ptr.down = false;
      if (this.system?.onPointer) {
        try {
          this.system.onPointer(this.context, type);
        } catch (e2) {
          console.warn('onPointer failed', e2);
        }
      }
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      update(e, 'down');
    });
    canvas.addEventListener('pointermove', (e) => update(e, 'move'));
    canvas.addEventListener('pointerup', (e) => update(e, 'up'));
    canvas.addEventListener('pointerleave', (e) => update(e, 'up'));
  }

  _installResize(canvas) {
    if (typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (this.stage.resize()) this._needsInit = true;
      });
    });
    ro.observe(canvas);
    this._ro = ro;
  }
}

/** Choose a random value appropriate to a param's type/range. */
function randomValueFor(p, rng) {
  switch (p.type) {
    case 'range':
      return Math.round(rng.range(p.min ?? 0, p.max ?? 1) * 1e4) / 1e4;
    case 'int':
      return rng.int(p.min ?? 0, p.max ?? 10);
    case 'toggle':
      return rng.chance();
    case 'select':
      return rng.pick((p.options || [{ value: p.default }]).map((o) => o.value));
    case 'color': {
      const h = Math.floor(rng.next() * 360);
      const s = 60 + Math.floor(rng.next() * 40);
      const l = 40 + Math.floor(rng.next() * 30);
      // crude HSL→hex for a pleasant random color
      const a = (s * Math.min(l, 100 - l)) / 100 / 100;
      const f = (n) => {
        const k = (n + h / 30) % 12;
        const col = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * col)
          .toString(16)
          .padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }
    default:
      return p.default;
  }
}

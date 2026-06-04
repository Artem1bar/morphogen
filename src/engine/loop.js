// loop.js — requestAnimationFrame driver with play/pause, single-step, and a
// smoothed FPS estimate. Time is reported in seconds; dt is clamped so that a
// backgrounded tab returning to focus does not produce a huge simulation jump.

export class Loop {
  /**
   * @param {(t:number, dt:number, frame:number) => void} onFrame
   * @param {object} [opts]
   * @param {number} [opts.maxDt=0.05] clamp for dt in seconds
   */
  constructor(onFrame, { maxDt = 0.05 } = {}) {
    this.onFrame = onFrame;
    this.maxDt = maxDt;
    this.running = false;
    this.frame = 0;
    this.time = 0;
    this.fps = 0;
    this._last = 0;
    this._raf = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  toggle() {
    if (this.running) this.stop();
    else this.start();
    return this.running;
  }

  /** Advance exactly one frame while paused (uses a nominal 1/60 dt). */
  stepOnce() {
    const dt = 1 / 60;
    this.time += dt;
    this.frame += 1;
    this.onFrame(this.time, dt, this.frame);
  }

  /** Reset clock and frame counter (called when a new system starts). */
  reset() {
    this.frame = 0;
    this.time = 0;
    this._last = 0;
  }

  _tick(now) {
    if (!this.running) return;
    const nowS = now / 1000;
    if (this._last === 0) this._last = nowS;
    let dt = nowS - this._last;
    this._last = nowS;
    if (dt > this.maxDt) dt = this.maxDt;
    if (dt < 0) dt = 0;

    this.time += dt;
    this.frame += 1;

    // Smoothed FPS over ~0.5s windows.
    this._fpsAccum += dt;
    this._fpsFrames += 1;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    this.onFrame(this.time, dt, this.frame);
    this._raf = requestAnimationFrame(this._tick);
  }
}

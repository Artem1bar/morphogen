// canvas.js — owns the <canvas>, device-pixel-ratio sizing, and capture.
//
// Systems never touch sizing or export directly; they receive a logical width
// and height (CSS pixels) plus the dpr in the SystemContext and draw in logical
// coordinates after the engine applies the dpr transform.

/**
 * @typedef {object} StageSize
 * @property {number} width  logical (CSS) width
 * @property {number} height logical (CSS) height
 * @property {number} dpr    device pixel ratio actually applied
 */

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {number} [opts.maxDpr=2] cap dpr to bound the pixel budget
   */
  constructor(canvas, { maxDpr = 2 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // High-quality resampling when systems blit an upscaled simulation buffer.
    // Persists across draws; the grid systems then look smooth rather than blocky.
    this.ctx.imageSmoothingQuality = 'high';
    this.maxDpr = maxDpr;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._recorder = null;
    this._chunks = [];
  }

  /**
   * Resize the backing store to match the element's box. Returns true if the
   * size changed (systems should re-init on a true return).
   * @returns {boolean}
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(this.maxDpr, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width === pw && this.canvas.height === ph && this.dpr === dpr) {
      return false;
    }
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    return true;
  }

  /** Apply the dpr transform so systems can draw in logical coordinates. */
  applyTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** @returns {StageSize} */
  size() {
    return { width: this.width, height: this.height, dpr: this.dpr };
  }

  /**
   * Export the current frame as a PNG and trigger a download.
   * @param {string} filename
   */
  exportPng(filename = 'morphogen.png') {
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, filename);
    }, 'image/png');
  }

  /** Whether MediaRecorder video capture is available in this browser. */
  static canRecord() {
    return (
      typeof globalThis.MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function'
    );
  }

  /** True while a recording is in progress. */
  get isRecording() {
    return this._recorder != null && this._recorder.state === 'recording';
  }

  /**
   * Begin recording the canvas to WebM. Resolves the returned promise's
   * download when stopRecording() is called.
   * @param {object} [opts]
   * @param {number} [opts.fps=60]
   * @param {string} [opts.filename]
   */
  startRecording({ fps = 60, filename = 'morphogen.webm' } = {}) {
    if (!Stage.canRecord() || this.isRecording) return false;
    const stream = this.canvas.captureStream(fps);
    const mime = pickVideoMime();
    this._chunks = [];
    this._filename = filename;
    this._recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this._recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder.onstop = () => {
      const blob = new Blob(this._chunks, { type: mime || 'video/webm' });
      downloadBlob(blob, this._filename);
      this._chunks = [];
      this._recorder = null;
    };
    this._recorder.start();
    return true;
  }

  /** Stop the active recording and trigger the download. */
  stopRecording() {
    if (this._recorder && this._recorder.state !== 'inactive') {
      this._recorder.stop();
      return true;
    }
    return false;
  }
}

function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || '';
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

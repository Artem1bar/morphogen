// params.js — render a system's declarative param spec into DOM controls and
// report changes back through a single callback. No framework; just elements.
//
// Supported control types: range, int, toggle, select, color.
// A ParamSpec entry: { key, label, type, default, min?, max?, step?, options?, hint? }

import { clamp } from './mathx.js';

export class ParamPanel {
  /**
   * @param {HTMLElement} root container the controls are mounted into
   * @param {(key:string, value:any, all:object) => void} onChange
   */
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.spec = [];
    this.values = {};
    this._inputs = new Map(); // key -> { el, readout, set(v) }
  }

  /**
   * Rebuild the panel for a new spec and initial values.
   * @param {Array<object>} spec
   * @param {object} values
   */
  build(spec, values) {
    this.spec = spec;
    this.values = { ...values };
    this.root.textContent = '';
    this._inputs.clear();

    for (const p of spec) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.dataset.type = p.type;

      const label = document.createElement('label');
      label.className = 'param-label';
      label.textContent = p.label || p.key;
      label.htmlFor = `param-${p.key}`;

      const control = this._buildControl(p);
      row.appendChild(label);
      row.appendChild(control.wrap);
      if (p.hint) {
        const hint = document.createElement('div');
        hint.className = 'param-hint';
        hint.textContent = p.hint;
        row.appendChild(hint);
      }
      this.root.appendChild(row);
      this._inputs.set(p.key, control);
    }
  }

  _emit(key, value) {
    this.values = { ...this.values, [key]: value };
    this.onChange(key, value, this.values);
  }

  _buildControl(p) {
    const wrap = document.createElement('div');
    wrap.className = 'param-control';
    const id = `param-${p.key}`;
    const initial = this.values[p.key] ?? p.default;

    if (p.type === 'range' || p.type === 'int') {
      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = String(p.min ?? 0);
      input.max = String(p.max ?? 1);
      input.step = String(p.step ?? (p.type === 'int' ? 1 : 0.001));
      input.value = String(initial);
      const readout = document.createElement('span');
      readout.className = 'param-value';
      const fmt = (v) => (p.type === 'int' ? String(v | 0) : trimNum(v));
      readout.textContent = fmt(initial);
      input.addEventListener('input', () => {
        let v = Number(input.value);
        if (p.type === 'int') v = Math.round(v);
        readout.textContent = fmt(v);
        this._emit(p.key, v);
      });
      wrap.appendChild(input);
      wrap.appendChild(readout);
      return {
        wrap,
        set: (v) => {
          input.value = String(v);
          readout.textContent = fmt(v);
        },
      };
    }

    if (p.type === 'toggle') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = 'param-toggle';
      const render = (v) => {
        btn.setAttribute('aria-pressed', v ? 'true' : 'false');
        btn.textContent = v ? 'On' : 'Off';
        btn.classList.toggle('on', !!v);
      };
      render(initial);
      btn.addEventListener('click', () => {
        const v = !(this.values[p.key] ?? p.default);
        render(v);
        this._emit(p.key, v);
      });
      wrap.appendChild(btn);
      return { wrap, set: render };
    }

    if (p.type === 'select') {
      const sel = document.createElement('select');
      sel.id = id;
      sel.className = 'param-select';
      for (const opt of p.options || []) {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = opt.label ?? String(opt.value);
        sel.appendChild(o);
      }
      sel.value = String(initial);
      sel.addEventListener('change', () => this._emit(p.key, sel.value));
      wrap.appendChild(sel);
      return { wrap, set: (v) => { sel.value = String(v); } };
    }

    if (p.type === 'color') {
      const input = document.createElement('input');
      input.type = 'color';
      input.id = id;
      input.className = 'param-color';
      input.value = String(initial);
      input.addEventListener('input', () => this._emit(p.key, input.value));
      wrap.appendChild(input);
      return { wrap, set: (v) => { input.value = String(v); } };
    }

    // Unknown type: render a disabled placeholder so the panel never breaks.
    const span = document.createElement('span');
    span.textContent = String(initial);
    wrap.appendChild(span);
    return { wrap, set: () => {} };
  }

  /**
   * Sync all controls to a values object (used after randomize / URL load).
   * Does NOT emit change events.
   */
  setValues(values) {
    this.values = { ...this.values, ...values };
    for (const [key, control] of this._inputs) {
      if (key in this.values) control.set(this.values[key]);
    }
  }

  /** Current values snapshot. */
  getValues() {
    return { ...this.values };
  }
}

/** Clamp a numeric value against a param spec's min/max if present. */
export function clampToSpec(p, v) {
  if (typeof v !== 'number') return v;
  const lo = p.min ?? -Infinity;
  const hi = p.max ?? Infinity;
  return clamp(v, lo, hi);
}

/** Build a default-values object from a spec. */
export function defaultsOf(spec) {
  const out = {};
  for (const p of spec) out[p.key] = p.default;
  return out;
}

function trimNum(v) {
  const n = Math.round(v * 1000) / 1000;
  return String(n);
}

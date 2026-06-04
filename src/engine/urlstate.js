// urlstate.js — serialize studio state to/from the URL hash.
//
// State shape: { sys: string, seed: string, params: Record<string, number|boolean|string> }
//
// We keep the hash human-readable and tweakable, e.g.
//   #sys=flowfield&seed=coral-reef-42&p=count~2400;speed~1.2;wrap~1
// Param values are encoded with a tiny scheme so booleans and numbers survive a
// round-trip without ambiguity.

/** Encode a single param value to a compact string. */
function encodeValue(v) {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    // Trim to a sane precision to keep URLs short.
    return String(Math.round(v * 1e4) / 1e4);
  }
  return 's:' + encodeURIComponent(String(v));
}

/** Decode a param value given the *type hint* from the system's param spec. */
function decodeValue(raw, type) {
  if (raw.startsWith('s:')) return decodeURIComponent(raw.slice(2));
  if (type === 'toggle') return raw === '1' || raw === 'true';
  if (type === 'select') return decodeURIComponent(raw);
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

/**
 * Encode state to a hash string (without the leading '#').
 * @param {{sys:string, seed:(string|number), params:object}} state
 */
export function encodeState(state) {
  const parts = [];
  if (state.sys) parts.push('sys=' + encodeURIComponent(state.sys));
  if (state.seed !== undefined && state.seed !== null) {
    parts.push('seed=' + encodeURIComponent(String(state.seed)));
  }
  if (state.params && Object.keys(state.params).length) {
    const p = Object.entries(state.params)
      .map(([k, v]) => `${encodeURIComponent(k)}~${encodeValue(v)}`)
      .join(';');
    parts.push('p=' + p);
  }
  return parts.join('&');
}

/**
 * Decode a hash string into a partial state. Param *values* are returned as raw
 * strings keyed by name; the caller resolves types against the active system's
 * param spec via `coerceParams`.
 * @param {string} hash hash with or without leading '#'
 * @returns {{sys?:string, seed?:string, rawParams:Record<string,string>}}
 */
export function decodeState(hash) {
  const h = hash.replace(/^#/, '');
  const out = { rawParams: {} };
  if (!h) return out;
  for (const seg of h.split('&')) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    const key = seg.slice(0, eq);
    const val = seg.slice(eq + 1);
    if (key === 'sys') out.sys = decodeURIComponent(val);
    else if (key === 'seed') out.seed = decodeURIComponent(val);
    else if (key === 'p') {
      for (const pair of val.split(';')) {
        if (!pair) continue;
        const t = pair.indexOf('~');
        if (t < 0) continue;
        out.rawParams[decodeURIComponent(pair.slice(0, t))] = pair.slice(t + 1);
      }
    }
  }
  return out;
}

/**
 * Coerce raw param strings against a param spec list, filling defaults for any
 * missing keys and ignoring unknown ones.
 * @param {Array<{key:string,type:string,default:any}>} spec
 * @param {Record<string,string>} rawParams
 * @returns {object} fully-typed params
 */
export function coerceParams(spec, rawParams) {
  const out = {};
  for (const p of spec) {
    if (Object.prototype.hasOwnProperty.call(rawParams, p.key)) {
      out[p.key] = decodeValue(rawParams[p.key], p.type);
    } else {
      out[p.key] = p.default;
    }
  }
  return out;
}

/**
 * Build the full shareable URL for a state, using the current origin+path.
 * @param {object} state
 * @param {Location|{origin:string,pathname:string}} [loc]
 */
export function shareableUrl(state, loc = globalThis.location) {
  const base = `${loc.origin}${loc.pathname}`;
  return `${base}#${encodeState(state)}`;
}

/**
 * Write state to location.hash without adding a history entry (replaceState).
 * No-ops outside a browser.
 */
export function writeHash(state) {
  if (typeof globalThis.history === 'undefined' || !globalThis.location) return;
  const hash = '#' + encodeState(state);
  try {
    globalThis.history.replaceState(null, '', hash);
  } catch {
    globalThis.location.hash = hash;
  }
}

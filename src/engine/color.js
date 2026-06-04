// color.js — color helpers and curated palettes for Morphogen.
//
// Systems request colors either as named palettes (resolved here) or by
// sampling a palette ramp at t in [0,1]. Palettes are designed to read well on
// the studio's near-black stage.

import { clamp, lerp, wrap } from './mathx.js';

/** Convert HSL (h in [0,360), s,l in [0,1]) to an [r,g,b] array in [0,255]. */
export function hslToRgb(h, s, l) {
  h = wrap(h, 360) / 360;
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Parse "#rrggbb" or "#rgb" into [r,g,b]. */
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] (0..255) → "#rrggbb". */
export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Build "rgba(r,g,b,a)" string from components. */
export const rgba = (r, g, b, a = 1) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

/**
 * Curated palettes. Each is an array of "#rrggbb" stops, dark→light or
 * thematically ordered. These are sampled as smooth ramps by `sample`.
 */
export const PALETTES = {
  ember: ['#0b0306', '#3a0d1e', '#8c1c3a', '#e0432f', '#f6a14a', '#ffe9a8'],
  ice: ['#04070d', '#0d2236', '#1d5a82', '#46a6c9', '#9fe3e8', '#eafcff'],
  moss: ['#040a06', '#13311c', '#2f6b3b', '#73b05a', '#c2dd82', '#f2f7cf'],
  dusk: ['#070512', '#241540', '#542c6e', '#a14a8c', '#e98f86', '#ffd9a0'],
  mono: ['#000000', '#2a2a2a', '#5c5c5c', '#9a9a9a', '#d2d2d2', '#ffffff'],
  spectral: ['#3b0f4d', '#1b4d91', '#1f9e8e', '#7fd34e', '#f7e34a', '#f24b3a'],
  coral: ['#0a0408', '#511133', '#a32555', '#ec5f6a', '#ffae8f', '#fff0d6'],
  cyber: ['#05010f', '#1a0a4a', '#5b1bb0', '#b53bd6', '#ff5fae', '#ffd4f0'],
  sand: ['#100b06', '#3a2a16', '#7a5a2e', '#bd9355', '#e8cf94', '#fbf3d8'],
  abyss: ['#01030a', '#04162e', '#0a3a63', '#1276a0', '#52c5c9', '#c8fbf2'],
};

export const PALETTE_NAMES = Object.keys(PALETTES);

/**
 * Sample a palette (array of hex strings, or a name) at t in [0,1], linearly
 * interpolating between adjacent stops. Returns [r,g,b].
 */
export function sample(palette, t) {
  const stops = Array.isArray(palette) ? palette : PALETTES[palette] || PALETTES.spectral;
  const n = stops.length;
  if (n === 1) return hexToRgb(stops[0]);
  const x = clamp(t, 0, 1) * (n - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= n - 1) return hexToRgb(stops[n - 1]);
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

/** Convenience: sample a palette and return an "rgb()" / "rgba()" string. */
export function sampleCss(palette, t, alpha = 1) {
  const [r, g, b] = sample(palette, t);
  return alpha >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : rgba(r, g, b, alpha);
}

/**
 * Precompute a lookup table of `steps` rgb triples for a palette — used by the
 * pixel-heavy systems (reaction-diffusion, Lenia) to avoid per-pixel interp.
 * Returns a Uint8ClampedArray of length steps*3.
 */
export function ramp(palette, steps = 256) {
  const out = new Uint8ClampedArray(steps * 3);
  for (let i = 0; i < steps; i++) {
    const [r, g, b] = sample(palette, i / (steps - 1));
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

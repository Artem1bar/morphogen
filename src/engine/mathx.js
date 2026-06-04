// mathx.js — small, dependency-free scalar and vector math used everywhere.
//
// Kept deliberately allocation-light: the hot-path vector helpers operate on
// plain {x, y} objects and most return new objects (immutability) except the
// explicitly in-place variants suffixed with `Mut`, which the heavy particle
// systems use to avoid per-frame garbage.

export const TAU = Math.PI * 2;
export const PI = Math.PI;
export const HALF_PI = Math.PI / 2;

/** Constrain v to [lo, hi]. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Inverse lerp: where does v sit between a and b? */
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** Remap v from [inMin,inMax] to [outMin,outMax]. */
export const remap = (v, inMin, inMax, outMin, outMax) =>
  lerp(outMin, outMax, invLerp(inMin, inMax, v));

/** Wrap v into [0, n) with correct behaviour for negatives. */
export const wrap = (v, n) => ((v % n) + n) % n;

/** Smoothstep easing between edge0 and edge1. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp(invLerp(edge0, edge1, x), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smootherstep (Ken Perlin's quintic) — zero 1st & 2nd derivative at ends. */
export function smootherstep(edge0, edge1, x) {
  const t = clamp(invLerp(edge0, edge1, x), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Shortest signed angular distance from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d < -PI) d += TAU;
  if (d > PI) d -= TAU;
  return d;
}

/** Degrees → radians. */
export const radians = (deg) => (deg * PI) / 180;
/** Radians → degrees. */
export const degrees = (rad) => (rad * 180) / PI;

/** Euclidean distance between (x1,y1) and (x2,y2). */
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
/** Squared distance (cheaper when you only need comparisons). */
export const dist2 = (x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
};

// ---------------------------------------------------------------------------
// Immutable {x, y} vector helpers
// ---------------------------------------------------------------------------

export const vec = (x = 0, y = 0) => ({ x, y });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vdot = (a, b) => a.x * b.x + a.y * b.y;
export const vlen = (a) => Math.hypot(a.x, a.y);
export const vlen2 = (a) => a.x * a.x + a.y * a.y;

export function vnorm(a) {
  const l = Math.hypot(a.x, a.y);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate a vector by angle (radians). */
export function vrot(a, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Vector from an angle and length. */
export const vfromAngle = (ang, len = 1) => ({
  x: Math.cos(ang) * len,
  y: Math.sin(ang) * len,
});

/** Clamp a vector's magnitude to max. */
export function vlimit(a, max) {
  const l2 = a.x * a.x + a.y * a.y;
  if (l2 > max * max) {
    const l = Math.sqrt(l2);
    return { x: (a.x / l) * max, y: (a.y / l) * max };
  }
  return { x: a.x, y: a.y };
}

// ---------------------------------------------------------------------------
// In-place variants for hot loops (mutate and return `out`)
// ---------------------------------------------------------------------------

/** out += b * s. */
export function addScaledMut(out, b, s) {
  out.x += b.x * s;
  out.y += b.y * s;
  return out;
}

/** Scale a vector in place. */
export function scaleMut(out, s) {
  out.x *= s;
  out.y *= s;
  return out;
}

/** Limit magnitude in place. */
export function limitMut(out, max) {
  const l2 = out.x * out.x + out.y * out.y;
  if (l2 > max * max) {
    const inv = max / Math.sqrt(l2);
    out.x *= inv;
    out.y *= inv;
  }
  return out;
}

/** Fast 2D fract — useful for hashing. */
export const fract = (x) => x - Math.floor(x);

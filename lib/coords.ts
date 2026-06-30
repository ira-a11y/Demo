// Single source of truth for all coordinate math (§8)

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export interface FractionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SIZE = 0.01;

/** Convert a client pointer event to a fraction within the wrapper rect */
export function toFraction(clientX: number, clientY: number, wrapperRect: DOMRect) {
  return {
    fx: clamp((clientX - wrapperRect.left) / wrapperRect.width, 0, 1),
    fy: clamp((clientY - wrapperRect.top) / wrapperRect.height, 0, 1),
  };
}

/** Build a normalised rect from two fraction points */
export function rectFromPoints(fx0: number, fy0: number, fx1: number, fy1: number): FractionRect {
  const x = Math.min(fx0, fx1);
  const y = Math.min(fy0, fy1);
  const w = Math.abs(fx1 - fx0);
  const h = Math.abs(fy1 - fy0);
  return clampRect({ x, y, w, h });
}

/** Clamp rect so it stays within [0,1] on both axes with minimum size */
export function clampRect(r: FractionRect): FractionRect {
  let { x, y, w, h } = r;
  x = clamp(x, 0, 1);
  y = clamp(y, 0, 1);
  w = clamp(w, MIN_SIZE, 1);
  h = clamp(h, MIN_SIZE, 1);
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  w = Math.max(w, MIN_SIZE);
  h = Math.max(h, MIN_SIZE);
  return { x, y, w, h };
}

/** Move a rect by delta fractions, clamped */
export function moveRect(r: FractionRect, dx: number, dy: number): FractionRect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy });
}

/** Resize a rect from a corner handle, clamped */
export function resizeRect(
  r: FractionRect,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  dfx: number,
  dfy: number
): FractionRect {
  let { x, y, w, h } = r;
  if (corner === 'tl') { x += dfx; y += dfy; w -= dfx; h -= dfy; }
  if (corner === 'tr') { y += dfy; w += dfx; h -= dfy; }
  if (corner === 'bl') { x += dfx; w -= dfx; h += dfy; }
  if (corner === 'br') { w += dfx; h += dfy; }
  return clampRect({ x, y, w, h });
}

/** Nudge by keyboard arrow key */
export function nudgeRect(r: FractionRect, dx: number, dy: number): FractionRect {
  return moveRect(r, dx, dy);
}

/** CSS percent strings for a hotspot element */
export function rectToCss(r: FractionRect) {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  };
}

export function isValidRect(r: FractionRect): boolean {
  return (
    isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h) &&
    r.x >= 0 && r.x <= 1 &&
    r.y >= 0 && r.y <= 1 &&
    r.w >= MIN_SIZE && r.w <= 1 &&
    r.h >= MIN_SIZE && r.h <= 1 &&
    r.x + r.w <= 1.0001 &&
    r.y + r.h <= 1.0001
  );
}

/**
 * Pure scale and layout math for `PriceChart`: the y range (with the reference price kept
 * in view) and where the price-axis tags sit. No DOM, no uPlot instance: unit-testable.
 */

// Price-axis tags (the last price and the reference): their height, which is also the
// distance two tags keep apart and the clearance within which an axis label is left
// blank rather than peeking out from under one.
const AXIS_TAG_HEIGHT_PX = 18;

/**
 * y range for the plotted values plus the reference price (when given). A span smaller
 * than 1% of the price (or 8 ticks) is widened around its midpoint, so a quiet session
 * reads as quiet instead of being stretched edge to edge like a crash; then 10% of the
 * span is added above and below so extremes never touch the frame.
 */
export function chartYRange(
  min: number | null,
  max: number | null,
  reference: number | null,
  tick: number,
): [number, number] {
  let lo = min ?? reference;
  let hi = max ?? reference;
  if (lo === null || hi === null) {
    return [0, 1];
  }
  if (reference !== null) {
    lo = Math.min(lo, reference);
    hi = Math.max(hi, reference);
  }
  const mid = (lo + hi) / 2;
  const minSpan = Math.max(tick * 8, Math.abs(mid) * 0.01);
  if (hi - lo < minSpan) {
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/**
 * Screen positions (CSS px from the plot top) of the price-axis tags. The last price
 * keeps its exact spot; when the reference would overlap it, the reference steps one
 * tag height away on the side it actually lies, so both stay readable.
 */
export function placeAxisTags(
  lastPos: number | null,
  refPos: number | null,
): { last: number | null; ref: number | null } {
  if (refPos === null || lastPos === null || Math.abs(refPos - lastPos) >= AXIS_TAG_HEIGHT_PX) {
    return { last: lastPos, ref: refPos };
  }
  return {
    last: lastPos,
    ref: refPos >= lastPos ? lastPos + AXIS_TAG_HEIGHT_PX : lastPos - AXIS_TAG_HEIGHT_PX,
  };
}

/** Whether an axis label at `pos` would sit under one of the tags at `tagPositions`. */
export function isUnderAxisTag(pos: number, tagPositions: readonly (number | null)[]): boolean {
  return tagPositions.some((tag) => tag !== null && Math.abs(pos - tag) < AXIS_TAG_HEIGHT_PX);
}

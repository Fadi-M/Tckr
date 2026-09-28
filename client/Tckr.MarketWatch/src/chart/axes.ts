/**
 * Pure, renderer-free axis-formatting helpers for `PriceChart` (task 05). Kept apart
 * from `PriceChart.tsx` so the formatting rules — HH:MM:SS on x, tick-size-precision
 * decimals on y, everything through `contracts/decimal.ts` — are unit-testable without
 * a canvas, which jsdom does not provide.
 *
 * Nothing here calls the JS string-to-double or double-to-fixed-decimal-string
 * built-ins. `formatYAxisLabel` takes a plain `number` (uPlot's own axis-tick value —
 * pixel geometry has no other representation) and turns it back into a `DecimalString`
 * using pure integer/string arithmetic (the same scaled-magnitude technique
 * `contracts/decimal.ts` uses internally), then formats *that* through `decimal.ts`'s
 * own `format`. The rounding step can only be as precise as the float uPlot handed in —
 * inherent to any numeric plotting library — but the actual text produced always comes
 * from decimal.ts's formatter, never that built-in, and it never touches the price the
 * user last saw the raw wire string for.
 */
import { decimalPlaces, format, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import { formatCairoClock, formatCairoTimeShort } from '../data/marketCalendar.ts';

/** Digits after the decimal point in a tick-size string — `"0.05"` -> 2, `"0.005"` -> 3,
 * `"1"` -> 0. Pure string indexing, not a numeric parse: a tick size's own precision is
 * exactly its written fractional length. */
export function decimalsForTickSize(tickSize: DecimalString): number {
  return decimalPlaces(tickSize);
}

/**
 * Formats a raw axis-scale number at a fixed decimal precision, via `contracts/decimal.ts`.
 * Rounds by scaling to an integer magnitude (`Math.round`, never a string-to-double parse),
 * renders that integer's digits by string slicing, validates the result with `toDecimal`,
 * and hands it to `decimal.ts`'s `format` for the actual display string — so the
 * formatting rules (sign, zero-padding) live in exactly one place in the codebase.
 */
export function formatAxisPrice(value: number, decimals: number): string {
  const scale = 10 ** decimals;
  const roundedMagnitude = Math.round(Math.abs(value) * scale);
  const digits = roundedMagnitude.toString().padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals) || '0';
  const fracPart = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const body = decimals > 0 ? `${intPart}.${fracPart}` : intPart;
  const negative = value < 0 && roundedMagnitude !== 0;
  const decimalString = toDecimal(`${negative ? '-' : ''}${body}`);
  return format(decimalString, { decimals });
}

/** `y` label for a given instrument, combining `decimalsForTickSize` and
 * `formatAxisPrice` — what `PriceChart`'s y-axis `values` callback calls per split. */
export function formatYAxisLabel(value: number, tickSize: DecimalString): string {
  return formatAxisPrice(value, decimalsForTickSize(tickSize));
}

/**
 * Wall-clock `HH:MM:SS` for an epoch-millisecond x value, in **Cairo** time (EGX's own
 * market timezone) — zero-padded. A thin re-export of `marketCalendar.formatCairoClock`,
 * not a second implementation: this function has already drifted from what
 * `StockDetail.tsx`'s header shows twice in this codebase's history (once local-time
 * vs. UTC, once UTC vs. Cairo) precisely because it used to be its own independent
 * implementation. Since this is explicitly Egyptian-market data, every timestamp on the
 * page — this chart's x-axis/hover readout and the header's "as of" line alike — must
 * show EGX's own Cairo time regardless of the viewer's location, not UTC and not the
 * viewer's local timezone. There must only ever be one implementation of "what time is
 * it, for display purposes, on this page."
 */
export function formatClockTime(epochMs: number): string {
  return formatCairoClock(epochMs);
}

/** `x` label for a given epoch-ms split — what `PriceChart`'s x-axis `values` callback
 * calls per split. A thin, named alias of `formatClockTime` so axis wiring in
 * `PriceChart.tsx` reads as "x labels, y labels" rather than raw formatter calls. */
export function formatXAxisLabel(epochMs: number): string {
  return formatClockTime(epochMs);
}

/** `x` label at the density uPlot chose: `HH:MM` once splits are a whole minute or more
 * apart (a SESSION chart), `HH:MM:SS` below that (the 60S range), where the seconds are
 * the information. Both in Cairo time via the same shared formatters. */
export function formatXAxisTick(epochMs: number, stepMs: number): string {
  return stepMs >= 60000 ? formatCairoTimeShort(epochMs) : formatClockTime(epochMs);
}

/**
 * Where the time axis puts its labels: always at both ends of the plotted range (the
 * session's first and last sample — "10:00" and "14:30" — so a narrow chart still says
 * what span it covers), plus every whole `incrMs` step in between that stays at least
 * `minGapMs` from both ends (so an interior label never collides with an end label).
 * `incrMs` is the step uPlot picked from `X_AXIS_INCREMENTS_MS` for the space available.
 */
export function timeAxisSplits(
  minMs: number,
  maxMs: number,
  incrMs: number,
  minGapMs: number,
): number[] {
  if (!(maxMs > minMs)) {
    return [minMs];
  }
  const splits = [minMs];
  for (let t = Math.ceil(minMs / incrMs) * incrMs; t < maxMs; t += incrMs) {
    if (t - minMs >= minGapMs && maxMs - t >= minGapMs) {
      splits.push(t);
    }
  }
  splits.push(maxMs);
  return splits;
}

/**
 * Candidate x-axis increments in milliseconds, ascending, from 1 second to 8 hours. The
 * top steps exceed a session on purpose: uPlot drops an axis's labels entirely when no
 * step fits the width, so a phone-width chart needs one that always fits (its labels are
 * then just the two ends — see `timeAxisSplits`).
 * Passed as uPlot's `Axis.incrs` for the (linear, non-`time`) x scale so uPlot's own
 * space-aware split algorithm — unmodified — snaps to whichever of these fits the
 * container width without crowding labels, rather than picking an arbitrary raw-ms
 * step. Every value here lines up on a clean second/minute boundary so `formatClockTime`
 * output never looks arbitrary (e.g. never "10:31:07.340").
 */
export const X_AXIS_INCREMENTS_MS: readonly number[] = [
  1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000,
  7200000, 14400000, 28800000,
];

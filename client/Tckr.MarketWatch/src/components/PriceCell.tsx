/**
 * PriceCell — task 04 (docs/phase-3-web-client/04-stock-list.md).
 *
 * The one component that renders a price (or any signed decimal quantity) on screen.
 * Formats exclusively via `contracts/decimal.ts`; a value never passes through a JS
 * `number` on its way to the page. `StockList` uses it for every Price/Change cell, and
 * task 06's `StockDetail` reuses it verbatim for the header stats — see this task's
 * "Notes for other tasks" for the exact prop surface.
 *
 * Two independent, optional behaviours layered on top of `format()`:
 *
 *  - `muted`: pre-tick / no-data display (e.g. a symbol's static `referencePrice`
 *    before its first tick). De-emphasised text, never a spinner, never suppressed to
 *    `0.00`, and never flashes.
 *  - transient flash: whenever `value` changes from the previously rendered value
 *    (tracked in a `ref`, never `useState`/`setTimeout`), the cell briefly tints its
 *    background and pulses a directional arrow. The animation is CSS, keyed on the new
 *    value via React `key` so it restarts on every change — this component schedules no
 *    render of its own to start or stop it (README.md design decision #4 applies to the
 *    render *path*; this is the render *cost* of a value change staying at zero).
 *  - `indicateSign`: persistent colour + arrow using task 03's `.tckr-delta--up` /
 *    `.tckr-delta--down` convention (global.css), based on the sign of `value` itself —
 *    for fields that are inherently signed (Change), never for a raw trade price.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { compare, format, toDecimal, type DecimalString } from '../contracts/decimal.ts';

const ZERO: DecimalString = toDecimal('0');

const STYLE_ELEMENT_ID = 'tckr-price-cell-styles';

// A single injected stylesheet, shared by every `PriceCell` instance. `PriceCell.tsx`
// is the only file this task owns besides `StockList.tsx` and its tests, so a
// component-scoped stylesheet is injected here rather than added to task 03's
// `src/styles/global.css` (out of scope — see "Notes for other tasks").
function ensureStylesInjected(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
.tckr-price-cell { font-variant-numeric: tabular-nums; font-family: var(--tckr-font-mono); }
.tckr-price-cell--muted { color: var(--tckr-color-text-muted); font-style: italic; }
.tckr-price-cell__flash {
  display: inline-block;
  border-radius: 3px;
  padding: 0 2px;
  margin: 0 -2px;
}
.tckr-price-cell__flash--up { animation: tckr-price-flash-up-bg 900ms ease-out; }
.tckr-price-cell__flash--down { animation: tckr-price-flash-down-bg 900ms ease-out; }
.tckr-price-cell__flash-arrow--up::before {
  content: '\\25B2 ';
  color: var(--tckr-color-up);
  animation: tckr-price-flash-arrow 900ms ease-out;
}
.tckr-price-cell__flash-arrow--down::before {
  content: '\\25BC ';
  color: var(--tckr-color-down);
  animation: tckr-price-flash-arrow 900ms ease-out;
}
@keyframes tckr-price-flash-up-bg {
  from { background-color: color-mix(in oklab, var(--tckr-color-up) 28%, transparent); }
  to { background-color: transparent; }
}
@keyframes tckr-price-flash-down-bg {
  from { background-color: color-mix(in oklab, var(--tckr-color-down) 28%, transparent); }
  to { background-color: transparent; }
}
@keyframes tckr-price-flash-arrow {
  from { opacity: 1; }
  70% { opacity: 1; }
  to { opacity: 0; }
}
`;
  document.head.appendChild(style);
}

ensureStylesInjected();

export interface PriceCellProps {
  /** The decimal value to render — a price, or any signed decimal quantity such as
   * Change. Never a JS `number`. */
  readonly value: DecimalString;
  /** Forwarded to `format()`. Omit to use the value's own precision. */
  readonly decimals?: number;
  /** Forwarded to `format()` — prefixes `+` for a positive, non-zero value. */
  readonly sign?: boolean;
  /** Pre-tick / no-data display: de-emphasised text that never flashes. */
  readonly muted?: boolean;
  /** Persistent colour + arrow (task 03's `.tckr-delta--up`/`--down`) based on the sign
   * of `value` itself. Use for signed fields (Change); never for the raw trade price. */
  readonly indicateSign?: boolean;
  /** Accessible label override. Defaults to the formatted text itself. */
  readonly ariaLabel?: string;
}

export function PriceCell({
  value,
  decimals,
  sign,
  muted = false,
  indicateSign = false,
  ariaLabel,
}: PriceCellProps): ReactNode {
  const previousRef = useRef<DecimalString | null>(null);
  const previous = previousRef.current;

  let flashDirection: 'up' | 'down' | null = null;
  if (!muted && previous !== null && previous !== value) {
    const cmp = compare(value, previous);
    flashDirection = cmp === 1 ? 'up' : cmp === -1 ? 'down' : null;
  }

  useEffect(() => {
    previousRef.current = value;
  }, [value]);

  const formatOpts: { decimals?: number; sign?: boolean } = {};
  if (decimals !== undefined) {
    formatOpts.decimals = decimals;
  }
  if (sign !== undefined) {
    formatOpts.sign = sign;
  }
  const formatted = format(value, formatOpts);

  const signClass =
    indicateSign && !muted
      ? compare(value, ZERO) === 1
        ? 'tckr-delta--up'
        : compare(value, ZERO) === -1
          ? 'tckr-delta--down'
          : ''
      : '';

  const wrapperClassName = ['tckr-price-cell', muted ? 'tckr-price-cell--muted' : '', signClass]
    .filter(Boolean)
    .join(' ');

  // When `indicateSign` already carries a permanent arrow via `signClass`, the flash
  // itself stays background-only so the two arrows never overlap.
  const flashClassName = flashDirection
    ? [
        `tckr-price-cell__flash tckr-price-cell__flash--${flashDirection}`,
        indicateSign ? '' : `tckr-price-cell__flash-arrow--${flashDirection}`,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  return (
    <span className={wrapperClassName} aria-label={ariaLabel}>
      <span key={value} className={flashClassName}>
        {formatted}
      </span>
    </span>
  );
}

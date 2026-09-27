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
 *    (tracked in a `ref`, never `useState`/`setTimeout`), the digits that changed roll
 *    into place (`RollingText`), the figure lights in its signal colour and settles back,
 *    and a directional arrow pulses. Nothing is painted behind the digits. The animation
 *    is CSS, keyed on the new value via React `key` so it restarts on every change — this
 *    component schedules no
 *    render of its own to start or stop it (README.md design decision #4 applies to the
 *    render *path*; this is the render *cost* of a value change staying at zero).
 *  - `indicateSign`: persistent colour + arrow using the shared "delta" convention
 *    (up = `text-up before:content-['▲_']`, down = `text-down before:content-['▼_']`),
 *    based on the sign of `value` itself — for fields that are inherently signed
 *    (Change), never for a raw trade price.
 *
 * `flashDirectionOverride` ("Tckr First Run" design pass follow-up — a real user-
 * reported bug, not a stylistic choice): a raw trade price's own tick-to-tick delta and
 * the adjacent Change field's since-open delta are *different comparisons* that can
 * legitimately disagree — a price that just ticked down a hair can still be net up for
 * the day. Left to its own tick-to-tick comparison, the price's flash arrow would then
 * show red/down right beside a green/up Change arrow, which reads as a flat-out
 * contradiction to anyone glancing at the two together, even though both are
 * individually "correct" by their own definition. Callers displaying a raw price next
 * to a persistent Change indicator (`StockDetail`'s header, `StockList`'s Price column)
 * pass the Change's own sign here so the two arrows can never disagree — the flash
 * still only plays when `value` itself changes (so it still means "this just ticked"),
 * it is just recoloured to match the trend the viewer actually cares about.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { compare, format, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import { hasSettled, isLanding, RollingText } from './RollingText.tsx';

interface Landing {
  readonly value: DecimalString;
  readonly previous: DecimalString;
  readonly direction: 'up' | 'down' | null;
  /** `performance.now()` when it started; it ends `LANDING_WINDOW_MS` later. */
  readonly at: number;
}

const ZERO: DecimalString = toDecimal('0');

function decimalPlacesIn(formatted: string): number {
  const dot = formatted.lastIndexOf('.');
  return dot === -1 ? 0 : formatted.length - dot - 1;
}

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
  /** Persistent colour + arrow (the shared delta convention) based on the sign of
   * `value` itself. Use for signed fields (Change); never for the raw trade price. */
  readonly indicateSign?: boolean;
  /** Recolours the transient flash to this direction instead of computing it from
   * `value`'s own tick-to-tick delta — see the module doc. Pass the sign of whatever
   * persistent Change indicator sits beside this cell; omit for a cell with no such
   * neighbour (e.g. the Change cell itself, which already carries its own sign via
   * `indicateSign`). `null` suppresses the flash's directional colour entirely (flat/
   * zero change) without suppressing the flash animation itself. */
  readonly flashDirectionOverride?: 'up' | 'down' | null | undefined;
  /** Accessible label override. Defaults to the formatted text itself. */
  readonly ariaLabel?: string;
  /** Decimal places of the most precise value in this cell's column. EGX tick sizes
   * differ by price band, so one column legitimately mixes `246.3` and `6.129`;
   * padding narrower values with blank trailing width (`ch` of the tabular mono face,
   * never extra zeros, which would claim a precision the instrument doesn't trade at)
   * lines every decimal point up under a right-aligned header. */
  readonly alignDecimals?: number | undefined;
  /** `false` keeps the transient flash to its background tint, with no ▲/▼ glyph —
   * for cells whose direction is already said beside them (the detail header's change
   * pills) or where a glyph would read as a claim about the value (a session High). */
  readonly flashGlyph?: boolean;
}

export function PriceCell({
  value,
  decimals,
  sign,
  muted = false,
  indicateSign = false,
  flashDirectionOverride,
  ariaLabel,
  alignDecimals,
  flashGlyph = true,
}: PriceCellProps): ReactNode {
  const previousRef = useRef<{ readonly value: DecimalString; readonly since: number } | null>(null);
  const previous = previousRef.current?.value ?? null;
  // The change currently landing. Kept across re-renders that don't change `value`
  // (a board row re-renders every second for its "Last update" clock), so an unrelated
  // render never cuts a landing short; a new value replaces it and restarts it. Once it
  // has played it is dropped, so moving the row can't replay it (`LANDING_WINDOW_MS`).
  const landingRef = useRef<Landing | null>(null);

  let landing: Landing | null = null;
  if (!muted && previous !== null && previous !== value && hasSettled(previousRef.current!.since)) {
    let direction: 'up' | 'down' | null;
    if (flashDirectionOverride !== undefined) {
      direction = flashDirectionOverride;
    } else {
      const cmp = compare(value, previous);
      direction = cmp === 1 ? 'up' : cmp === -1 ? 'down' : null;
    }
    landing = { value, previous, direction, at: performance.now() };
  } else if (!muted && landingRef.current?.value === value && isLanding(landingRef.current.at)) {
    landing = landingRef.current;
  }
  const flashDirection = landing?.direction ?? null;

  useEffect(() => {
    previousRef.current = { value, since: performance.now() };
    landingRef.current = landing;
  }, [value, landing]);

  const formatOpts: { decimals?: number; sign?: boolean } = {};
  if (decimals !== undefined) {
    formatOpts.decimals = decimals;
  }
  if (sign !== undefined) {
    formatOpts.sign = sign;
  }
  const formatted = format(value, formatOpts);

  // The shared "delta" convention: up = `text-up before:content-['▲_']`, down =
  // `text-down before:content-['▼_']`.
  const signClass =
    indicateSign && !muted
      ? compare(value, ZERO) === 1
        ? "text-up before:content-['▲_']"
        : compare(value, ZERO) === -1
          ? "text-down before:content-['▼_']"
          : ''
      : '';

  const wrapperClassName = [
    'font-mono tabular-nums',
    muted ? 'text-text-muted' : '',
    signClass,
  ]
    .filter(Boolean)
    .join(' ');

  // The flash tints the digits themselves and lets them settle back to their resting
  // colour; nothing is painted behind them. Where `indicateSign` already carries a
  // permanent arrow and colour, the flash adds neither, so the two never overlap. The
  // arrow variant colours the `::before` glyph only.
  const flashClassName = flashDirection
    ? [
        indicateSign ? '' : flashDirection === 'up' ? 'animate-price-flash-up' : 'animate-price-flash-down',
        indicateSign || !flashGlyph
          ? ''
          : flashDirection === 'up'
            ? "before:content-['▲_'] before:text-up before:animate-price-flash-arrow"
            : "before:content-['▼_'] before:text-down before:animate-price-flash-arrow",
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  // Blank width, not text: nothing is added to the cell's text or accessible name.
  const shownDecimals = decimalPlacesIn(formatted);
  const padCh =
    alignDecimals !== undefined && alignDecimals > shownDecimals
      ? alignDecimals - shownDecimals + (shownDecimals === 0 ? 1 : 0)
      : 0;

  return (
    <span className={wrapperClassName} aria-label={ariaLabel} data-muted={muted}>
      <span key={value} className={flashClassName || undefined}>
        <RollingText
          text={formatted}
          previous={landing ? format(landing.previous, formatOpts) : null}
          direction={flashDirection ?? 'up'}
        />
      </span>
      {padCh > 0 ? <span aria-hidden="true" className="inline-block" style={{ width: `${padCh}ch` }} /> : null}
    </span>
  );
}

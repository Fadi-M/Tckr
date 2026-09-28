/**
 * The detail chart's range pills (60S / 5M / SESSION): which slice of the session's
 * history each shows, and how that slice is named, for a given market status.
 *
 * Every window ends at the edge of the data it describes. While EGX is trading that
 * is *now*, so 60S means the last 60 seconds. Once it has closed (including the
 * pre-open auction, which still displays the previous session) the tape stopped at
 * the session's close, so the short ranges end there instead: "the final 60 seconds
 * of Thursday's session", not "the last 60 seconds of wall-clock time", which after
 * the close would hold no trades and plot as a one-second stub. The labels say which
 * of the two the chart is showing, and on which session, so a closed-market chart
 * reads as a recap rather than a feed that has gone quiet.
 *
 * Pure (no React, no clock of its own): the page passes in the market status and the
 * current time, so every case here is a plain unit test.
 */
import {
  formatCairoDateShort,
  formatCairoTimeShort,
  type MarketStatus,
} from '../data/marketCalendar.ts';

export type RangeKey = '60S' | '5M' | 'SESSION';

export const RANGE_KEYS: readonly RangeKey[] = ['60S', '5M', 'SESSION'];

/** The trailing windows; SESSION is the whole session and has no entry. */
const TRAILING_WINDOWS: Record<
  Exclude<RangeKey, 'SESSION'>,
  { ms: number; short: string; spoken: string }
> = {
  '60S': { ms: 60_000, short: '60s', spoken: '60 seconds' },
  '5M': { ms: 5 * 60_000, short: '5m', spoken: '5 minutes' },
};

export interface ChartRange {
  /** Short caption shown on the chart itself (the range chip). */
  readonly label: string;
  /** Spelled-out meaning, for the pill's tooltip and accessible name. */
  readonly description: string;
  /** Keep points with `t` in `[from, to]`; a `null` bound is open. */
  readonly from: number | null;
  readonly to: number | null;
}

export function describeRange(key: RangeKey, status: MarketStatus, nowMs: number): ChartRange {
  const opens = formatCairoTimeShort(status.sessionOpenAt);
  const live = status.state === 'open';
  const day = formatCairoDateShort(status.sessionCloseAt);
  const closes = formatCairoTimeShort(status.sessionCloseAt);

  if (key === 'SESSION') {
    return live
      ? {
          label: `Today since ${opens}`,
          description: `Today's session so far, since the ${opens} open`,
          from: null,
          to: null,
        }
      : {
          label: `${day} session · ${opens}–${closes}`,
          description: `The whole ${day} session, ${opens} to ${closes} Cairo`,
          from: null,
          to: null,
        };
  }

  const trailing = TRAILING_WINDOWS[key];
  const end = live ? nowMs : status.sessionCloseAt;
  return live
    ? {
        label: `Last ${trailing.short}`,
        description: `Last ${trailing.spoken}`,
        from: end - trailing.ms,
        to: null,
      }
    : {
        label: `Final ${trailing.short} · ${day}`,
        description: `Final ${trailing.spoken} of the ${day} session, to the ${closes} close`,
        from: end - trailing.ms,
        to: end,
      };
}

/** The points of `history` that fall inside `range`. */
export function pointsInRange<T extends { readonly t: number }>(
  history: readonly T[],
  range: ChartRange,
): readonly T[] {
  const { from, to } = range;
  if (from === null && to === null) {
    return history;
  }
  return history.filter(
    (point) => (from === null || point.t >= from) && (to === null || point.t <= to),
  );
}

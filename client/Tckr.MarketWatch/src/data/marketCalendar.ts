/**
 * EGX's real trading calendar — Sunday–Thursday, ~10:00–14:30 Cairo local time — and
 * the Cairo-time formatting every price/timestamp on this page uses. This is the
 * feature that makes the app behave like a real EGX terminal rather than a "session
 * since this tab loaded": when the market is closed, the client shows that day's full,
 * completed session, frozen; when open, history-so-far plus live updates.
 *
 * Deliberately a plain, dependency-free module — not a `MarketDataSource` member.
 * "Is EGX open right now" is a pure function of wall-clock time; it does not depend on
 * which data source is active. Both `SimulatedSource` (to decide when to generate
 * ticks) and the UI (to show a "market closed" badge) import this module directly, so
 * there is exactly one implementation to ever be inconsistent with itself. A real
 * gateway integration would eventually want authoritative session boundaries from the
 * server instead of a client-computed guess — client-side computation here is a
 * documented, acceptable simplification scoped to this demo, not a permanent design.
 *
 * Timezone handling: Egypt observes DST (`Africa/Cairo`, Law No. 34/2023 — last Friday
 * of April through the last Thursday of October, at the time this was written), so the
 * UTC offset is +2 or +3 depending on the date. This is handled entirely through
 * `Intl.DateTimeFormat`'s built-in IANA timezone database (`getCairoParts` below) —
 * never a hardcoded offset or a hand-rolled DST date table, both of which would go
 * stale the moment the rule changes again (which Egypt has already done more than
 * once). If the JS engine's own tz database is current, this stays correct with zero
 * code changes.
 *
 * The pre-open auction (09:30–10:00 Cairo, per EGX's real session structure) is
 * deliberately treated as still-`'closed'` here — this module models a binary
 * open/closed state, not a three-state pre-open/continuous/closing-auction model,
 * matching what the UI actually needs to show.
 */

const CAIRO_TIME_ZONE = 'Africa/Cairo';

/** Sunday(0)–Thursday(4) trade; Friday(5)/Saturday(6) are EGX's weekend. */
export const MARKET_OPEN = { hour: 10, minute: 0 } as const;
export const MARKET_CLOSE = { hour: 14, minute: 30 } as const;

const CAIRO_WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Short weekday names, indexed the same way `getCairoParts().weekday` is (0=Sunday) —
 * exported for UI copy like "opens Sun 10:00 Cairo". */
export const CAIRO_WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface CairoParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  /** 0 = Sunday .. 6 = Saturday, matching `CAIRO_WEEKDAY_SHORT_NAMES`. */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const cairoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hour12: false,
});

/** Cairo-local calendar/clock fields for an instant, via the engine's own IANA tz
 * database — the one place DST is ever consulted. `hour12: false` is known to format
 * midnight as `"24"` rather than `"00"` in some engines; normalized with `% 24`. */
export function getCairoParts(epochMs: number): CairoParts {
  const parts = cairoFormatter.formatToParts(new Date(epochMs));
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const weekday = CAIRO_WEEKDAY_INDEX[map.weekday ?? ''] ?? 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday,
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** `'YYYY-MM-DD'` for the Cairo calendar date an instant falls on — the identity of a
 * trading session, and (in `SimulatedSource.ts`) part of that session's seed. */
export function cairoDateKey(epochMs: number): string {
  const { year, month, day } = getCairoParts(epochMs);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Cairo-minus-UTC offset (ms) in effect at a given instant, derived from
 * `getCairoParts` rather than a hardcoded/DST-table value. */
function cairoOffsetMsAt(epochMs: number): number {
  const p = getCairoParts(epochMs);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  return asIfUtc - epochMs;
}

/**
 * Epoch ms for a Cairo civil date + wall-clock time (e.g. "2026-09-14" at 10:00). JS
 * has no direct "civil time in a named zone → UTC" API, so this is a short
 * guess-and-correct routine: an initial guess (treating the target wall time as if it
 * were UTC) is corrected by the actual Cairo offset in effect near that guess,
 * iterated twice — converges even for a wall time within the correction window of a
 * DST transition, since Cairo's offset is a two-valued step function, not a continuum.
 */
export function cairoEpochFor(dateKey: string, hour: number, minute: number): number {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const targetWallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let epoch = targetWallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    epoch = targetWallAsUtc - cairoOffsetMsAt(epoch);
  }
  return epoch;
}

export function isTradingDay(weekday: number): boolean {
  return weekday >= 0 && weekday <= 4;
}

function weekdayOfDateKey(dateKey: string): number {
  // Noon Cairo is used as the anchor for calendar-day arithmetic (below) specifically
  // to stay far from any midnight DST transition instant, where "add 24h in ms" and
  // "add one Cairo calendar day" can briefly disagree by an hour.
  return getCairoParts(cairoEpochFor(dateKey, 12, 0)).weekday;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const anchorEpoch = cairoEpochFor(dateKey, 12, 0);
  return cairoDateKey(anchorEpoch + deltaDays * 24 * 60 * 60 * 1000);
}

/** Walks backward from `dateKey` (exclusive) to the nearest trading day — at most a
 * weekend's width away, so a 7-day search is a generous, cheap upper bound. */
export function previousTradingDateKey(dateKey: string): string {
  let candidate = dateKey;
  for (let i = 0; i < 7; i += 1) {
    candidate = shiftDateKey(candidate, -1);
    if (isTradingDay(weekdayOfDateKey(candidate))) {
      return candidate;
    }
  }
  throw new Error(`marketCalendar: no trading day found within 7 days before ${dateKey}`);
}

/** Walks forward from `dateKey` (exclusive) to the nearest trading day. */
export function nextTradingDateKey(dateKey: string): string {
  let candidate = dateKey;
  for (let i = 0; i < 7; i += 1) {
    candidate = shiftDateKey(candidate, 1);
    if (isTradingDay(weekdayOfDateKey(candidate))) {
      return candidate;
    }
  }
  throw new Error(`marketCalendar: no trading day found within 7 days after ${dateKey}`);
}

export type MarketStatus =
  | {
      readonly state: 'open';
      readonly sessionDateKey: string;
      readonly sessionOpenAt: number;
      readonly sessionCloseAt: number;
    }
  | {
      readonly state: 'closed';
      /** The session being *displayed* — the most recently completed one, or today's
       * upcoming one has no data yet, so pre-open shows the previous session. */
      readonly sessionDateKey: string;
      readonly sessionOpenAt: number;
      readonly sessionCloseAt: number;
      readonly nextOpenAt: number;
    };

/**
 * The market's status at `nowMs`, and which trading session is relevant to display.
 *
 * - On a trading day, within [open, close): `'open'`, today's own session.
 * - On a trading day, before open: `'closed'`, showing the *previous* trading day's
 *   completed session (today has no data yet); opens later today.
 * - On a trading day, at/after close: `'closed'`, showing *today's* now-complete
 *   session; opens the next trading day.
 * - On a non-trading day (Friday/Saturday): `'closed'`, showing the most recent prior
 *   trading day's session; opens the next trading day.
 */
export function getMarketStatus(nowMs: number): MarketStatus {
  const today = cairoDateKey(nowMs);
  const parts = getCairoParts(nowMs);
  const openAtToday = cairoEpochFor(today, MARKET_OPEN.hour, MARKET_OPEN.minute);
  const closeAtToday = cairoEpochFor(today, MARKET_CLOSE.hour, MARKET_CLOSE.minute);

  if (isTradingDay(parts.weekday) && nowMs >= openAtToday && nowMs < closeAtToday) {
    return { state: 'open', sessionDateKey: today, sessionOpenAt: openAtToday, sessionCloseAt: closeAtToday };
  }

  if (isTradingDay(parts.weekday) && nowMs < openAtToday) {
    const prevKey = previousTradingDateKey(today);
    return {
      state: 'closed',
      sessionDateKey: prevKey,
      sessionOpenAt: cairoEpochFor(prevKey, MARKET_OPEN.hour, MARKET_OPEN.minute),
      sessionCloseAt: cairoEpochFor(prevKey, MARKET_CLOSE.hour, MARKET_CLOSE.minute),
      nextOpenAt: openAtToday,
    };
  }

  if (isTradingDay(parts.weekday) && nowMs >= closeAtToday) {
    const nextKey = nextTradingDateKey(today);
    return {
      state: 'closed',
      sessionDateKey: today,
      sessionOpenAt: openAtToday,
      sessionCloseAt: closeAtToday,
      nextOpenAt: cairoEpochFor(nextKey, MARKET_OPEN.hour, MARKET_OPEN.minute),
    };
  }

  // Non-trading day (Friday/Saturday).
  const prevKey = previousTradingDateKey(today);
  const nextKey = nextTradingDateKey(today);
  return {
    state: 'closed',
    sessionDateKey: prevKey,
    sessionOpenAt: cairoEpochFor(prevKey, MARKET_OPEN.hour, MARKET_OPEN.minute),
    sessionCloseAt: cairoEpochFor(prevKey, MARKET_CLOSE.hour, MARKET_CLOSE.minute),
    nextOpenAt: cairoEpochFor(nextKey, MARKET_OPEN.hour, MARKET_OPEN.minute),
  };
}

/** Zero-padded `HH:MM:SS` in Cairo time — the one shared formatter `axes.ts` (the
 * chart's x-axis/hover readout) and `StockDetail.tsx` (the header's "as of" timestamp)
 * both call, so those two displays can never drift into two different timezones again
 * (see this module's doc and the git history of this exact bug). */
export function formatCairoClock(epochMs: number): string {
  const { hour, minute, second } = getCairoParts(epochMs);
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
}

/** `HH:MM` in Cairo time, no seconds — for "opens at" copy where second-level
 * precision would be noise (e.g. "opens Sun 10:00 Cairo"). */
export function formatCairoTimeShort(epochMs: number): string {
  const { hour, minute } = getCairoParts(epochMs);
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

/** `"{Weekday} {HH:MM}"` for a closed market's next-open instant (e.g. `"Sun 10:00"`) —
 * the single shared "next open" composition `StockDetail.tsx`'s MARKET CLOSED badge and
 * `StockList.tsx`'s `MarketClosedBanner` both call, instead of each independently
 * combining `CAIRO_WEEKDAY_SHORT_NAMES[getCairoParts(...).weekday]` with
 * `formatCairoTimeShort(...)` inline. Deliberately excludes the word "Cairo" — the two
 * call sites already say so themselves, in their own surrounding copy, and to differing
 * degrees ("... Cairo" vs "... Cairo time"). */
export function formatNextOpen(status: Extract<MarketStatus, { state: 'closed' }>): string {
  const weekday = CAIRO_WEEKDAY_SHORT_NAMES[getCairoParts(status.nextOpenAt).weekday];
  return `${weekday} ${formatCairoTimeShort(status.nextOpenAt)}`;
}

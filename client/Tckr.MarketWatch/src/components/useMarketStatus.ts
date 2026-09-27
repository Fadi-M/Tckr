/**
 * Reactive wrapper around `marketCalendar.getMarketStatus()` for the two pages that need
 * to show a "market closed" badge/banner (`StockDetail`, `StockList`) — a small shared
 * hook rather than two independent copies of the same polling `useEffect`, so both pages
 * agree on how often they re-check and can never drift into checking on different
 * cadences. Deliberately source-agnostic: this reads only wall-clock time via
 * `marketCalendar.ts`, never a `MarketDataSource` (see that module's own doc for why "is
 * the market open" is not a data-source concern).
 */
import { useEffect, useState } from 'react';
import { getMarketStatus, type MarketStatus } from '../data/marketCalendar.ts';

/** A market open/closed *transition* only ever falls on a fixed Cairo clock minute
 * (10:00 or 14:30) — this is far tighter than strictly needed for that, but matches the
 * same human-perceptible cadence every other price on the page repaints at
 * (`DISPLAY_REFRESH_INTERVAL_MS`, `src/display/throttle.ts` — not imported here to keep
 * this component-layer hook independent of the display-layer constant; kept in sync by
 * comment, the same soft coupling used elsewhere in this codebase for this exact
 * value). */
const MARKET_STATUS_REFRESH_MS = 30_000;
/** `setTimeout`'s ceiling (~24.8 days); EGX's longest gap between sessions is days. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function useMarketStatus(): MarketStatus {
  const [status, setStatus] = useState<MarketStatus>(() => getMarketStatus(Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      setStatus(getMarketStatus(Date.now()));
    }, MARKET_STATUS_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // The poll alone would land the open (and the opening bell) up to 30s after 10:00,
  // while the simulator is already trading. So also wake exactly at the next open or
  // close, just past the boundary (`getMarketStatus` counts the open minute as open).
  const nextTransitionAt = status.state === 'open' ? status.sessionCloseAt : status.nextOpenAt;
  useEffect(() => {
    const id = setTimeout(
      () => setStatus(getMarketStatus(Date.now())),
      Math.min(Math.max(0, nextTransitionAt - Date.now()) + 5, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(id);
  }, [nextTransitionAt]);

  return status;
}

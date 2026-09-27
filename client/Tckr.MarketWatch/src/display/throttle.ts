/**
 * Display-refresh throttling — "Tckr First Run" design pass follow-up.
 *
 * The underlying feed can push thousands of ticks/sec for a hot symbol (FR-1: ~25,000
 * events/sec across the whole exchange tape, unevenly weighted toward a handful of
 * symbols). `TickDispatcher` (`src/data/TickDispatcher.ts`) already coalesces that down
 * to at most one *store write* per symbol per animation frame — a data-correctness/
 * perf contract, not a readability one. Even at 60fps, a number that changes 60 times a
 * second reads as noise, not information: human perception of *discrete, symbolic*
 * changes (as opposed to smooth motion) saturates well below the ~60Hz frame rate —
 * commonly cited UX guidance for live-updating text/numeric displays caps meaningful
 * refresh at roughly 1-4 updates/sec (e.g. most retail market-data UIs — Google
 * Finance, brokerage watchlists — visibly refresh on the order of once a second even
 * when their backend feed is much faster; beyond ~4-5 Hz, sequential value changes stop
 * being individually readable and blur into flicker). Tckr paces a calm board below even
 * that low end, in two tiers (product decision, 2026-09-27):
 *
 *  - Prices (`DISPLAY_REFRESH_INTERVAL_MS`, 10s): every row, the hero cards' figures,
 *    the detail header and the chart's live sample. Fast enough that a LIVE board reads
 *    as live (the DELAYED entitlement is 15 *minutes* behind), slow enough that each
 *    change can be caught landing.
 *  - Order (`RANK_REFRESH_INTERVAL_MS`, 20s): re-ranking the board and re-picking the
 *    hero cards. Rows moving under the pointer cost more attention than a number
 *    changing in place, so the order settles at half the price cadence.
 *
 * Paints are aligned to the wall clock (`createThrottle` below), so two views of the same
 * symbol — the selected row and the detail header beside it — repaint on the same beat
 * and can never disagree for a whole window.
 *
 * This is a presentation-layer concern only, layered *on top of* the data layer's own
 * coalescing, not a replacement for it: `StockListRow` still gets the freshest snapshot
 * whenever its throttled callback fires, and `StockDetail` still merges every tick with
 * "newer wins" semantics — only how often that result is *painted* is capped here.
 */

/** Price repaint cadence: 1 update/10s — see module doc for why. */
export const DISPLAY_REFRESH_INTERVAL_MS = 10_000;

/** Board re-rank and hero re-pick cadence: 1 update/20s — see module doc. */
export const RANK_REFRESH_INTERVAL_MS = 20_000;

export interface Throttled<Args extends readonly unknown[]> {
  (...args: Args): void;
  /** Cancels any pending trailing call. Idempotent. Callers must invoke this on
   * teardown (effect cleanup, unmount) so a throttled call never fires after the thing
   * it would update is gone. */
  cancel(): void;
}

/**
 * Leading+trailing throttle over wall-clock slots of `intervalMs` (`[k·interval,
 * (k+1)·interval)` in `Date.now()` time). The first call in a slot fires immediately (so
 * a single, isolated update — the common case away from a hot symbol — is never
 * delayed); further calls in that slot collapse into one trailing call at the next slot
 * boundary, always with the *latest* call's arguments (never a stale one from earlier in
 * the burst). At most one call per slot, and a trailing call is never more than one
 * window late.
 *
 * Slots rather than windows anchored at each instance's own leading call: every throttle
 * with the same interval shares the same boundaries, so independent subscribers to one
 * symbol (a board row and the detail pane) flush the same burst on the same beat.
 */
export function createThrottle<Args extends readonly unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number,
): Throttled<Args> {
  let lastInvokedSlot = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;

  const slotOf = (at: number): number => Math.floor(at / intervalMs);

  function invoke(args: Args): void {
    lastInvokedSlot = slotOf(Date.now());
    pendingArgs = undefined;
    fn(...args);
  }

  function throttled(...args: Args): void {
    const now = Date.now();
    if (slotOf(now) > lastInvokedSlot && timer === undefined) {
      invoke(args);
      return;
    }
    pendingArgs = args;
    if (timer === undefined) {
      timer = setTimeout(
        () => {
          timer = undefined;
          if (pendingArgs !== undefined) {
            invoke(pendingArgs);
          }
        },
        Math.max(0, (slotOf(now) + 1) * intervalMs - now),
      );
    }
  }

  throttled.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pendingArgs = undefined;
  };

  return throttled;
}

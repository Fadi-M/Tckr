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
 * being individually readable and blur into flicker). `DISPLAY_REFRESH_INTERVAL_MS`
 * picks 1 Hz — the low, unambiguously-readable end of that range: every visible number
 * changes at most once a second, giving a viewer a full second to register each value
 * before the next one lands.
 *
 * This is a presentation-layer concern only, layered *on top of* the data layer's own
 * coalescing, not a replacement for it: `StockListRow` still gets the freshest snapshot
 * whenever its throttled callback fires, and `StockDetail` still merges every tick with
 * "newer wins" semantics — only how often that result is *painted* is capped here.
 */

/** 1 update/sec — see module doc for why. */
export const DISPLAY_REFRESH_INTERVAL_MS = 1000;

export interface Throttled<Args extends readonly unknown[]> {
  (...args: Args): void;
  /** Cancels any pending trailing call. Idempotent. Callers must invoke this on
   * teardown (effect cleanup, unmount) so a throttled call never fires after the thing
   * it would update is gone. */
  cancel(): void;
}

/**
 * Leading+trailing throttle: the first call within a fresh window fires immediately
 * (so a single, isolated update — the common case away from a hot symbol — is never
 * delayed), and at most one more call fires at the end of the window if further calls
 * arrived while it was suppressed, always using the *latest* call's arguments (never a
 * stale one from earlier in the burst).
 */
export function createThrottle<Args extends readonly unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number,
): Throttled<Args> {
  let lastInvokedAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;

  function invoke(args: Args): void {
    lastInvokedAt = Date.now();
    pendingArgs = undefined;
    fn(...args);
  }

  function throttled(...args: Args): void {
    const elapsed = Date.now() - lastInvokedAt;
    if (elapsed >= intervalMs && timer === undefined) {
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
        Math.max(0, intervalMs - elapsed),
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

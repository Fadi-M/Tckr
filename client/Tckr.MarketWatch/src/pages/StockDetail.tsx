/**
 * Stock detail page — task 06 (docs/phase-3-web-client/06-stock-detail.md).
 *
 * Owns one symbol's screen and its subscription lifecycle: paint from a snapshot
 * before the first tick arrives, stream from then on, and release the subscription
 * cleanly when the user leaves or switches symbol (client-contract.md §2, §4).
 *
 * ---------------------------------------------------------------------------------
 * Why this file does not read `src/data/store.ts`
 * ---------------------------------------------------------------------------------
 * `store.applySnapshot`/`applyTick` unconditionally overwrite the shared store's
 * cached view — neither compares `exchangeTimestamp`. That is fine for the list page
 * (ticks and the occasional snapshot arrive in the order the simulator emits them),
 * but it cannot honour this page's ordering requirement: "paint the snapshot first,
 * then apply any tick that arrived while it was in flight, keeping whichever is
 * newer." A tick coalesced into the shared store before a slow snapshot resolves
 * would be silently clobbered by `applySnapshot`'s unconditional overwrite the
 * moment that snapshot lands. So this page keeps its own small piece of state for
 * the one symbol it owns, fed directly from `source.on.tick` / `source.on.snapshot`
 * / `getSnapshot()`, and reconciles "newer wins" itself by comparing
 * `exchangeTimestamp` (an ISO-8601 UTC string of fixed width, so plain string
 * comparison is chronological comparison — no `Date` parsing needed). See "Notes for
 * other tasks" in this task's report for the alternative (a timestamp-aware merge in
 * `store.applySnapshot`) if a future task wants one shared code path.
 *
 * ---------------------------------------------------------------------------------
 * `PriceCell` (task 04) and `PriceChart` (task 05)
 * ---------------------------------------------------------------------------------
 * Both landed in the tree while this task was in progress and are used directly
 * below — every price on this page renders through `PriceCell`, and `PriceChart` is
 * mounted keyed by `symbol` so a symbol switch remounts it with no stale point from
 * the previous symbol.
 *
 * `PriceChart` does **not** read `src/data/store.ts` (or any tick stream) itself —
 * this page feeds it `livePrice`, computed below from the exact same `quote` this page
 * is itself displaying as text. This was not always true: an earlier revision had
 * `PriceChart` independently reading the shared store on its own 30-second timer,
 * completely unsynchronized with this page's own 30-second display throttle. Two
 * independently-timed samplers reading the same tape through two different coalescing
 * paths would, at any given instant, very often disagree — the header showing one
 * price, the chart's rightmost point showing another, for the same symbol at the same
 * moment. Since `PriceChart` has exactly one caller (this page), the fix is to give it
 * one shared source of truth instead of two competing ones: `livePrice` below, so the
 * header and the chart can never show two different numbers for "the current price."
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSharedSource, resolveClientConfig } from '../data/config.ts';
import { compare, percentChange, subtract, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import { formatCairoClock, formatNextOpen } from '../data/marketCalendar.ts';
import type { Snapshot, SymbolDefinition } from '../contracts/rest.ts';
import type { IsoUtc, Stream, Tick } from '../contracts/messages.ts';
import { PriceCell } from '../components/PriceCell.tsx';
import { PriceChart, type ChartHistoryPoint } from '../chart/PriceChart.tsx';
import { useMarketStatus } from '../components/useMarketStatus.ts';
import { createThrottle, DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';

const DETAIL_STYLES = `
.tckr-detail { max-width: 760px; margin: 0 auto; }
.tckr-detail__topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.tckr-detail__back { font-size: 0.8rem; color: var(--tckr-color-text-muted); text-decoration: none; border-radius: 3px; transition: color 150ms ease; }
.tckr-detail__back:hover { color: var(--tckr-color-text); }
.tckr-detail__back:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-detail__topbar-badges { display: flex; align-items: center; gap: 8px; }
.tckr-detail__identity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.tckr-detail__symbol { font-family: var(--tckr-font-mono); font-weight: 700; font-size: 1.4rem; letter-spacing: -0.01em; }
.tckr-detail__name { font-size: 0.85rem; color: var(--tckr-color-text-muted); }
.tckr-detail__loading { color: var(--tckr-color-text-muted); }
.tckr-detail__quote { margin-top: 16px; animation: tckr-detail-reveal 220ms cubic-bezier(0.23, 1, 0.32, 1); }
@keyframes tckr-detail-reveal {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.tckr-detail__price-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.tckr-detail__price { font-family: var(--tckr-font-mono); font-weight: 600; font-size: 2.4rem; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tckr-detail__price-delta { font-family: var(--tckr-font-mono); font-weight: 600; font-size: 1rem; font-variant-numeric: tabular-nums; }
.tckr-detail__asof { margin-top: 8px; font-family: var(--tckr-font-mono); font-size: 0.72rem; color: var(--tckr-color-text-muted); }
.tckr-detail__delayed-note {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 9px;
  background: color-mix(in oklab, var(--tckr-color-warning) 9%, transparent);
  border: 1px solid color-mix(in oklab, var(--tckr-color-warning) 24%, transparent);
}
.tckr-detail__delayed-note-icon { flex: none; color: var(--tckr-color-warning); font-size: 14px; }
.tckr-detail__delayed-note-title { font-weight: 600; font-size: 0.82rem; }
.tckr-detail__delayed-note-detail { margin-top: 3px; font-size: 0.78rem; color: var(--tckr-color-text-muted); line-height: 1.5; }
.tckr-detail__stats {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--tckr-color-border);
  border-radius: 9px;
  overflow: hidden;
  animation: tckr-detail-reveal 220ms cubic-bezier(0.23, 1, 0.32, 1) 40ms backwards;
}
.tckr-detail__stat { background: var(--tckr-color-surface-raised); padding: 12px 12px; }
.tckr-detail__stat-label { display: block; font-family: var(--tckr-font-mono); font-size: 0.6rem; letter-spacing: 0.1em; color: var(--tckr-color-text-muted); text-transform: uppercase; }
.tckr-detail__stat-value { display: block; margin-top: 6px; font-family: var(--tckr-font-mono); font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.tckr-detail--not-found { color: var(--tckr-color-text); }
@media (min-width: 480px) {
  .tckr-detail__stats { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
`;

// ---------------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------------

const ZERO_DECIMAL = toDecimal('0');
const FALLBACK_TICK_SIZE = toDecimal('0.01');

/** Signed, 2-decimal percentage text (e.g. "+1.24", "-0.30", "0.00"). Uses
 * `Intl.NumberFormat` rather than any float-parsing/rounding global. */
const percentFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

/** The exchange's own Cairo market time (EGX), regardless of the viewer's own
 * timezone — never local receipt time, and never UTC either (an earlier revision of
 * this function sliced the raw UTC substring directly; this page is explicitly
 * Egyptian-market data, so every timestamp on it, including this one, goes through the
 * same shared `marketCalendar.formatCairoClock` this chart's own x-axis/hover readout
 * uses — see that function's doc for why there must only ever be one implementation of
 * "what time is it, for display purposes, on this page"). */
function formatExchangeTime(iso: IsoUtc): string {
  return formatCairoClock(Date.parse(iso));
}

function formatOffset(ms: number): string {
  if (ms > 0 && ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

/** 'up'/'down' for a nonzero signed change, `null` at exactly zero — the single
 * source of truth for "is this symbol up or down since open" that both the Change
 * indicator's persistent colour and the raw price's flash colour key off of (see
 * `PriceCell`'s `flashDirectionOverride` doc for why the price must not compute its
 * own, different, tick-to-tick answer to that question). */
function deltaDirection(change: DecimalString): 'up' | 'down' | null {
  const direction = compare(change, ZERO_DECIMAL);
  if (direction > 0) return 'up';
  if (direction < 0) return 'down';
  return null;
}

function deltaClassName(change: DecimalString): string | undefined {
  const direction = deltaDirection(change);
  return direction ? `tckr-delta--${direction}` : undefined;
}

// ---------------------------------------------------------------------------------
// Data shape this page renders from — built from `Snapshot`/`Tick` directly, never
// from `src/data/store.ts` (see module doc).
// ---------------------------------------------------------------------------------

interface DetailQuote {
  readonly price: DecimalString;
  readonly change: DecimalString;
  readonly changePercentText: string;
  readonly volume: number;
  readonly exchangeTimestamp: IsoUtc;
  readonly stream: Stream;
}

interface OhlcExtras {
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly exchangeTimestamp: IsoUtc;
}

function quoteFromSnapshot(snapshot: Snapshot): DetailQuote {
  return {
    price: snapshot.price,
    change: snapshot.change,
    changePercentText: snapshot.changePercent,
    volume: snapshot.volume,
    exchangeTimestamp: snapshot.exchangeTimestamp,
    stream: snapshot.stream,
  };
}

/** Merges one tick into the previously-displayed quote, keeping whichever of the two
 * carries the newer `exchangeTimestamp` — the "newer wins" rule from the brief. When
 * `prev` is newer or equal, `prev` is returned unchanged (same reference), so React
 * bails out of re-rendering for a stale/out-of-order tick.
 *
 * `volume` is passed in fully computed (`baselineVolume + volumeSinceBaselineRef.current`
 * from the caller) rather than derived here as `prev.volume + tick.q`. Volume is a
 * cumulative-sum quantity, and this page can coalesce many raw ticks into one merge call
 * (the 30s display throttle, or the single queued tick applied once the snapshot renders)
 * — an incremental `prev.volume + tick.q` would only ever count the one tick that reached
 * this function, silently dropping every other tick's quantity. Every raw tick is instead
 * counted into the accumulator the instant it arrives (see `source.on.tick` below),
 * independent of whether it wins this merge, so the absolute recomputation here is always
 * correct even when this particular tick loses the price/timestamp merge. */
function mergeTickIntoQuote(
  prev: DetailQuote | undefined,
  tick: Tick,
  baseline: DecimalString | undefined,
  volume: number,
): DetailQuote | undefined {
  if (prev && prev.exchangeTimestamp >= tick.t) {
    return prev;
  }
  const effectiveBaseline = baseline ?? tick.p;
  const change = subtract(tick.p, effectiveBaseline);
  const changePercentText = percentFormatter.format(percentChange(effectiveBaseline, tick.p));
  return {
    price: tick.p,
    change,
    changePercentText,
    volume,
    exchangeTimestamp: tick.t,
    stream: tick.st,
  };
}

type Phase = 'loading' | 'ready' | 'not-found';

// ---------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------

export function StockDetail({ symbol }: { symbol: string }) {
  // One shared `MarketDataSource` for the whole app (config.ts's singleton) — it
  // connects itself, exactly once, at first access. This page must never call
  // `.connect()`/`.disconnect()` on it: `StockList` and any future task 07 component
  // share the same instance, so tearing the connection down on this page's unmount
  // would break every other consumer. Connection health is observable via
  // `on.status`/`on.error`/`identity()` on this same instance, not via this call.
  const source = getSharedSource();
  // EGX's real trading calendar (Sunday–Thursday, ~10:00–14:30 Cairo time) — see
  // `marketCalendar.ts`'s doc for why this is computed from wall-clock time directly,
  // independent of `source`. Drives both the "MARKET CLOSED" badge below and
  // `PriceChart`'s `marketOpen` prop, so the two can never disagree about market state.
  const marketStatus = useMarketStatus();

  const [phase, setPhase] = useState<Phase>('loading');
  const [quote, setQuote] = useState<DetailQuote | undefined>(undefined);
  const [extras, setExtras] = useState<OhlcExtras | undefined>(undefined);
  const [universeDef, setUniverseDef] = useState<SymbolDefinition | undefined>(undefined);
  // `undefined` while the session-history fetch is in flight; an array (possibly empty)
  // once it has settled, one way or another. `PriceChart` is only ever rendered once
  // this is an array — see the render below — so a given `PriceChart` instance always
  // receives a stable `history` prop for its whole lifetime (its own doc explains why
  // that matters: it reads `history` once, via a ref, at mount).
  const [historyPoints, setHistoryPoints] = useState<readonly ChartHistoryPoint[] | undefined>(undefined);

  const phaseRef = useRef<Phase>('loading');
  const baselineRef = useRef<DecimalString | undefined>(undefined);
  const queuedTickRef = useRef<Tick | undefined>(undefined);
  // Volume accounting: `volumeBaselineRef` is the last snapshot's absolute `volume`,
  // and `volumeSinceBaselineRef` sums every raw tick's `q` received since that snapshot
  // — updated unconditionally the instant a tick arrives in `source.on.tick` below,
  // before the loading/throttle branching. Displayed volume is always
  // `volumeBaselineRef.current + volumeSinceBaselineRef.current`, an absolute
  // recomputation rather than an incremental add-per-merge, so no burst, throttle
  // window, or queued-tick-replaced-by-a-newer-tick can ever drop a tick's quantity —
  // every tick is counted here regardless of whether it goes on to "win" the
  // price/timestamp merge.
  const volumeBaselineRef = useRef<number>(0);
  const volumeSinceBaselineRef = useRef<number>(0);

  // `historyPoints` must never render stale for a *different* symbol than the one
  // currently being displayed. Unlike `quote`/`phase`/etc. below (reset inside the
  // mount effect, which runs one render *after* the `symbol` prop itself changes), a
  // stale `historyPoints` here would render `PriceChart` for the new `symbol` seeded
  // with the OLD symbol's history for one commit, then immediately unmount and
  // remount it again once the effect clears it — a real, visible chart flicker/
  // mis-seed, not just a harmless stale-text flash. This uses React's documented
  // "adjusting state when a prop changes" pattern (calling `setState` during render,
  // guarded by a comparison) so the reset lands in the very same render pass as the
  // `symbol` change, before anything ever commits or paints.
  const [historyForSymbol, setHistoryForSymbol] = useState(symbol);
  if (historyForSymbol !== symbol) {
    setHistoryForSymbol(symbol);
    setHistoryPoints(undefined);
  }

  // Mount sequence, and the sole effect governing subscribe/unsubscribe lifecycle:
  //   1. issue getSnapshot(symbol)
  //   2. subscribe([symbol]) — right after, not awaiting the snapshot
  //   3. ticks arriving before the snapshot renders are queued, not discarded
  //   4. once the snapshot renders, the queued tick (if any) is applied, newer wins
  // On symbol change, this effect's cleanup (unsubscribe old) runs before the new
  // effect body (subscribe new) — React guarantees that ordering for a dependency
  // change, which is what `symbol-switch` asserts via a shared spy.
  useEffect(() => {
    let cancelled = false;
    phaseRef.current = 'loading';
    baselineRef.current = undefined;
    queuedTickRef.current = undefined;
    volumeBaselineRef.current = 0;
    volumeSinceBaselineRef.current = 0;
    setPhase('loading');
    setQuote(undefined);
    setExtras(undefined);
    setUniverseDef(undefined);
    // `historyPoints` is deliberately not reset here — see `historyForSymbol` above,
    // which resets it synchronously during render instead, before this effect runs.

    function markNotFound(): void {
      if (cancelled || phaseRef.current === 'not-found') {
        return;
      }
      phaseRef.current = 'not-found';
      setPhase('not-found');
    }

    function ingestSnapshot(snapshot: Snapshot): void {
      if (cancelled || snapshot.symbol !== symbol || phaseRef.current === 'not-found') {
        return;
      }
      baselineRef.current = snapshot.open;
      // The snapshot's `volume` is the new absolute baseline; anything accumulated
      // before it is now folded into that baseline, so the running accumulator restarts.
      volumeBaselineRef.current = snapshot.volume;
      volumeSinceBaselineRef.current = 0;
      setExtras((prev) => {
        if (prev && prev.exchangeTimestamp > snapshot.exchangeTimestamp) {
          return prev;
        }
        return {
          open: snapshot.open,
          high: snapshot.high,
          low: snapshot.low,
          exchangeTimestamp: snapshot.exchangeTimestamp,
        };
      });
      setQuote((prev) => {
        if (prev && prev.exchangeTimestamp > snapshot.exchangeTimestamp) {
          return prev;
        }
        return quoteFromSnapshot(snapshot);
      });
      phaseRef.current = 'ready';
      setPhase('ready');
    }

    // A hot symbol's raw tape (this page reads `source.on.tick` directly, uncoalesced —
    // see the module doc above) can carry far more ticks/sec than a human can read as
    // discrete price changes. Throttling how often a live tick is actually painted (not
    // how often it is merged — `mergeTickIntoQuote`'s "newer wins" comparison still
    // considers every tick) keeps the displayed price at the same human-trackable
    // cadence as the list page — see `src/display/throttle.ts`. The queued-tick-before-
    // ready path above is intentionally NOT throttled: that one tick is a correctness
    // path (paint it the moment the snapshot renders), not a live-streaming burst.
    const throttledApplyTick = createThrottle((tick: Tick) => {
      setQuote((prev) =>
        mergeTickIntoQuote(prev, tick, baselineRef.current, volumeBaselineRef.current + volumeSinceBaselineRef.current),
      );
    }, DISPLAY_REFRESH_INTERVAL_MS);

    const unsubSnapshotPush = source.on.snapshot(ingestSnapshot);
    const unsubTick = source.on.tick((tick) => {
      if (tick.s !== symbol || cancelled || phaseRef.current === 'not-found') {
        return;
      }
      // Every raw tick is counted here, unconditionally, the moment it arrives — outside
      // of and unaffected by the throttle below, and regardless of loading/ready phase.
      // This is what guarantees no tick's quantity is ever dropped (see the ref's doc).
      volumeSinceBaselineRef.current += tick.q;
      if (phaseRef.current === 'loading') {
        // Snapshot hasn't rendered yet — hold this tick, do not paint it early. Its
        // quantity is already counted above even though only the latest queued tick
        // survives for price/timestamp display.
        queuedTickRef.current = tick;
        return;
      }
      throttledApplyTick(tick);
    });
    const unsubError = source.on.error((error) => {
      if (error.code === 'UNKNOWN_SYMBOL') {
        markNotFound();
      }
    });
    const unsubEntitlement = source.on.entitlement(() => {
      // A LIVE↔DELAYED stream switch (client-contract.md §3.3: "discard any buffered
      // ticks from the old stream rather than mixing the two on one chart"). Mirrors
      // `src/data/store.ts`'s `resetStream()` — the shared-store path's handling of
      // this exact event — for the parallel quote state this page keeps instead (see
      // the module doc above for why this page doesn't read the store directly):
      // discard the queued tick, clear the displayed quote/extras so no stale
      // old-stream price/badge/change lingers on screen, and drop the change baseline
      // so the next tick or snapshot re-anchors fresh rather than computing a delta
      // against the old stream's baseline. Nothing here forces a re-fetch — same as
      // `resetStream()`, this just clears state and waits for the next tick/snapshot,
      // which `phase === 'loading' || !quote`'s existing "Loading…" branch already
      // renders correctly while that state is cleared.
      queuedTickRef.current = undefined;
      baselineRef.current = undefined;
      volumeBaselineRef.current = 0;
      volumeSinceBaselineRef.current = 0;
      setQuote(undefined);
      setExtras(undefined);
    });

    source
      .getSnapshot(symbol)
      .then((snapshot) => {
        ingestSnapshot(snapshot);
      })
      .catch(() => {
        markNotFound();
      });
    source.subscribe([symbol]);

    // Session history seeds the chart's full line immediately, instead of the chart
    // only ever showing samples that happen to arrive after this page mounts (e.g. a
    // symbol opened at noon for a session that opened at 9:30 should show the whole
    // morning, not a flat line starting at noon). `PriceChart` below is only rendered
    // once `historyPoints` is an array (see the render), so a fetch failure resolves to
    // an empty array rather than blocking the chart forever — the same "don't let this
    // one fetch hold the rest of the page hostage" discipline `getUniverse()`'s own
    // `.catch()` below already uses.
    source
      .getHistory(symbol)
      .then((history) => {
        if (cancelled) {
          return;
        }
        setHistoryPoints(history.points.map((point) => ({ t: Date.parse(point.t), p: point.p })));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setHistoryPoints([]);
      });

    source
      .getUniverse()
      .then((universe) => {
        if (cancelled) {
          return;
        }
        const def = universe.symbols.find((candidate) => candidate.symbol === symbol);
        if (!def) {
          markNotFound();
          return;
        }
        setUniverseDef(def);
      })
      .catch(() => {
        // A universe-fetch failure alone should not hide an otherwise-working page;
        // not-found is decided by the snapshot/error path above.
      });

    return () => {
      cancelled = true;
      throttledApplyTick.cancel();
      unsubSnapshotPush();
      unsubTick();
      unsubError();
      unsubEntitlement();
      source.unsubscribe([symbol]);
    };
    // `source` is the shared singleton (config.ts's `getSharedSource()`) — a stable
    // reference for the app's lifetime, included here for hook-dependency hygiene but
    // never actually varying, so it cannot cause an extra effect run.
  }, [symbol, source]);

  // Applies a tick that arrived while the snapshot was still in flight, once the
  // snapshot has rendered (i.e. once `phase` becomes 'ready') — a separate effect so
  // this runs as its own render pass *after* the snapshot's render has committed,
  // never batched into the same update.
  useEffect(() => {
    if (phase !== 'ready') {
      return;
    }
    const queued = queuedTickRef.current;
    if (!queued) {
      return;
    }
    queuedTickRef.current = undefined;
    setQuote((prev) =>
      mergeTickIntoQuote(prev, queued, baselineRef.current, volumeBaselineRef.current + volumeSinceBaselineRef.current),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, symbol]);

  // The exact value `PriceChart` samples for its live point — see this file's module
  // doc for why this must be the same value as the header, not an independent read of
  // the store. Depending on `quote`'s own identity (not its individual fields) is safe
  // here: `mergeTickIntoQuote` already returns the *same* `prev` reference for a
  // stale/out-of-order tick (see its doc), so `quote` only ever gets a new reference
  // when its content genuinely changed — this `useMemo` never recomputes for nothing.
  const livePrice = useMemo<ChartHistoryPoint | undefined>(() => {
    if (!quote) {
      return undefined;
    }
    return { t: Date.parse(quote.exchangeTimestamp), p: quote.price };
  }, [quote]);

  if (phase === 'not-found') {
    return (
      <div className="tckr-detail tckr-detail--not-found" data-testid="stock-detail-not-found">
        <p>&ldquo;{symbol}&rdquo; is not a symbol in the tradeable universe.</p>
        <p>
          <Link to="/">← back to the list</Link>
        </p>
      </div>
    );
  }

  const delayedOffsetMs = resolveClientConfig().simulated.delayedOffsetMs;
  const tickSize = universeDef?.tickSize ?? FALLBACK_TICK_SIZE;

  return (
    <div className="tckr-detail">
      <style>{DETAIL_STYLES}</style>

      <div className="tckr-detail__topbar">
        <Link to="/" className="tckr-detail__back">
          ← All instruments
        </Link>
        <div className="tckr-detail__topbar-badges">
          <span className="tckr-badge tckr-badge--neutral">SIMULATED DATA</span>
          {quote?.stream === 'LIVE' ? (
            <span className="tckr-badge tckr-badge--live">
              <span className="tckr-badge__dot" aria-hidden="true" />
              LIVE
            </span>
          ) : quote?.stream === 'DELAYED' ? (
            <span className="tckr-badge tckr-badge--delayed">◷ DELAYED</span>
          ) : null}
          {marketStatus.state === 'closed' ? (
            <span className="tckr-badge tckr-badge--delayed" data-testid="market-closed-badge">
              ◷ MARKET CLOSED — opens {formatNextOpen(marketStatus)} Cairo
            </span>
          ) : null}
        </div>
      </div>

      <div className="tckr-detail__identity">
        <h1 className="tckr-detail__symbol">{symbol}</h1>
        <span className="tckr-detail__name">{universeDef?.name ?? ''}</span>
      </div>

      {phase === 'loading' || !quote ? (
        <p className="tckr-detail__loading" data-testid="stock-detail-loading">
          Loading…
        </p>
      ) : (
        <div className="tckr-detail__quote">
          <div className="tckr-detail__price-row">
            <span className="tckr-detail__price" data-testid="stock-detail-price">
              <PriceCell value={quote.price} flashDirectionOverride={deltaDirection(quote.change)} />
            </span>
            <span className="tckr-detail__price-delta">
              <span data-testid="stock-detail-change">
                <PriceCell value={quote.change} sign indicateSign />
              </span>{' '}
              <span data-testid="stock-detail-change-percent" className={deltaClassName(quote.change)}>
                ({quote.changePercentText}%)
              </span>
            </span>
          </div>
          <p className="tckr-detail__asof" data-testid="stock-detail-asof">
            as of {formatExchangeTime(quote.exchangeTimestamp)} Cairo · simulated
            {quote.stream === 'DELAYED' ? (
              <>
                {' '}
                · DELAYED — showing data from a simulated {formatOffset(delayedOffsetMs)} delay window (this is a
                simulation artifact; the real delay is 15 minutes)
              </>
            ) : null}
          </p>
          {quote.stream === 'DELAYED' ? (
            <div className="tckr-detail__delayed-note">
              <span className="tckr-detail__delayed-note-icon" aria-hidden="true">
                ◷
              </span>
              <div>
                <div className="tckr-detail__delayed-note-title">You are on the delayed stream</div>
                <div className="tckr-detail__delayed-note-detail">
                  Your entitlement gives you prices behind the live tape. In this simulation the gap is faked at{' '}
                  {formatOffset(delayedOffsetMs)}; on a real exchange feed it would be 15 minutes.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {historyPoints === undefined ? (
        <p className="tckr-detail__loading" data-testid="stock-detail-chart-loading">
          Loading chart…
        </p>
      ) : (
        <PriceChart
          key={symbol}
          symbol={symbol}
          tickSize={tickSize}
          history={historyPoints}
          livePrice={livePrice}
          marketOpen={marketStatus.state === 'open'}
        />
      )}

      {quote ? (
        <div className="tckr-detail__stats" data-testid="stock-detail-footer">
          <div className="tckr-detail__stat">
            <span className="tckr-detail__stat-label">Open</span>
            <span className="tckr-detail__stat-value">
              <PriceCell value={extras?.open ?? quote.price} />
            </span>
          </div>
          <div className="tckr-detail__stat">
            <span className="tckr-detail__stat-label">High</span>
            <span className="tckr-detail__stat-value">
              <PriceCell value={extras?.high ?? quote.price} />
            </span>
          </div>
          <div className="tckr-detail__stat">
            <span className="tckr-detail__stat-label">Low</span>
            <span className="tckr-detail__stat-value">
              <PriceCell value={extras?.low ?? quote.price} />
            </span>
          </div>
          <div className="tckr-detail__stat">
            <span className="tckr-detail__stat-label">Volume</span>
            <span className="tckr-detail__stat-value">{new Intl.NumberFormat('en-US').format(quote.volume)}</span>
          </div>
          <div className="tckr-detail__stat">
            <span className="tckr-detail__stat-label">Lot</span>
            <span className="tckr-detail__stat-value">{universeDef?.lotSize ?? '—'}</span>
          </div>
          <div className="tckr-detail__stat">
            <span className="tckr-detail__stat-label">Tick</span>
            <span className="tckr-detail__stat-value">
              {universeDef ? <PriceCell value={universeDef.tickSize} /> : '—'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

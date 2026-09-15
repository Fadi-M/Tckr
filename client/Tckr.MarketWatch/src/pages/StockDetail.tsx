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
 * the previous symbol. `PriceChart` reads ticks/snapshots itself from
 * `src/data/store.ts` (see its own module doc) — it does not need this page to push
 * data into it, only to keep the source's subscribe/unsubscribe lifecycle correct,
 * which is this page's job regardless of the chart.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSharedSource, resolveClientConfig } from '../data/config.ts';
import { compare, percentChange, subtract, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import type { Snapshot, SymbolDefinition } from '../contracts/rest.ts';
import type { IsoUtc, Stream, Tick } from '../contracts/messages.ts';
import { PriceCell } from '../components/PriceCell.tsx';
import { PriceChart } from '../chart/PriceChart.tsx';
import { createThrottle, DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';

// ---------------------------------------------------------------------------------
// "Tckr First Run" design pass: timeframe tabs (60S/5M/SESSION).
// ---------------------------------------------------------------------------------
// The store only holds the live view since this chart was opened — there is no
// persisted historical series to slice a real "session" out of (see the design plan's
// architecture notes). A tab therefore just changes how many recent points
// `PriceChart`'s ring buffer retains; switching tabs remounts the chart (already keyed
// by `symbol`, extended here to `${symbol}-${timeframe}`), consistent with
// `PriceChart`'s own "one instance per key" design — no change to that component.
const TIMEFRAMES = ['60S', '5M', 'SESSION'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const TIMEFRAME_CAPACITY: Record<Timeframe, number> = { '60S': 60, '5M': 300, SESSION: 600 };

const DETAIL_STYLES = `
.tckr-detail { max-width: 760px; }
.tckr-detail__topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.tckr-detail__back { font-size: 0.8rem; color: var(--tckr-color-text-muted); text-decoration: none; }
.tckr-detail__back:hover { color: var(--tckr-color-text); }
.tckr-detail__topbar-badges { display: flex; align-items: center; gap: 8px; }
.tckr-detail__identity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.tckr-detail__symbol { font-family: var(--tckr-font-mono); font-weight: 700; font-size: 1.4rem; letter-spacing: -0.01em; }
.tckr-detail__name { font-size: 0.85rem; color: var(--tckr-color-text-muted); }
.tckr-detail__loading { color: var(--tckr-color-text-muted); }
.tckr-detail__quote { margin-top: 16px; }
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
.tckr-detail__timeframes { display: flex; gap: 6px; margin: 20px 0 10px; }
.tckr-detail__tf {
  font: inherit;
  font-family: var(--tckr-font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 6px 11px;
  border-radius: 5px;
  border: 1px solid var(--tckr-color-border);
  background: transparent;
  color: var(--tckr-color-text-muted);
  cursor: pointer;
}
.tckr-detail__tf--active { background: var(--tckr-color-text); color: var(--tckr-color-surface); border-color: var(--tckr-color-text); }
.tckr-detail__stats {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--tckr-color-border);
  border-radius: 9px;
  overflow: hidden;
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

/** `IsoUtc` is fixed-width `YYYY-MM-DDTHH:mm:ss.sssZ`; slicing out `HH:mm:ss` avoids
 * a `Date` round-trip and any locale/timezone dependence — the value shown is always
 * the exchange's own UTC time, exactly as the contract requires (never local receipt
 * time, and never re-based to the viewer's timezone). */
function formatExchangeTime(iso: IsoUtc): string {
  return iso.slice(11, 19);
}

function formatOffset(ms: number): string {
  if (ms > 0 && ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

function deltaClassName(change: DecimalString): string | undefined {
  const direction = compare(change, ZERO_DECIMAL);
  if (direction > 0) return 'tckr-delta--up';
  if (direction < 0) return 'tckr-delta--down';
  return undefined;
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
 * bails out of re-rendering for a stale/out-of-order tick. */
function mergeTickIntoQuote(
  prev: DetailQuote | undefined,
  tick: Tick,
  baseline: DecimalString | undefined,
): DetailQuote | undefined {
  if (prev && prev.exchangeTimestamp >= tick.t) {
    return prev;
  }
  const effectiveBaseline = baseline ?? tick.p;
  const change = subtract(tick.p, effectiveBaseline);
  const changePercentText = percentFormatter.format(percentChange(effectiveBaseline, tick.p));
  const previousVolume = prev?.volume ?? 0;
  return {
    price: tick.p,
    change,
    changePercentText,
    volume: previousVolume + tick.q,
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

  const [phase, setPhase] = useState<Phase>('loading');
  const [quote, setQuote] = useState<DetailQuote | undefined>(undefined);
  const [extras, setExtras] = useState<OhlcExtras | undefined>(undefined);
  const [universeDef, setUniverseDef] = useState<SymbolDefinition | undefined>(undefined);
  const [timeframe, setTimeframe] = useState<Timeframe>('60S');

  const phaseRef = useRef<Phase>('loading');
  const baselineRef = useRef<DecimalString | undefined>(undefined);
  const queuedTickRef = useRef<Tick | undefined>(undefined);

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
    setPhase('loading');
    setQuote(undefined);
    setExtras(undefined);
    setUniverseDef(undefined);

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
      setQuote((prev) => mergeTickIntoQuote(prev, tick, baselineRef.current));
    }, DISPLAY_REFRESH_INTERVAL_MS);

    const unsubSnapshotPush = source.on.snapshot(ingestSnapshot);
    const unsubTick = source.on.tick((tick) => {
      if (tick.s !== symbol || cancelled || phaseRef.current === 'not-found') {
        return;
      }
      if (phaseRef.current === 'loading') {
        // Snapshot hasn't rendered yet — hold this tick, do not paint it early.
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
      // Discard any tick queued under the previous stream rather than let it mix
      // with the new one (client-contract.md §3.3).
      queuedTickRef.current = undefined;
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
    setQuote((prev) => mergeTickIntoQuote(prev, queued, baselineRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, symbol]);

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
        </div>
      </div>

      <div className="tckr-detail__identity">
        <span className="tckr-detail__symbol">{symbol}</span>
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
              <PriceCell value={quote.price} />
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
            as of {formatExchangeTime(quote.exchangeTimestamp)} UTC · simulated
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

      <div className="tckr-detail__timeframes" role="tablist" aria-label="Chart timeframe">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            role="tab"
            aria-selected={timeframe === tf}
            className={`tckr-detail__tf${timeframe === tf ? ' tckr-detail__tf--active' : ''}`}
            onClick={() => setTimeframe(tf)}
          >
            {tf}
          </button>
        ))}
      </div>

      <PriceChart key={`${symbol}-${timeframe}`} symbol={symbol} tickSize={tickSize} capacity={TIMEFRAME_CAPACITY[timeframe]} />

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

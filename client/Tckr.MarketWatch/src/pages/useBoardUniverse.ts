/**
 * The board's instrument universe and its data lifecycle, split out of `StockList`: fetch
 * the universe, subscribe to every symbol, backfill snapshots, seed each row's Session
 * sparkline from history, and release this page's subscriptions on unmount.
 *
 * A rejected `getUniverse()` sets `universeFailed` (the page shows an error with a retry);
 * `retryUniverse()` clears it and fetches again.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { toPlotValue } from '../chart/ringBuffer.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { getSharedSource } from '../data/config.ts';

export interface BoardUniverse {
  /** `null` until the first successful fetch. */
  readonly universe: readonly SymbolDefinition[] | null;
  readonly universeFailed: boolean;
  readonly retryUniverse: () => void;
  /** Per-symbol session history for the sparklines; empty until history arrives. */
  readonly sessionTrends: ReadonlyMap<string, readonly number[]>;
}

export function useBoardUniverse(): BoardUniverse {
  const subscribedRef = useRef<readonly string[]>([]);
  const [universe, setUniverse] = useState<readonly SymbolDefinition[] | null>(null);
  const [universeFailed, setUniverseFailed] = useState(false);
  // Bumping `universeAttempt` re-runs the fetch effect below.
  const [universeAttempt, bumpAttempt] = useReducer((n: number) => n + 1, 0);
  const [sessionTrends, setSessionTrends] = useState<ReadonlyMap<string, readonly number[]>>(
    () => new Map(),
  );

  useEffect(() => {
    // `getSharedSource()` is the one app-wide `MarketDataSource` instance — it connects
    // itself, once, at first access (client-contract.md §3: one connection per client).
    // StockList must not call `.connect()`/`.disconnect()` on it: disconnecting here
    // would kill the connection StockDetail shares. Leaving the route only releases
    // this page's own subscriptions.
    const source = getSharedSource();
    let cancelled = false;

    source
      .getUniverse()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const symbols = response.symbols.map((def) => def.symbol);
        subscribedRef.current = symbols;
        source.subscribe(symbols);
        setUniverse(response.symbols);

        // `subscribe()` above only starts *future* ticks flowing into the shared store —
        // it does not backfill whatever volume the source had already accumulated before
        // this page opened (the simulator/gateway tracks true cumulative volume
        // independent of whether any page is watching). Without this, every row's volume
        // would start from 0 and only reflect ticks received after mount, understating
        // the true figure for as long as the page stays open. `getSnapshot()` already
        // writes its result into the shared store via `applySnapshot` internally (see
        // `SimulatedSource.getSnapshot`/`TckrGatewaySource.getSnapshot`), so there is
        // nothing to do with these results beyond letting them resolve —
        // `StockDetail.tsx` does the equivalent for its one symbol. Fired *after*
        // `setUniverse` (not awaited before it) so the table paints immediately rather
        // than waiting on 34 network/simulator round-trips, and `allSettled` (not `all`)
        // so one symbol's rejected snapshot can never stop the others from applying.
        void Promise.allSettled(symbols.map((s) => source.getSnapshot(s)));

        // One history fetch per symbol, once, to seed every Session sparkline — table rows
        // and hero cards (see `sessionSparkline`). A symbol whose history fails simply keeps the
        // live-accumulating line — the column is decorative, so this never surfaces an error.
        void Promise.allSettled(symbols.map((s) => source.getHistory(s))).then((results) => {
          if (cancelled) {
            return;
          }
          const trends = new Map<string, readonly number[]>();
          results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.points.length > 1) {
              trends.set(
                symbols[index]!,
                result.value.points.map((point) => toPlotValue(point.p)),
              );
            }
          });
          if (trends.size > 0) {
            setSessionTrends(trends);
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setUniverseFailed(true);
        }
      });

    return () => {
      cancelled = true;
      if (subscribedRef.current.length > 0) {
        source.unsubscribe(subscribedRef.current);
        subscribedRef.current = [];
      }
    };
  }, [universeAttempt]);

  const retryUniverse = useCallback(() => {
    setUniverseFailed(false);
    bumpAttempt();
  }, []);

  return { universe, universeFailed, retryUniverse, sessionTrends };
}

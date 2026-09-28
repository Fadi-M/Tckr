/**
 * `StockDetail`'s data lifecycle for one symbol, split out of the component: the
 * snapshot-then-subscribe mount sequence, tick queuing and beat-paced painting, volume
 * accounting, entitlement resets, not-found detection, session history and the universe
 * definition. See `StockDetail.tsx`'s module doc for why this page reads the source
 * directly instead of the shared store.
 */
import { useEffect, useRef, useState } from 'react';
import type { DecimalString } from '../contracts/decimal.ts';
import type { Tick } from '../contracts/messages.ts';
import type { Snapshot, SymbolDefinition } from '../contracts/rest.ts';
import { getSharedSource } from '../data/config.ts';
import { flushPacedSymbol, subscribeBeat } from '../display/pacedViews.ts';
import type { ChartHistoryPoint } from '../chart/PriceChart.tsx';
import { closestInstruments } from './closestInstruments.ts';
import {
  mergeTickIntoQuote,
  quoteFromSnapshot,
  snapshotBaseline,
  type DetailQuote,
  type OhlcExtras,
  type Phase,
} from './detailQuote.ts';

export interface DetailQuoteState {
  readonly phase: Phase;
  readonly quote: DetailQuote | undefined;
  readonly extras: OhlcExtras | undefined;
  readonly universeDef: SymbolDefinition | undefined;
  /** "Did you mean" for a symbol that isn't in the universe, once the universe is known. */
  readonly suggestions: readonly SymbolDefinition[];
  /** `undefined` while the session-history fetch is in flight, then an array (possibly empty). */
  readonly historyPoints: readonly ChartHistoryPoint[] | undefined;
}

export function useDetailQuote(symbol: string): DetailQuoteState {
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
  // "Did you mean" for a symbol that isn't in the universe, once the universe is known.
  const [suggestions, setSuggestions] = useState<readonly SymbolDefinition[]>([]);
  // `undefined` while the session-history fetch is in flight; an array (possibly empty)
  // once it has settled, one way or another. `PriceChart` is only ever rendered once
  // this is an array — see `StockDetail`'s render — so a given `PriceChart` instance always
  // receives a stable `history` prop for its whole lifetime (its own doc explains why
  // that matters: it reads `history` once, via a ref, at mount).
  const [historyPoints, setHistoryPoints] = useState<readonly ChartHistoryPoint[] | undefined>(
    undefined,
  );

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
  //
  // The displayed quote needs the same treatment: left to the effect's reset, the old
  // symbol's price, change and session figures render under the new symbol for one
  // commit, and every `PriceCell` then "moves" to the new symbol's values — a flash
  // (with ▲/▼) for a change that was never a tick.
  const [historyForSymbol, setHistoryForSymbol] = useState(symbol);
  if (historyForSymbol !== symbol) {
    setHistoryForSymbol(symbol);
    setHistoryPoints(undefined);
    setPhase('loading');
    setQuote(undefined);
    setExtras(undefined);
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
      baselineRef.current = snapshotBaseline(snapshot);
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
          baseline: snapshotBaseline(snapshot),
          baselineIsPreviousClose: snapshot.previousClose !== undefined,
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
    // see `StockDetail.tsx`'s module doc) can carry far more ticks/sec than a human can read as
    // discrete price changes. Throttling how often a live tick is actually painted (not
    // how often it is merged — `mergeTickIntoQuote`'s "newer wins" comparison still
    // considers every tick) keeps the displayed price at the same human-trackable
    // cadence as the list page — see `src/display/throttle.ts`. The queued-tick-before-
    // ready path above is intentionally NOT throttled: that one tick is a correctness
    // path (paint it the moment the snapshot renders), not a live-streaming burst.
    //
    // The paint waits for the page's one beat (`subscribeBeat`, `src/display/
    // pacedViews.ts`) rather than a throttle of its own, so this header, the symbol's
    // board row and the board's order all change in the same commit; a leading-edge
    // throttle here used to repaint the header mid-beat, ahead of its own row.
    let pendingTick: Tick | undefined;
    const throttledApplyTick = (tick: Tick): void => {
      if (!pendingTick || tick.t >= pendingTick.t) {
        pendingTick = tick;
      }
    };
    const unsubBeat = subscribeBeat(() => {
      const tick = pendingTick;
      if (!tick || cancelled) {
        return;
      }
      pendingTick = undefined;
      setQuote((prev) =>
        mergeTickIntoQuote(
          prev,
          tick,
          baselineRef.current,
          volumeBaselineRef.current + volumeSinceBaselineRef.current,
        ),
      );
    });

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
      // `StockDetail.tsx`'s module doc for why this page doesn't read the store directly):
      // discard the queued tick, clear the displayed quote/extras so no stale
      // old-stream price/badge/change lingers on screen, and drop the change baseline
      // so the next tick or snapshot re-anchors fresh rather than computing a delta
      // against the old stream's baseline. Nothing here forces a re-fetch — same as
      // `resetStream()`, this just clears state and waits for the next tick/snapshot,
      // which `phase === 'loading' || !quote`'s existing "Loading…" branch already
      // renders correctly while that state is cleared.
      queuedTickRef.current = undefined;
      pendingTick = undefined;
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
    // once `historyPoints` is an array (see `StockDetail`'s render), so a fetch failure resolves to
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
          setSuggestions(closestInstruments(symbol, universe.symbols));
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
      unsubBeat();
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
      mergeTickIntoQuote(
        prev,
        queued,
        baselineRef.current,
        volumeBaselineRef.current + volumeSinceBaselineRef.current,
      ),
    );
  }, [phase, symbol]);

  // Opening a symbol shows its latest (snapshot, a queued tick, then the throttle's
  // leading edge), not the board's last beat; its board row and highlight card catch up
  // to each quote this pane commits instead of showing the previous beat beside it
  // (`src/display/pacedViews.ts`). Two frames later, so `TickDispatcher`'s per-frame
  // store write for the same tick has landed. On a beat the row is already there, so
  // this is a no-op.
  useEffect(() => {
    if (phase !== 'ready' || !quote) {
      return undefined;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => flushPacedSymbol(symbol));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [phase, quote, symbol]);

  return { phase, quote, extras, universeDef, suggestions, historyPoints };
}

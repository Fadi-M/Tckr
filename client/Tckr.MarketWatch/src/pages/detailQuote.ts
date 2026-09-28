/**
 * The quote model `StockDetail` renders from, built from `Snapshot`/`Tick` directly and
 * never from `src/data/store.ts` (see `StockDetail.tsx`'s module doc). Pure functions:
 * a snapshot becomes a quote, and a tick merges into one, newer wins.
 */
import { percentChange, subtract, type DecimalString } from '../contracts/decimal.ts';
import type { IsoUtc, Stream, Tick } from '../contracts/messages.ts';
import type { Snapshot } from '../contracts/rest.ts';
import { formatPercentFigure } from '../display/percent.ts';

export interface DetailQuote {
  readonly price: DecimalString;
  readonly change: DecimalString;
  readonly changePercentText: string;
  readonly volume: number;
  readonly exchangeTimestamp: IsoUtc;
  readonly stream: Stream;
}

export interface OhlcExtras {
  readonly open: DecimalString;
  /** What Change is measured from: the previous close when the snapshot carries it
   * (`Snapshot.previousClose`, EGX convention), else the session open. */
  readonly baseline: DecimalString;
  readonly baselineIsPreviousClose: boolean;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly exchangeTimestamp: IsoUtc;
}

/** The change baseline a snapshot implies — see `OhlcExtras.baseline`. */
export function snapshotBaseline(snapshot: Snapshot): DecimalString {
  return snapshot.previousClose ?? snapshot.open;
}

export function quoteFromSnapshot(snapshot: Snapshot): DetailQuote {
  // Recomputed from the baseline rather than taken from `snapshot.change`, which the
  // contract defines as "since the open".
  const baseline = snapshotBaseline(snapshot);
  return {
    price: snapshot.price,
    change: subtract(snapshot.price, baseline),
    changePercentText: formatPercentFigure(percentChange(baseline, snapshot.price)),
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
 * (the 10s display throttle, or the single queued tick applied once the snapshot renders)
 * — an incremental `prev.volume + tick.q` would only ever count the one tick that reached
 * this function, silently dropping every other tick's quantity. Every raw tick is instead
 * counted into the accumulator the instant it arrives (the `source.on.tick` handler in `useDetailQuote.ts`),
 * independent of whether it wins this merge, so the absolute recomputation here is always
 * correct even when this particular tick loses the price/timestamp merge. */
export function mergeTickIntoQuote(
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
  const changePercentText = formatPercentFigure(percentChange(effectiveBaseline, tick.p));
  return {
    price: tick.p,
    change,
    changePercentText,
    volume,
    exchangeTimestamp: tick.t,
    stream: tick.st,
  };
}

export type Phase = 'loading' | 'ready' | 'not-found';

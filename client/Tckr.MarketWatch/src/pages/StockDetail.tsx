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
 * `PriceChart` independently reading the shared store on its own display-cadence timer,
 * completely unsynchronized with this page's own display throttle. Two
 * independently-timed samplers reading the same tape through two different coalescing
 * paths would, at any given instant, very often disagree — the header showing one
 * price, the chart's rightmost point showing another, for the same symbol at the same
 * moment. Since `PriceChart` has exactly one caller (this page), the fix is to give it
 * one shared source of truth instead of two competing ones: `livePrice` below, so the
 * header and the chart can never show two different numbers for "the current price."
 *
 * ---------------------------------------------------------------------------------
 * "Frosted Glass Revamp" — the "MARKET CLOSED" indicator is gone
 * ---------------------------------------------------------------------------------
 * This page used to render a closed badge next to the symbol identity and pass a
 * `marketOpen` boolean into `PriceChart`. Both are gone as of this redesign (the page
 * still reads `useMarketStatus`, but only to describe the chart ranges and the as-of line) — a deliberate product decision, not an
 * oversight, matching the design import (which has no such indicator anywhere on the
 * detail screen). Product has signed off on this removal. This creates a known,
 * accepted asymmetry with `StockList.tsx`, whose `MarketClosedBanner` is unchanged —
 * the two pages are allowed to disagree on this point. See `docs/requirements.md`'s
 * FR-7.4 amendment for the parallel "removed a status indicator, product signed off,
 * recoverable via git log" decision on `SimulatedBanner` (this specific removal has
 * no numbered FR of its own, so it isn't recorded there directly). If a future
 * requirement needs the closed badge/`marketOpen` prop back, `git log` has the
 * removed code (see `StockDetail.market-closed.test.tsx`, deleted in the same
 * revamp) to restore verbatim.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { getSharedSource } from '../data/config.ts';
import { compare, percentChange, subtract, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import { formatCairoClock, formatCairoDateShort } from '../data/marketCalendar.ts';
import { describeRange, pointsInRange, RANGE_KEYS, type RangeKey } from './chartRanges.ts';
import { DETAIL_HEADING_ID } from './pageAnchors.ts';
import { closestInstruments } from './closestInstruments.ts';
import { symbolPath } from './routes.ts';
import type { Snapshot, SymbolDefinition } from '../contracts/rest.ts';
import type { IsoUtc, Stream, Tick } from '../contracts/messages.ts';
import { DELTA_TONE_CLASSES } from '../components/deltaTone.ts';
import { ArrowLeftIcon, CloseIcon } from '../components/icons.tsx';
import { PriceCell } from '../components/PriceCell.tsx';
import { TickingText } from '../components/RollingText.tsx';
import { streamDelay } from '../components/streamDelay.ts';
import { useMarketStatus } from '../components/useMarketStatus.ts';
import { isHeld, useConnectionState } from '../components/useConnectionState.ts';
import { HeldTag } from '../components/HeldTag.tsx';
import { useViewTransitionNavigate } from '../components/useViewTransitionNavigate.ts';
import { PriceChart, type ChartHistoryPoint } from '../chart/PriceChart.tsx';
import { ChartSkeleton } from '../chart/ChartSkeleton.tsx';
import {
  DETAIL_PANEL_CLASS,
  PriceBlockSkeleton,
  RANGE_PILL_BASE_CLASSES,
  RANGE_PILL_VARIANT_CLASSES,
  rangePillClassName,
  StatSkeleton,
  StatTile,
  useChartHeight,
} from './detailChrome.tsx';
import { flushPacedSymbol, subscribeBeat } from '../display/pacedViews.ts';
import { formatPercentFigure } from '../display/percent.ts';
import { useMotion } from '../motion/motion.ts';

/* Card/stat glass values below are taken directly from the design import
   ("Tckr.MarketWatch Frosted Glass Revamp/Tckr Market Watch.dc.html") rather than
   reusing this app's general-purpose glass tokens, so this card matches it exactly
   (the mock's own blur/opacity/radius numbers differ slightly, element by element,
   from the shared --tckr-glass-* tokens used elsewhere). They are not hardcoded
   literals, though: the card/stat elements below use the `bg-glass-card`/
   `border-glass-border-card` and `bg-glass-stat`/`border-glass-border-stat` Tailwind
   utilities, which reference their own dedicated tokens (--tckr-glass-bg-card/
   -border-card, --tckr-glass-bg-stat/-border-stat in tokens.css) for exactly this
   pixel-matching reason, rather than the general-purpose --tckr-glass-bg/
   --tckr-glass-bg-strong tokens used elsewhere, which carry different values.
   Because those custom properties already change value for dark mode inside
   tokens.css, no separate dark-mode override is needed here — the base utility
   picks up the right value in both themes automatically. The blur radii (26px card
   / 20px stat) and border radii (22px card / 16px stat) are likewise mock-specific
   and mostly don't land on Tailwind's default scale (16px stat radius is the
   exception — `rounded-2xl`), so most of these are arbitrary values rather than
   theme steps — same reasoning applies to several unusual font sizes below (e.g.
   1.875rem, 0.65625rem). */

// ---------------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------------

const ZERO_DECIMAL = toDecimal('0');
const FALLBACK_TICK_SIZE = toDecimal('0.01');

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

// Base layout/type classes shared by every state of the Change/Change% pill, kept
// separate from the colour variant below so the two never fight over the same
// property (a neutral-state `bg-surface-raised` and an up/down `bg-[color-mix(...)]`
// both present on one element would leave Tailwind's generated-CSS source order,
// not the className string's order, deciding which background wins).
const DELTA_PILL_BASE_CLASSES =
  'inline-flex items-center font-mono text-body font-semibold py-1.5 px-3 rounded-full tabular-nums [transition:background-color_600ms_var(--tckr-ease-out),color_600ms_var(--tckr-ease-out)]';

/** Full className for the Change/Change% pill — base layout classes plus whichever
 * colour variant `deltaDirection` selects (falling back to the neutral/zero-change
 * variant). Replaces the old `tckr-delta--up`/`tckr-delta--down` modifier classes
 * that `.tckr-detail__delta-pill.tckr-delta--up`/`--down` keyed off of in the
 * pre-Tailwind CSS. */
function deltaGlyph(change: DecimalString): JSX.Element | null {
  const direction = deltaDirection(change);
  if (direction === null) {
    return null;
  }
  return (
    <span aria-hidden="true" className="mr-1.5 text-[0.7em] align-[0.1em]">
      {direction === 'up' ? '▲' : '▼'}
    </span>
  );
}

/** One of the session figures under the detail card: a tracked label over a value. */
/** The session's move from its own open, under the Open tile: the page's headline Change
 * is from the previous close (EGX convention), and this is the other number a trader
 * asks for — how today has gone since the bell. Sign and ▲/▼ carry the direction, the
 * tone colours it. */
function SinceOpen({ open, price }: { open: DecimalString; price: DecimalString }): JSX.Element {
  const move = subtract(price, open);
  const direction = compare(move, ZERO_DECIMAL);
  const tone = direction > 0 ? 'text-up' : direction < 0 ? 'text-down' : 'text-text-muted';
  const glyph = direction > 0 ? '▲ ' : direction < 0 ? '▼ ' : '';
  return (
    <span className={tone}>
      {glyph}
      {formatPercentFigure(percentChange(open, price))}% since open
    </span>
  );
}

const RANGE_STORAGE_KEY = 'tckr.chartRange';

/** The chart range the viewer last chose, else SESSION. Browser storage is a per-viewer
 * convenience here and can be missing or throw (private mode, blocked storage). */
function storedRange(): RangeKey {
  try {
    const stored = window.localStorage.getItem(RANGE_STORAGE_KEY);
    return RANGE_KEYS.find((key) => key === stored) ?? 'SESSION';
  } catch {
    return 'SESSION';
  }
}

function storeRange(key: RangeKey): void {
  try {
    window.localStorage.setItem(RANGE_STORAGE_KEY, key);
  } catch {
    // Not remembered; the choice still applies to this page.
  }
}

/** A session figure the page doesn't have yet. Never the current price standing in for
 * it: an Open, High or Low that is really the last trade is a made-up number. */
function NoFigure(): JSX.Element {
  return (
    <span className="text-text-muted" aria-label="not available yet">
      —
    </span>
  );
}


function deltaClassName(change: DecimalString): string {
  const direction = deltaDirection(change);
  return `${DELTA_PILL_BASE_CLASSES} ${DELTA_TONE_CLASSES[direction ?? 'flat']}`;
}

// ---------------------------------------------------------------------------------
// Chart range selector (design import: the 60S/5M/SESSION pills on the detail
// card). What each range covers and how it is named lives in `chartRanges.ts`; this
// page filters the already-fetched `historyPoints` down to that window rather than
// fetching a differently-scoped history per range — there is
// only one `getHistory()` call for the whole session (see the mount effect below),
// and every range is a view onto that same data. Picking a narrower range does not
// make the chart continuously re-slide the window as time passes (it snapshots
// "the last N seconds as of the moment you picked it," then grows live from there
// exactly like SESSION does) — a real, understood simplification, not a fake one:
// every point shown is genuine, never fabricated to look busier than the real tape
// is. `PriceChart` is remounted (via a `range`-inclusive `key`, see the render
// below) on a range switch rather than reactively re-seeded in place, reusing its
// existing mount-time seeding logic instead of adding a second, parallel "apply a
// new history after mount" code path to an already-intricate component.
// ---------------------------------------------------------------------------------

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
  /** What Change is measured from: the previous close when the snapshot carries it
   * (`Snapshot.previousClose`, EGX convention), else the session open. */
  readonly baseline: DecimalString;
  readonly baselineIsPreviousClose: boolean;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly exchangeTimestamp: IsoUtc;
}

/** The change baseline a snapshot implies — see `OhlcExtras.baseline`. */
function snapshotBaseline(snapshot: Snapshot): DecimalString {
  return snapshot.previousClose ?? snapshot.open;
}

function quoteFromSnapshot(snapshot: Snapshot): DetailQuote {
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

type Phase = 'loading' | 'ready' | 'not-found';


/** The price panel's edge while the stream is held — the board card's amber treatment. */
const DETAIL_HELD_EDGE =
  'border-[color-mix(in_oklab,var(--tckr-color-warning)_45%,transparent)]! outline outline-offset-0 outline-[color-mix(in_oklab,var(--tckr-color-warning)_20%,transparent)]';

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
  // Which chart range pill is active (design import: 60S/5M/SESSION) — see the
  // "Chart range selector" module doc above. Deliberately not reset when `symbol`
  // changes: a viewer's chosen zoom level is a preference about how they want to
  // look at a chart, not per-symbol state, so it carries over to whichever symbol
  // they open next (same reasoning as `sortState` surviving a search on the list
  // page).
  //
  // The first range is the whole SESSION, open or closed: opening a symbol asks "how is
  // today going", and 60S at a 10s beat is six points of zig-zag. Whatever range the
  // user picks is remembered for the next symbol and the next visit (`storedRange`).
  const marketStatus = useMarketStatus();
  // The pane sticks beside the board, often long after the page's connection banner has
  // scrolled away, so it marks held prices itself (see `useConnectionState`).
  const held = isHeld(useConnectionState().state);
  const closeDetail = useViewTransitionNavigate();
  const [range, setRangeState] = useState<RangeKey>(storedRange);
  const setRange = (key: RangeKey): void => {
    setRangeState(key);
    storeRange(key);
  };
  const chartHeight = useChartHeight();

  const [phase, setPhase] = useState<Phase>('loading');
  const [quote, setQuote] = useState<DetailQuote | undefined>(undefined);
  const [extras, setExtras] = useState<OhlcExtras | undefined>(undefined);
  const [universeDef, setUniverseDef] = useState<SymbolDefinition | undefined>(undefined);
  // "Did you mean" for a symbol that isn't in the universe, once the universe is known.
  const [suggestions, setSuggestions] = useState<readonly SymbolDefinition[]>([]);
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
    // see the module doc above) can carry far more ticks/sec than a human can read as
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
        mergeTickIntoQuote(prev, tick, baselineRef.current, volumeBaselineRef.current + volumeSinceBaselineRef.current),
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
      // the module doc above for why this page doesn't read the store directly):
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
      mergeTickIntoQuote(prev, queued, baselineRef.current, volumeBaselineRef.current + volumeSinceBaselineRef.current),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The chart's data window and caption for the active range pill — see the "Chart
  // range selector" module doc and `chartRanges.ts`. Recomputed on every render where `historyPoints`/`range` change, which is fine:
  // `PriceChart` only ever reads this once at mount (via the `key` below causing a
  // fresh mount per range), so a cheap recompute here does not cause extra chart work.
  const chartRange = useMemo(() => describeRange(range, marketStatus, Date.now()), [range, marketStatus]);
  const rangeDescriptions = useMemo(
    () => new Map(RANGE_KEYS.map((key) => [key, describeRange(key, marketStatus, Date.now()).description])),
    [marketStatus],
  );
  const rangedHistory = useMemo(
    () => (historyPoints === undefined ? undefined : pointsInRange(historyPoints, chartRange)),
    [historyPoints, chartRange],
  );

  // The pane's arrival (DESIGN.md › Detail reveal): the panel's glass fades up (CSS),
  // then what is on it lands in reading order — the symbol and the range pills, then,
  // once the first quote is in, the price, its as-of line and the four stat tiles.
  // Replays when the symbol changes (the pane is not remounted for a switch); never for
  // a range change or a tick. Runs inside the view transition's live "new" view, so it
  // plays while the pane slides in.
  const revealRef = useRef<HTMLDivElement | null>(null);
  const hasQuote = quote !== undefined && phase === 'ready';
  useMotion(
    revealRef,
    ({ gsap }) => {
      gsap.from('[data-reveal="frame"]', { opacity: 0, y: 6, duration: 0.32, stagger: 0.05 });
    },
    [symbol],
  );
  useMotion(
    revealRef,
    hasQuote
      ? ({ gsap }) => {
          gsap.from('[data-reveal="figures"]', { opacity: 0, y: 6, duration: 0.32, stagger: 0.04, delay: 0.06 });
        }
      : null,
    [symbol, hasQuote],
  );

  if (phase === 'not-found') {
    return (
      <div className={`${DETAIL_PANEL_CLASS} gap-3 text-text`} data-testid="stock-detail-not-found">
        <h2 id={DETAIL_HEADING_ID} tabIndex={-1} className="font-semibold text-title outline-none">
          No EGX instrument called &ldquo;<span className="font-mono">{symbol}</span>&rdquo;
        </h2>
        {suggestions.length > 0 ? (
          <>
            <p className="text-small text-text-muted">Did you mean</p>
            <div className="flex gap-2 flex-wrap">
              {suggestions.map((def) => (
                <Link
                  key={def.symbol}
                  to={symbolPath(def.symbol)}
                  className="inline-flex items-baseline gap-2 rounded-[7px] border border-border px-3.5 py-2 text-caption no-underline text-text fine-hover:bg-[color-mix(in_oklab,var(--tckr-color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 active:scale-[0.96] [transition:background-color_150ms_ease,transform_120ms_ease-out]"
                >
                  <span className="font-mono font-semibold">{def.symbol}</span>
                  <span className="text-text-muted">{def.name}</span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <p className="text-small text-text-muted">Check the ticker, or find it on the board.</p>
        )}
        {/* Phones already have "All instruments" in the row above the pane. */}
        <p className="max-[800px]:hidden">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-caption text-text-muted no-underline fine-hover:text-text focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 rounded-[4px]"
          >
            <ArrowLeftIcon size={14} />
            All instruments
          </Link>
        </p>
      </div>
    );
  }

  const delay = streamDelay();
  const tickSize = universeDef?.tickSize ?? FALLBACK_TICK_SIZE;

  return (
    <div ref={revealRef} className="flex flex-col gap-3">
      <div
        className={`${DETAIL_PANEL_CLASS} gap-4 [transition:border-color_250ms_ease,outline-color_250ms_ease]${held ? ` ${DETAIL_HELD_EDGE}` : ''}`}
        data-held={held || undefined}
      >
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div className="max-[640px]:pr-11">
            <div data-reveal="frame" className="flex items-baseline gap-3 flex-wrap">
              {/* h2: the page's h1 is the board ("Tckr Market Watch"); the open
                  symbol is a section of it. Focusable (not tabbable) so StockList can
                  move focus here when opening the detail hides the focused row. */}
              <h2
                id={DETAIL_HEADING_ID}
                tabIndex={-1}
                className="font-mono font-semibold text-headline tracking-[0.01em] outline-none"
                data-testid="stock-detail-symbol"
              >
                {symbol}
              </h2>
              <span className="text-body text-text-muted">{universeDef?.name ?? ''}</span>
            </div>

            {phase === 'loading' || !quote ? (
              <PriceBlockSkeleton symbol={symbol} testId="stock-detail-loading" />
            ) : (
              <>
                <div data-reveal="figures" className="flex items-center gap-3.5 mt-2.5 flex-wrap">
                  <span
                    className="font-mono font-semibold text-display tracking-[-0.02em] tabular-nums"
                    data-testid="stock-detail-price"
                  >
                    <PriceCell value={quote.price} flashDirectionOverride={deltaDirection(quote.change)} flashGlyph={false} />
                  </span>
                  {/* ▲/▼ leads the pair, as it does on the board's Change column: the
                      tint alone is colour-only (DESIGN.md, Color-Plus-Signal Rule). The
                      two pills wrap as one unit, so on a narrow pane the move reads as
                      one fact beneath the price instead of splitting across lines. */}
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className={deltaClassName(quote.change)} data-testid="stock-detail-change">
                      {deltaGlyph(quote.change)}
                      <PriceCell value={quote.change} sign flashGlyph={false} />
                    </span>
                    <span className={deltaClassName(quote.change)} data-testid="stock-detail-change-percent">
                      <TickingText text={`${quote.changePercentText}%`} direction={deltaDirection(quote.change) ?? 'up'} />
                    </span>
                  </span>
                </div>
                <p data-reveal="figures" className="mt-2 font-mono text-caption text-text-muted" data-testid="stock-detail-asof">
                  {held ? (
                    <>
                      <HeldTag testId="stock-detail-held" />{' '}
                    </>
                  ) : null}
                  {/* Outside continuous trading the last trade can be days old, so the
                      date is part of the fact; during the session the time alone is. */}
                  as of{' '}
                  {marketStatus.state === 'open'
                    ? formatExchangeTime(quote.exchangeTimestamp)
                    : `${formatCairoDateShort(Date.parse(quote.exchangeTimestamp))}, ${formatExchangeTime(quote.exchangeTimestamp)}`}{' '}
                  Cairo
                  {quote.stream === 'DELAYED' ? ` · DELAYED ${delay.short}${delay.simulated ? ' (simulated)' : ''}` : null}
                  {held ? <span className="text-text"> · stream down, price not moving</span> : null}
                </p>
              </>
            )}
          </div>

          <div data-reveal="frame" className="flex items-center gap-1.5 flex-none">
            {RANGE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={rangePillClassName(range === key)}
                aria-pressed={range === key}
                // The visible label leads the accessible name (WCAG 2.5.3), so "click
                // 60S" works for voice control; the description follows it.
                aria-label={`${key}, ${rangeDescriptions.get(key) ?? ''}`}
                title={rangeDescriptions.get(key)}
                onClick={() => setRange(key)}
              >
                {key}
              </button>
            ))}
            {/* The pane's own way out, beside the controls it belongs to (Escape and the
                list's "All instruments" pill do the same). Focus returns to the row. On a
                phone the pills wrap under the price, so the close pins to the card's
                top-right corner, where a sheet's close is expected. */}
            <button
              type="button"
              className={`${RANGE_PILL_BASE_CLASSES} ${RANGE_PILL_VARIANT_CLASSES.inactive} ml-1.5 px-2! inline-flex items-center fine-hover:text-text max-[640px]:absolute max-[640px]:top-[18px] max-[640px]:right-[18px] max-[640px]:ml-0`}
              aria-label={`Close ${symbol} details`}
              title="Close (Esc)"
              onClick={() => closeDetail('/')}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        {rangedHistory === undefined ? (
          <div data-testid="stock-detail-chart-loading">
            <span className="sr-only">Loading chart…</span>
            <ChartSkeleton height={chartHeight} />
          </div>
        ) : (
          <PriceChart
            key={`${symbol}:${range}`}
            symbol={symbol}
            tickSize={tickSize}
            history={rangedHistory}
            livePrice={livePrice}
            rangeLabel={chartRange.label}
            height={chartHeight}
            // Change on this page is measured from the previous close (else the open),
            // so that is the line a move is read against. SESSION only: on the 60S/5M
            // windows it can sit far outside the recent range and would flatten the line.
            referencePrice={range === 'SESSION' ? extras?.baseline : undefined}
            referenceLabel={extras?.baselineIsPreviousClose === false ? 'Open' : 'Prev'}
            referenceDescription={extras?.baselineIsPreviousClose === false ? 'open' : 'previous close'}
            // Same up/down/unchanged the Change pills show: green, red, or ink.
            direction={quote ? deltaDirection(quote.change) : null}
          />
        )}
      </div>

      {/* One set of tiles, loading or not: their labels are known before any figure,
          so only each value swaps from its skeleton to the figure (and staggers in). */}
      <div className="flex flex-col gap-2.5" data-testid={quote ? 'stock-detail-footer' : 'stock-detail-footer-loading'}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
          <StatTile
            label="Open"
            note={quote && extras?.baselineIsPreviousClose ? <SinceOpen open={extras.open} price={quote.price} /> : undefined}
          >
            {!quote ? <StatSkeleton /> : extras ? <PriceCell value={extras.open} flashGlyph={false} /> : <NoFigure />}
          </StatTile>
          <StatTile label="High">
            {!quote ? <StatSkeleton /> : extras ? <PriceCell value={extras.high} flashGlyph={false} /> : <NoFigure />}
          </StatTile>
          <StatTile label="Low">
            {!quote ? <StatSkeleton /> : extras ? <PriceCell value={extras.low} flashGlyph={false} /> : <NoFigure />}
          </StatTile>
          <StatTile label="Volume">{!quote ? <StatSkeleton /> : new Intl.NumberFormat('en-US').format(quote.volume)}</StatTile>
        </div>
      </div>
    </div>
  );
}

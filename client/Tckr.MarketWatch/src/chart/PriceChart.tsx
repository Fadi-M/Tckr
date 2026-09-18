/**
 * Price-vs-time chart for one symbol (task 05, docs/phase-3-web-client/05-price-chart.md).
 * uPlot draws the line; this file's only job is to feed it correctly and rarely.
 *
 * Render-path discipline (README.md design decision #4/#8/#9, and the whole reason this
 * task exists): exactly **one** `uPlot` instance is created per mount, destroyed on
 * unmount, and never re-created except when `symbol` changes.
 *
 * The plotted series is a *sample* of the price, taken at most once per
 * `DISPLAY_REFRESH_INTERVAL_MS` (`src/display/throttle.ts` — the same human-readable
 * cadence every other price on the page repaints at) — it is deliberately **not** a
 * record of every raw tick. A hot symbol's raw tape can carry hundreds of ticks inside
 * one window; pushing every one of them into the bounded `RingBuffer` (as an earlier
 * version of this file did) meant the buffer — sized for "N recent *samples*", not "N
 * recent *ticks*" — filled up and evicted its own contents *within a single window*, so
 * each scheduled redraw showed a completely different, much shorter slice of time than
 * the one before it: a flat stub one moment, a wildly different few-hundred-millisecond
 * sliver the next, even though the underlying price had simply drifted smoothly. That is
 * the opposite of what a price history chart is for. Sampling once per window instead
 * means every redraw only ever *appends* one point to what was already there — the line
 * never reshuffles or jumps to an unrelated window, it just grows, exactly like the
 * text prices elsewhere on the page.
 *
 * The very first sample is taken as soon as data exists, not on the first interval tick:
 * immediately on mount if the `livePrice` prop already has a value (`seed` below), or
 * otherwise the moment that prop first becomes defined (`StockDetail` fetches its
 * snapshot asynchronously, so it is frequently still `undefined` when this component
 * mounts; waiting a full window to show data that already arrived would mean sitting on
 * an empty chart for no reason). That first sample is paired with one synthetic point a
 * second earlier at the same price (`seedFlatPoint` below) — a single point cannot
 * render a visible line, since uPlot needs two x-values to draw a segment, and
 * `points: { show: false }` means there is no marker fallback either. Every sample after
 * that is real, taken by the fixed `setInterval` below reading whatever `livePriceRef`'s
 * *current* value is at that moment — this is the same "read fresh state when the timer
 * fires" contract `StockListRow`'s "Last update" clock uses, not a queue of buffered
 * values.
 *
 * Why `livePrice` is a prop, not an independent store read (the bug this fixes):
 * an earlier revision of this file read `src/data/store.ts`'s `getSymbolSnapshot`/
 * `subscribeSymbol` directly, on its own `setInterval`, completely independently of
 * `StockDetail`'s own displayed price (which is computed on `StockDetail`'s *own*,
 * separately-timed 30s throttle, merging the uncoalesced raw tick stream with its own
 * "newer wins" ordering rules — see that file's module doc for why it cannot simply
 * read the shared store either). Two independently-timed 30-second samplers reading the
 * same underlying tape through two different coalescing paths will, at any given
 * instant, very often land on *different* ticks — so the big price header and the
 * chart's rightmost plotted point would show two different numbers for the same symbol
 * at the same moment, despite both being individually "correct" relative to their own
 * sampling instant. `PriceChart` is used by exactly one page (`StockDetail`), so instead
 * of maintaining a second, competing view of "the current price," this component is fed
 * the *exact same* value `StockDetail` already computed and is currently displaying as
 * text — see the `livePrice` prop below. This guarantees the header and the chart's
 * live-sampled point can never disagree: they trace back to one shared value, not two
 * independent reads of the tick stream.
 *
 * The only place a `DecimalString` price becomes a JS `number` is `ringBuffer.ts`'s
 * `toPlotValue`, called here once per pushed point. Every value this component renders
 * as text — axis labels, the crosshair readout — goes through `axes.ts`, which formats
 * from that same number back through `contracts/decimal.ts`, never a raw fixed-decimal
 * stringify. See `ringBuffer.ts`'s module doc for the full boundary argument.
 *
 * Lifecycle note: this component does **not** call `MarketDataSource.subscribe` /
 * `unsubscribe` — starting and stopping the underlying tick stream for a symbol is
 * task 06's job (`StockDetail`, out of scope per the brief). This component does not
 * read the tick stream at all; it only ever plots `history` and `livePrice`, both fed
 * to it as props.
 *
 * Stream-discard correctness (client-contract.md §3.3): when the server moves a client
 * between LIVE and DELAYED, buffered ticks from the old stream must be discarded, not
 * left mixed with new-stream ticks on the same chart — that mix is the exact failure
 * the contract calls out as the one the whole system exists to prevent. `store.ts`
 * exposes `onStreamDiscard`, fired by `resetStream()` as its last step, strictly after
 * every per-symbol view has been cleared and re-anchored to its reference price; this
 * component subscribes to it (for its whole lifetime, independent of `symbol`) and
 * clears its own `RingBuffer` and the plotted series in response. This is the one
 * remaining dependency on `src/data/**` — no import from `src/components/**` anywhere
 * in `src/chart/**`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { DecimalString } from '../contracts/decimal.ts';
import { onStreamDiscard } from '../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';
import { RingBuffer, toPlotValue } from './ringBuffer.ts';
import { X_AXIS_INCREMENTS_MS, formatXAxisLabel, formatYAxisLabel } from './axes.ts';
import './priceChart.css';

/** One point of session history, already converted to this component's own numeric/x
 * representation (`t`: epoch ms, matching `SymbolView.lastUpdate`'s convention) — the
 * page (task 06) fetches `MarketDataSource.getHistory()` and converts its `IsoUtc`
 * timestamps once before handing points down, so this file never parses a date string
 * (see the module doc's "one place a price becomes a number" boundary — this is that
 * same boundary's sibling for time). */
export interface ChartHistoryPoint {
  readonly t: number;
  readonly p: DecimalString;
}

export interface PriceChartProps {
  readonly symbol: string;
  readonly tickSize: DecimalString;
  readonly capacity?: number;
  readonly height?: number;
  /**
   * The full session's price history, oldest first, fetched once by the parent page
   * (task 06) before this component is ever mounted for `symbol` — the parent renders
   * `PriceChart` only once its `getHistory()` call has resolved (even to an empty
   * array), so a given `PriceChart` instance sees a stable value for its whole
   * lifetime and this can safely be read once at mount via a ref (see `historyRef`
   * below), the same pattern `tickSizeRef`/`heightRef`/`capacityRef` already use.
   * Omitted or empty behaves exactly as this component always has: seed from the
   * store's current snapshot only, or the empty-state placeholder if there is none yet.
   */
  readonly history?: readonly ChartHistoryPoint[];
  /**
   * The current price for `symbol`, as `StockDetail` is *itself* displaying it right
   * now (its own `quote.price`/`quote.exchangeTimestamp`, converted the same way
   * `history` points are) — not an independently-sampled read of the store. Recomputed
   * by the parent on every render where its own displayed price changes; this
   * component reads it live via a ref (`livePriceRef` below) on its own 30s sampling
   * cadence, so the chart's plotted point and the page's big price header can never
   * show two different numbers for the same instant (see the module doc's "why
   * `livePrice` is a prop" section). `undefined` until the parent has a price to show.
   */
  readonly livePrice?: ChartHistoryPoint | undefined;
  /**
   * Whether EGX is currently open, as the parent page already knows from
   * `marketCalendar.getMarketStatus()` — not recomputed here (this component stays a
   * plain prop-driven renderer, per the module doc, not a second place that decides
   * market hours). Defaults to `true` so every existing caller/test that predates this
   * prop keeps its current "live, pulsing" behavior unchanged. When `false`, the idle
   * readout swaps its pulsing "Live — updates every ~30s" text for a static "Market
   * closed" message — this component doesn't stop sampling/redrawing on its own account
   * (the parent already stopped feeding it new `livePrice` values once the market
   * closed; there is nothing left to sample), it only changes what the idle state says.
   */
  readonly marketOpen?: boolean;
}

// Generous enough to hold `SimulatedSource`'s own session-history cap
// (`HISTORY_MAX_POINTS`, `src/data/SimulatedSource.ts`) without this ring buffer
// evicting anything a `history` seed just pushed into it — the whole point of the
// `history` prop is to show the *full* session, not a truncated tail of it. Not
// imported from that file (a UI/chart-layer file must not depend on a concrete source
// implementation): kept in sync by comment, the same soft coupling
// `HISTORY_SAMPLE_INTERVAL_MS` uses in the other direction.
const DEFAULT_CAPACITY = 4200;
const DEFAULT_HEIGHT = 320;
const DEFAULT_WIDTH = 400;
// Shown in the readout row whenever the cursor isn't over the chart (see the
// `setCursor` hook below). Paired with the pulsing `.tckr-price-chart__live-dot` — see
// that hook and priceChart.css for why: without it, the chart is a static flat line for
// up to `DISPLAY_REFRESH_INTERVAL_MS` after mount/redraw, with no on-chart "alive" cue.
const IDLE_READOUT_OPEN = 'Live — updates every ~30s';
/** Shown instead of `IDLE_READOUT_OPEN` when `marketOpen` is `false` — a pulsing "Live"
 * cue would misrepresent a session that has already fully happened as still updating. */
const IDLE_READOUT_CLOSED = 'Market closed — showing final session prices';

function readCssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

/** A single point cannot render a visible line — uPlot needs two x-values to draw a
 * segment, and `points: { show: false }` means there is no marker fallback either. The
 * very first time this chart ever has exactly one price for its symbol, a synthetic
 * second point one second earlier at that same price is pushed first, so the first
 * paint is already a (flat) line instead of nothing or a single dot. Module-level (not
 * a closure inside the mount effect) because two call sites need it: the mount effect's
 * own single-point fallback, and the separate "wait for the first live price" effect
 * below, which cannot see the mount effect's local variables. */
function seedFlatPoint(buffer: RingBuffer, timeMs: number, price: number): void {
  buffer.push(timeMs - 1000, price);
  buffer.push(timeMs, price);
}

export function PriceChart({
  symbol,
  tickSize,
  capacity = DEFAULT_CAPACITY,
  height = DEFAULT_HEIGHT,
  history,
  livePrice,
  marketOpen = true,
}: PriceChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Owns only the text node (time/price on hover, or the idle message while idle) —
  // never the live-dot sibling below, so the imperative `textContent` writes in the
  // `setCursor` hook can never fight React over the dot's own child nodes.
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  // The idle "still alive" cue (see `IDLE_READOUT_OPEN`/`_CLOSED` above and
  // priceChart.css). A stable, always-mounted element toggled by CSS class (never
  // conditionally rendered/unmounted by React) so the `setCursor` hook — which runs on
  // every native mousemove, well outside React's render cycle — can show/hide it with a
  // plain `classList` call instead of routing through React state and risking a
  // reconciliation race with its sibling's direct `textContent` mutation.
  const liveDotRef = useRef<HTMLSpanElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const bufferRef = useRef<RingBuffer | null>(null);
  // Which idle message is currently correct, read live by the `setCursor` hook's
  // `showIdle()` (see the mount effect) rather than closed over, so a `marketOpen` flip
  // takes effect on the very next mousemove without needing to recreate the uPlot
  // instance. `isHoveringRef` additionally lets the `marketOpen`-change effect below
  // update the on-screen text immediately even if the user isn't actively hovering at
  // that exact moment (see that effect).
  const idleReadoutRef = useRef(marketOpen ? IDLE_READOUT_OPEN : IDLE_READOUT_CLOSED);
  const isHoveringRef = useRef(false);
  // The readout span's JSX child, captured once at mount via `useState`'s lazy
  // initializer and never updated again — this is what makes it immune to React's own
  // reconciliation the same way the original `{IDLE_READOUT}` literal was (a value that
  // never changes across renders is never diffed/rewritten). Every actual update after
  // mount (hover, stream discard, a `marketOpen` flip) goes through
  // `readoutRef.current.textContent =` instead — see those call sites. Without this,
  // making the JSX child itself react to `marketOpen` would let React overwrite
  // whatever the hover-driven imperative text currently says the instant `marketOpen`
  // changes mid-hover.
  const [initialIdleReadout] = useState(() => (marketOpen ? IDLE_READOUT_OPEN : IDLE_READOUT_CLOSED));

  // Read via refs inside the mount effect (below) rather than as effect dependencies:
  // per the brief, only a `symbol` change may recreate the uPlot instance. tickSize,
  // capacity and height are applied live (tickSize/height) or fixed at mount
  // (capacity — a ring buffer cannot be resized without reallocating it).
  const tickSizeRef = useRef(tickSize);
  const heightRef = useRef(height);
  const capacityRef = useRef(capacity);
  const historyRef = useRef(history);
  const livePriceRef = useRef(livePrice);
  tickSizeRef.current = tickSize;
  heightRef.current = height;
  capacityRef.current = capacity;
  historyRef.current = history;
  livePriceRef.current = livePrice;
  idleReadoutRef.current = marketOpen ? IDLE_READOUT_OPEN : IDLE_READOUT_CLOSED;

  // Plain derived value, not `useSyncExternalStore`: both `history` and `livePrice` are
  // already React props (the parent re-renders this component when either changes), so
  // there is no external mutable store to subscribe to here any more — see the module
  // doc for why live sampling moved from an independent store read to a prop.
  const hasData = (history?.length ?? 0) > 0 || livePrice !== undefined;

  // One uPlot instance per mount; destroyed and recreated only when `symbol` changes.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const buffer = new RingBuffer(capacityRef.current);
    bufferRef.current = buffer;

    const accent = readCssVar(container, '--tckr-color-accent', '#2f6fed');
    const border = readCssVar(container, '--tckr-color-border', '#d8dbe1');
    const muted = readCssVar(container, '--tckr-color-text-muted', '#5b6472');

    const plot = new uPlot(
      {
        width: container.clientWidth || DEFAULT_WIDTH,
        height: heightRef.current,
        scales: { x: { time: false } },
        series: [
          {},
          {
            label: symbol,
            stroke: accent,
            width: 2,
            points: { show: false },
          },
        ],
        axes: [
          {
            side: 2,
            stroke: muted,
            grid: { stroke: border, width: 1 },
            ticks: { stroke: border, width: 1 },
            incrs: X_AXIS_INCREMENTS_MS as number[],
            space: 60,
            values: (_self, splits) => splits.map((split) => formatXAxisLabel(split)),
          },
          {
            side: 3,
            stroke: muted,
            grid: { stroke: border, width: 1 },
            ticks: { stroke: border, width: 1 },
            space: 40,
            values: (_self, splits) => splits.map((split) => formatYAxisLabel(split, tickSizeRef.current)),
          },
        ],
        legend: { show: false },
        cursor: {
          show: true,
          x: true,
          y: false,
          points: { show: true },
        },
        hooks: {
          setCursor: [
            (self) => {
              const readout = readoutRef.current;
              if (!readout) {
                return;
              }
              // The live-dot only makes sense while the readout is showing the idle
              // message — the moment there's a real hover readout to show, it takes
              // over exactly as it always has, and the dot hides (see priceChart.css:
              // `--hidden` sets `display: none`, it does not unmount the element).
              const showIdle = (): void => {
                isHoveringRef.current = false;
                readout.textContent = idleReadoutRef.current;
                liveDotRef.current?.classList.remove('tckr-price-chart__live-dot--hidden');
              };
              const idx = self.cursor.idx;
              if (idx == null || idx < 0) {
                showIdle();
                return;
              }
              const t = self.data[0]?.[idx];
              const v = self.data[1]?.[idx];
              if (typeof t !== 'number' || typeof v !== 'number') {
                showIdle();
                return;
              }
              isHoveringRef.current = true;
              readout.textContent = `${formatXAxisLabel(t)}   ${formatYAxisLabel(v, tickSizeRef.current)}`;
              liveDotRef.current?.classList.add('tckr-price-chart__live-dot--hidden');
            },
          ],
        },
      },
      [buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)],
      container,
    );
    plotRef.current = plot;

    // Seed the buffer with the full session history *before* anything live — `history`
    // is fetched once by the parent page (task 06) and gates this component's own
    // mount (a fresh `PriceChart` instance is only ever created once history is ready),
    // so it is safe to read once here via `historyRef` rather than as an effect
    // dependency (same pattern as `tickSizeRef`/`heightRef`/`capacityRef` above). This
    // is what makes a symbol opened mid-session (e.g. noon, for a 9:30 open) show its
    // whole line immediately instead of only whatever arrives after this mount.
    for (const point of historyRef.current ?? []) {
      buffer.push(point.t, toPlotValue(point.p));
    }

    const seed = livePriceRef.current;
    if (seed) {
      if (buffer.length === 0) {
        // No history at all (a brand-new symbol, or a history fetch that came back
        // empty) — fall back to the single-point doubling trick.
        seedFlatPoint(buffer, seed.t, toPlotValue(seed.p));
      } else if (seed.t > buffer.times[buffer.length - 1]!) {
        // History's own trailing edge (see `SimulatedSource.getHistory`) is normally
        // already at "now", but append the live price too if it is strictly newer, so a
        // slow history fetch can never leave a visible gap at the right edge of the
        // line.
        buffer.push(seed.t, toPlotValue(seed.p));
      }
    } else if (buffer.length === 1) {
      // Exactly one historical sample exists (the session has just started) — a single
      // point cannot render a visible line, so double it the same way `seedFlatPoint`
      // does for a single live point.
      const onlyT = buffer.times[0]!;
      const onlyV = buffer.values[0]!;
      buffer.clear();
      seedFlatPoint(buffer, onlyT, onlyV);
    }

    if (buffer.length > 0) {
      // `resetScales` deliberately left at its default (`true`) here only: this is the
      // very first paint, there is no prior view/zoom yet for a reset to clobber, and an
      // initial auto-scale to the seeded range is exactly what should happen.
      plot.setData([buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)], true);
    }

    const redraw = (): void => {
      const current = bufferRef.current;
      const activePlot = plotRef.current;
      if (!current || !activePlot || current.length === 0) {
        return;
      }
      // `resetScales` left at its default (`true`), NOT `false`: a previous revision of
      // this file passed `false` here as speculative future-proofing for a zoom/pan
      // feature that does not exist (`cursor: { x: true, y: false }`, no drag-to-zoom).
      // That was wrong, not merely premature — it broke the chart *today*. uPlot's own
      // y-auto-range (`uPlot.rangeNum`) falls back to a degenerate, zero-anchored range
      // (e.g. `rangeNum(18.42, 18.42, 0.1, true)` → `[0, 37]`) whenever the currently
      // plotted values have zero variance — which the very first paint often does (the
      // single-point-doubling seed above pushes the *same* price twice). With
      // `resetScales: false` on every redraw after that, uPlot was told to keep that
      // degenerate `[0, 37]`-ish range forever, even once real, varying prices arrived —
      // a flat-looking line pinned near the bottom of a wildly oversized axis, for the
      // rest of the chart's life. `true` here means every redraw re-ranges to the
      // buffer's *current* full content, so the axis self-corrects the instant real
      // variance exists, and continues tracking the true range as it drifts over a
      // session — required for a chart with no fixed window (it only ever grows) and no
      // zoom to preserve. If a real zoom/pan feature is ever added, it must not solve
      // this by reintroducing a blanket `false` here; it should track whether the user
      // has manually zoomed and only then skip the reset (e.g. via `uplot`'s per-scale
      // `setScale`), leaving auto-scaling behavior intact otherwise.
      activePlot.setData([current.times.subarray(0, current.length), current.values.subarray(0, current.length)]);
    };

    // Takes exactly one sample of `livePriceRef`'s *current* value and appends it —
    // never a queue of every notification since the last sample (see module doc for
    // why: a bounded buffer sized for "N recent samples" cannot also hold "every raw
    // tick", and trying to do both is what made the line reshuffle on every redraw).
    // Reading the ref (not the `livePrice` prop directly, which this closure would
    // otherwise capture stale) is what guarantees this always sees whatever
    // `StockDetail` is *currently* displaying, no matter when this interval happens to
    // fire relative to that page's own render/throttle cadence.
    function sampleLatest(): void {
      const view = livePriceRef.current;
      if (!view) {
        return;
      }
      buffer.push(view.t, toPlotValue(view.p));
    }

    // The chart already painted once, synchronously, from `history`/`seed` above. From
    // here on it takes one fresh sample and repaints on a fixed cadence — never on tick
    // arrival — so the line only ever grows, in the same, predictable 30s steps as
    // every other visible price on the page, no matter how bursty the underlying tape
    // is.
    const intervalId = setInterval(() => {
      sampleLatest();
      redraw();
    }, DISPLAY_REFRESH_INTERVAL_MS);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const width = entry.contentRect.width;
        if (width > 0) {
          plot.setSize({ width, height: heightRef.current });
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      clearInterval(intervalId);
      plot.destroy();
      plotRef.current = null;
      bufferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only `symbol`
    // recreates the instance; tickSize/height/capacity/history/livePrice are read live
    // via refs above.
  }, [symbol]);

  // Reacts to `livePrice` becoming available (or changing identity) after mount — the
  // prop-driven equivalent of the old store-subscription "notice the first live price"
  // listener (see module doc). Only ever does something the *first* time the buffer is
  // still empty when a `livePrice` exists: `StockDetail` gates rendering this component
  // on its session-history fetch, not on its own snapshot/quote being ready, so at
  // mount `livePrice` is often still `undefined` and only arrives on a later render.
  // Once the buffer holds anything (from history, from `seed` above, or from this
  // effect having already fired once), this becomes a permanent no-op — real samples
  // from then on are taken only by the fixed interval inside the mount effect.
  useEffect(() => {
    const buffer = bufferRef.current;
    const plot = plotRef.current;
    if (!buffer || !plot || buffer.length > 0 || !livePrice) {
      return;
    }
    seedFlatPoint(buffer, livePrice.t, toPlotValue(livePrice.p));
    plot.setData([buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)]);
  }, [symbol, livePrice]);

  // tickSize changes reformat the y-axis in place — no instance recreation.
  useEffect(() => {
    plotRef.current?.redraw(false, true);
  }, [tickSize]);

  // height changes resize the existing instance in place.
  useEffect(() => {
    const plot = plotRef.current;
    const container = containerRef.current;
    if (plot && container) {
      plot.setSize({ width: container.clientWidth || DEFAULT_WIDTH, height });
    }
  }, [height]);

  // Stream-discard correctness (see module doc): clears this chart's own buffer and
  // plotted series on every entitlementChanged, for the component's whole lifetime —
  // not keyed on `symbol`, since a discard can land at any point regardless of which
  // instance is currently mounted, and the listener always reads the *current* buffer
  // and plot via refs.
  useEffect(() => {
    const unsubscribeDiscard = onStreamDiscard(() => {
      const buffer = bufferRef.current;
      if (!buffer) {
        return;
      }
      buffer.clear();
      // `resetScales` left at its default (`true`) — see the `redraw()` function's
      // comment above for why a blanket `false` here previously froze the y-axis at a
      // degenerate range. A discard clearing the series to empty is exactly a moment
      // the axis *should* reset (there is nothing left to scale against until the next
      // real point arrives).
      plotRef.current?.setData([buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)]);
      if (readoutRef.current) {
        isHoveringRef.current = false;
        readoutRef.current.textContent = idleReadoutRef.current;
      }
      liveDotRef.current?.classList.remove('tckr-price-chart__live-dot--hidden');
    });
    return unsubscribeDiscard;
  }, []);

  // A `marketOpen` flip (the parent's own `marketCalendar.getMarketStatus()` re-check —
  // see `StockDetail.tsx`) updates the idle message immediately, even if the reader
  // isn't hovering right at that moment — without this, the text would only catch up on
  // the next mousemove (`showIdle()` above already reads `idleReadoutRef.current` live,
  // but only *runs* on a cursor event). Also toggles the live-dot's non-pulsing
  // `--closed` styling — a separate class from the hover-driven `--hidden` toggle above,
  // so the two never fight over the same class list.
  useEffect(() => {
    if (readoutRef.current && !isHoveringRef.current) {
      readoutRef.current.textContent = idleReadoutRef.current;
    }
    liveDotRef.current?.classList.toggle('tckr-price-chart__live-dot--closed', !marketOpen);
  }, [marketOpen]);

  return (
    <div className="tckr-price-chart">
      <div className="tckr-price-chart__readout">
        {/* className is deliberately static: `--hidden` (hover) and `--closed`
            (market status) are both managed exclusively via imperative `classList`
            calls (see the `setCursor` hook and the `marketOpen` effect below) — never
            through a React-rendered className on this element, which would reset
            whichever imperative class was most recently applied on every re-render
            this component happens to do for an unrelated reason. */}
        <span ref={liveDotRef} className="tckr-price-chart__live-dot" aria-hidden="true" />
        <span ref={readoutRef}>{initialIdleReadout}</span>
      </div>
      <div className="tckr-price-chart__body" style={{ height }}>
        {!hasData && (
          <div className="tckr-price-chart__empty" data-testid="price-chart-empty-state">
            Waiting for ticks…
          </div>
        )}
        <div
          ref={containerRef}
          className="tckr-price-chart__canvas"
          role="img"
          aria-label={`Price chart for ${symbol}`}
        />
      </div>
    </div>
  );
}

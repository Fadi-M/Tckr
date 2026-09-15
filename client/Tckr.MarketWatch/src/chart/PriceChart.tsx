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
 * immediately on mount if the store already has this symbol's snapshot (`seed` below),
 * or otherwise on the first store notification after mount (`StockDetail` fetches its
 * snapshot asynchronously, so the store is frequently still empty when this component
 * mounts; waiting a full window to show data that already arrived would mean sitting on
 * an empty chart for no reason). That first sample is paired with one synthetic point a
 * second earlier at the same price (`seedFirstPoint` below) — a single point cannot
 * render a visible line, since uPlot needs two x-values to draw a segment, and
 * `points: { show: false }` means there is no marker fallback either. Every sample after
 * that is real, taken by the fixed `setInterval` below reading whatever the store's
 * *current* price is at that moment — this is the same "read fresh state when the timer
 * fires" contract `StockListRow`'s "Last update" clock uses, not a queue of buffered
 * values. A `useSyncExternalStore` subscription (as the brief asks for) drives only the
 * cheap, rarely-changing "do we have data yet" boolean that toggles the empty-state
 * placeholder — it is not on the hot path, and does not gate the sampling below, which
 * runs from a second, plain subscription so it is never at the mercy of React's
 * render/batching behaviour.
 *
 * The only place a `DecimalString` price becomes a JS `number` is `ringBuffer.ts`'s
 * `toPlotValue`, called here once per pushed point. Every value this component renders
 * as text — axis labels, the crosshair readout — goes through `axes.ts`, which formats
 * from that same number back through `contracts/decimal.ts`, never a raw fixed-decimal
 * stringify. See `ringBuffer.ts`'s module doc for the full boundary argument.
 *
 * Lifecycle note: this component does **not** call `MarketDataSource.subscribe` /
 * `unsubscribe` — starting and stopping the underlying tick stream for a symbol is
 * task 06's job (`StockDetail`, out of scope per the brief). This component only reads
 * whatever is already flowing through the store.
 *
 * Stream-discard correctness (client-contract.md §3.3): when the server moves a client
 * between LIVE and DELAYED, buffered ticks from the old stream must be discarded, not
 * left mixed with new-stream ticks on the same chart — that mix is the exact failure
 * the contract calls out as the one the whole system exists to prevent. `store.ts`
 * exposes `onStreamDiscard`, fired by `resetStream()` as its last step, strictly after
 * every per-symbol view has been cleared and re-anchored to its reference price; this
 * component subscribes to it (for its whole lifetime, independent of `symbol`) and
 * clears its own `RingBuffer` and the plotted series in response. This keeps the
 * component's only dependency on `src/data/**` as `store.ts` — no import from
 * `src/components/**` anywhere in `src/chart/**`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type JSX } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { DecimalString } from '../contracts/decimal.ts';
import { getSymbolSnapshot, onStreamDiscard, subscribeSymbol } from '../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';
import { RingBuffer, toPlotValue } from './ringBuffer.ts';
import { X_AXIS_INCREMENTS_MS, formatXAxisLabel, formatYAxisLabel } from './axes.ts';
import './priceChart.css';

export interface PriceChartProps {
  readonly symbol: string;
  readonly tickSize: DecimalString;
  readonly capacity?: number;
  readonly height?: number;
}

const DEFAULT_CAPACITY = 600;
const DEFAULT_HEIGHT = 320;
const DEFAULT_WIDTH = 400;
const IDLE_READOUT = 'Hover the chart for time and price';

function readCssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function PriceChart({
  symbol,
  tickSize,
  capacity = DEFAULT_CAPACITY,
  height = DEFAULT_HEIGHT,
}: PriceChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const bufferRef = useRef<RingBuffer | null>(null);

  // Read via refs inside the mount effect (below) rather than as effect dependencies:
  // per the brief, only a `symbol` change may recreate the uPlot instance. tickSize,
  // capacity and height are applied live (tickSize/height) or fixed at mount
  // (capacity — a ring buffer cannot be resized without reallocating it).
  const tickSizeRef = useRef(tickSize);
  const heightRef = useRef(height);
  const capacityRef = useRef(capacity);
  tickSizeRef.current = tickSize;
  heightRef.current = height;
  capacityRef.current = capacity;

  // Cheap boolean selector: this only actually changes value once, undefined -> defined,
  // so it re-renders this component once (to swap the placeholder for the canvas), never
  // once per tick. The hot data path below does not depend on this triggering a render.
  const subscribeForHasData = useCallback(
    (onStoreChange: () => void) => subscribeSymbol(symbol, onStoreChange),
    [symbol],
  );
  const getHasDataSnapshot = useCallback(() => getSymbolSnapshot(symbol) !== undefined, [symbol]);
  const hasData = useSyncExternalStore(subscribeForHasData, getHasDataSnapshot);

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
              const idx = self.cursor.idx;
              if (idx == null || idx < 0) {
                readout.textContent = IDLE_READOUT;
                return;
              }
              const t = self.data[0]?.[idx];
              const v = self.data[1]?.[idx];
              if (typeof t !== 'number' || typeof v !== 'number') {
                readout.textContent = IDLE_READOUT;
                return;
              }
              readout.textContent = `${formatXAxisLabel(t)}   ${formatYAxisLabel(v, tickSizeRef.current)}`;
            },
          ],
        },
      },
      [buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)],
      container,
    );
    plotRef.current = plot;

    // A single point cannot render a visible line — uPlot needs two x-values to draw a
    // segment, and `points: { show: false }` above means there is no marker fallback
    // either. The very first time this chart ever has a price for `symbol`, a synthetic
    // second point one second earlier at that same price is pushed first, so the first
    // paint is already a (flat) line instead of nothing. Every real point after that is
    // pushed on its own.
    function seedFirstPoint(timeMs: number, price: number): void {
      buffer.push(timeMs - 1000, price);
      buffer.push(timeMs, price);
    }

    const seed = getSymbolSnapshot(symbol);
    if (seed) {
      seedFirstPoint(seed.lastUpdate, toPlotValue(seed.price));
      plot.setData([buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)]);
    }

    const redraw = (): void => {
      const current = bufferRef.current;
      const activePlot = plotRef.current;
      if (!current || !activePlot || current.length === 0) {
        return;
      }
      activePlot.setData([
        current.times.subarray(0, current.length),
        current.values.subarray(0, current.length),
      ]);
    };

    // Takes exactly one sample of the store's *current* price and appends it — never a
    // queue of every notification since the last sample (see module doc for why: a
    // bounded buffer sized for "N recent samples" cannot also hold "every raw tick",
    // and trying to do both is what made the line reshuffle on every redraw). Returns
    // whether a sample was taken, so the first-data path below knows whether to redraw.
    function sampleLatest(): boolean {
      const view = getSymbolSnapshot(symbol);
      if (!view) {
        return false;
      }
      buffer.push(view.lastUpdate, toPlotValue(view.price));
      return true;
    }

    // Plain store subscription (not useSyncExternalStore): this exists for exactly one
    // purpose — noticing the very first time this chart has data to show, whichever of
    // `seed` above or a live tick gets there first (see module doc). Once the buffer
    // holds anything, every further raw notification is ignored here: real samples are
    // taken only by the fixed interval below, at most once per
    // `DISPLAY_REFRESH_INTERVAL_MS`, exactly like every other visible price on the page.
    const unsubscribe = subscribeSymbol(symbol, () => {
      if (buffer.length > 0) {
        return;
      }
      const view = getSymbolSnapshot(symbol);
      if (!view) {
        return;
      }
      seedFirstPoint(view.lastUpdate, toPlotValue(view.price));
      redraw();
    });

    // The chart already painted once, synchronously, from `seed` (or the first live
    // tick) above. From here on it takes one fresh sample and repaints on a fixed
    // cadence — never on tick arrival — so the line only ever grows, in the same,
    // predictable 30s steps as every other visible price on the page, no matter how
    // bursty the underlying tape is.
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
      unsubscribe();
      clearInterval(intervalId);
      plot.destroy();
      plotRef.current = null;
      bufferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only `symbol`
    // recreates the instance; tickSize/height/capacity are read live via refs above.
  }, [symbol]);

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
      plotRef.current?.setData([
        buffer.times.subarray(0, buffer.length),
        buffer.values.subarray(0, buffer.length),
      ]);
      if (readoutRef.current) {
        readoutRef.current.textContent = IDLE_READOUT;
      }
    });
    return unsubscribeDiscard;
  }, []);

  return (
    <div className="tckr-price-chart">
      <div ref={readoutRef} className="tckr-price-chart__readout">
        {IDLE_READOUT}
      </div>
      <div className="tckr-price-chart__body" style={{ height }}>
        {!hasData && (
          <div className="tckr-price-chart__empty" data-testid="price-chart-empty-state">
            Waiting for ticks…
          </div>
        )}
        <div ref={containerRef} className="tckr-price-chart__canvas" />
      </div>
    </div>
  );
}

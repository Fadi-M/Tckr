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
 * separately-timed display throttle, merging the uncoalesced raw tick stream with its own
 * "newer wins" ordering rules — see that file's module doc for why it cannot simply
 * read the shared store either). Two independently-timed samplers reading the
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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { format, type DecimalString } from '../contracts/decimal.ts';
import { onStreamDiscard } from '../data/store.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';
import { useTheme } from '../theme/useTheme.ts';
import { RingBuffer, toPlotValue } from './ringBuffer.ts';
import { PRICE_AXIS_SIZE_PX, TIME_AXIS_SIZE_PX } from './chartGeometry.ts';
import { decimalsForTickSize, formatClockTime, formatXAxisTick, formatYAxisLabel, timeAxisSplits, X_AXIS_INCREMENTS_MS } from './axes.ts';

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
   * component reads it live via a ref (`livePriceRef` below) on its own 10s sampling
   * cadence, so the chart's plotted point and the page's big price header can never
   * show two different numbers for the same instant (see the module doc's "why
   * `livePrice` is a prop" section). `undefined` until the parent has a price to show.
   */
  readonly livePrice?: ChartHistoryPoint | undefined;
  /**
   * Caption for the floating range chip (top-left of the chart) and the chart's
   * accessible name — what slice of time is plotted, e.g. "Last 60s" or "Thu 24 Sep
   * session · 10:00–14:30". Purely a display string the parent already knows (see
   * `pages/chartRanges.ts`); this component does not know or care what a "range"
   * means, it only ever plots whatever `history`/`livePrice` it is given. Defaults to
   * `'Session'`. (The chip used to add a sample count, "541 ticks": those points are
   * sampled points, not ticks, and the count told a trader nothing.)
   */
  readonly rangeLabel?: string;
  /**
   * The price the page's change figures are measured from (the session open), drawn as
   * a dashed reference line with its own price-axis tag and always kept inside the y
   * range, so a move reads against where the day started instead of against its own
   * extremes. Omitted for the short ranges,
   * where pulling a far-away reference into view would flatten the line. Read live via
   * a ref and applied with a redraw; never recreates the instance.
   */
  readonly referencePrice?: DecimalString | undefined;
  /** Label for the reference line's tag, e.g. `'Open'`. */
  readonly referenceLabel?: string;
  /** How the reference is named in the chart's accessible name (the tag's label can be
   * abbreviated to fit the axis, e.g. "Prev"). Defaults to `referenceLabel`. */
  readonly referenceDescription?: string;
  /**
   * The session's direction (the sign of the page's Change, i.e. last price vs. open):
   * colours the line, its area fill, the last-price tag and the cursor dot — Exchange Green up, Brick
   * Red down, Ink when unchanged or not yet known. One colour for the whole series,
   * never per segment or per tick. Applied with a repaint in place; never recreates the
   * instance.
   */
  readonly direction?: 'up' | 'down' | null | undefined;
}

type LineDirection = 'up' | 'down' | 'flat';

// The token that colours the line for each direction. The canvas reads it by name
// (`readChartColors`); the DOM pieces (last-price tag, cursor dot) get it through
// `--tckr-chart-line` on the container. Both follow light/dark with the tokens.
const LINE_TOKEN: Record<LineDirection, string> = {
  up: '--tckr-color-up',
  down: '--tckr-color-down',
  flat: '--tckr-color-text',
};

// Generous enough to hold `SimulatedSource`'s own session-history cap
// (`HISTORY_MAX_POINTS`, `src/data/SimulatedSource.ts`) without this ring buffer
// evicting anything a `history` seed just pushed into it — the whole point of the
// `history` prop is to show the *full* session, not a truncated tail of it. Not
// imported from that file (a UI/chart-layer file must not depend on a concrete source
// implementation): kept in sync by comment, the same soft coupling
// `HISTORY_SAMPLE_INTERVAL_MS` uses in the other direction.
const DEFAULT_CAPACITY = 4200;
const DEFAULT_HEIGHT = 340;
const DEFAULT_WIDTH = 400;
/** How long a new sample takes to draw in, and the ring its landing plays on the
 * line's end. Long enough to read as travel, short against the 10s cadence. */
const LANDING_TWEEN_MS = 720;
const LANDING_RING_MS = 1100;
/** `--tckr-ease-out`, for the Web Animations on the line's end. */
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** How long after a wall-clock paint slot opens the chart samples, so it reads the
 * price the header has just painted rather than the one before it. */
const SAMPLE_AFTER_PAINT_MS = 120;

/** Below this plot width the line draws finer (see the series `width`). */
const NARROW_PLOT_PX = 480;
// Axis labels are canvas text, so the font is spelled out rather than inherited; the
// family matches every other number on the page (IBM Plex Mono, tabular by design).
const AXIS_FONT = '500 11px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
// Top padding leaves room for the range chip so the line never runs underneath it; the
// left padding lets the first time label (centred on the session's first point) fit.
const PLOT_PADDING: [number, number, number, number] = [40, 6, 0, 30];
// Price-axis tags (the last price and the reference): their height, which is also the
// distance two tags keep apart and the clearance within which an axis label is left
// blank rather than peeking out from under one.
const AXIS_TAG_HEIGHT_PX = 18;

// The area fill's strength, as a share of its colour.
const FILL_TINT = '14%';

/**
 * y range for the plotted values plus the reference price (when given). A span smaller
 * than 1% of the price (or 8 ticks) is widened around its midpoint, so a quiet session
 * reads as quiet instead of being stretched edge to edge like a crash; then 10% of the
 * span is added above and below so extremes never touch the frame.
 */
export function chartYRange(
  min: number | null,
  max: number | null,
  reference: number | null,
  tick: number,
): [number, number] {
  let lo = min ?? reference;
  let hi = max ?? reference;
  if (lo === null || hi === null) {
    return [0, 1];
  }
  if (reference !== null) {
    lo = Math.min(lo, reference);
    hi = Math.max(hi, reference);
  }
  const mid = (lo + hi) / 2;
  const minSpan = Math.max(tick * 8, Math.abs(mid) * 0.01);
  if (hi - lo < minSpan) {
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/**
 * Screen positions (CSS px from the plot top) of the price-axis tags. The last price
 * keeps its exact spot; when the reference would overlap it, the reference steps one
 * tag height away on the side it actually lies, so both stay readable.
 */
export function placeAxisTags(lastPos: number | null, refPos: number | null): { last: number | null; ref: number | null } {
  if (refPos === null || lastPos === null || Math.abs(refPos - lastPos) >= AXIS_TAG_HEIGHT_PX) {
    return { last: lastPos, ref: refPos };
  }
  return { last: lastPos, ref: refPos >= lastPos ? lastPos + AXIS_TAG_HEIGHT_PX : lastPos - AXIS_TAG_HEIGHT_PX };
}

/** Whether an axis label at `pos` would sit under one of the tags at `tagPositions`. */
export function isUnderAxisTag(pos: number, tagPositions: readonly (number | null)[]): boolean {
  return tagPositions.some((tag) => tag !== null && Math.abs(pos - tag) < AXIS_TAG_HEIGHT_PX);
}

function tint(color: string): string {
  return `color-mix(in srgb, ${color} ${FILL_TINT}, transparent)`;
}

function readCssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

interface ChartColors {
  /** The line's (and its fill's) colour, by session direction — see `LINE_TOKEN`. */
  readonly accent: string;
  readonly border: string;
  readonly muted: string;
}

/** Canvas can't read CSS custom properties, so the line and gridline colours are
 * resolved from the tokens here: once at mount, and again on every theme switch. */
function readChartColors(el: Element, direction: LineDirection): ChartColors {
  return {
    accent: readCssVar(el, LINE_TOKEN[direction], '#14181f'),
    border: readCssVar(el, '--tckr-color-border', '#d8dbe1'),
    muted: readCssVar(el, '--tckr-color-text-muted', '#5b6472'),
  };
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
  rangeLabel = 'Session',
  referencePrice,
  referenceLabel = 'Open',
  referenceDescription,
  direction,
}: PriceChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colorsRef = useRef<ChartColors | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const bufferRef = useRef<RingBuffer | null>(null);
  /** Stops a new sample mid-draw-in (see `sampleAndDraw`); set by the mount effect. */
  const settleRef = useRef<(() => void) | null>(null);

  // Read via refs inside the mount effect (below) rather than as effect dependencies:
  // per the brief, only a `symbol` change may recreate the uPlot instance. tickSize,
  // capacity and height are applied live (tickSize/height) or fixed at mount
  // (capacity — a ring buffer cannot be resized without reallocating it).
  const tickSizeRef = useRef(tickSize);
  const heightRef = useRef(height);
  const capacityRef = useRef(capacity);
  const historyRef = useRef(history);
  const livePriceRef = useRef(livePrice);
  const lineDirection: LineDirection = direction ?? 'flat';
  const lineDirectionRef = useRef(lineDirection);
  lineDirectionRef.current = lineDirection;
  const referencePriceRef = useRef(referencePrice);
  const referenceLabelRef = useRef(referenceLabel);
  referencePriceRef.current = referencePrice;
  referenceLabelRef.current = referenceLabel;
  tickSizeRef.current = tickSize;
  heightRef.current = height;
  capacityRef.current = capacity;
  historyRef.current = history;
  livePriceRef.current = livePrice;

  // Plain derived value, not `useSyncExternalStore`: both `history` and `livePrice` are
  // already React props (the parent re-renders this component when either changes), so
  // there is no external mutable store to subscribe to here any more — see the module
  // doc for why live sampling moved from an independent store read to a prop.
  const hasData = (history?.length ?? 0) > 0 || livePrice !== undefined;

  // The high/low in the chart's accessible name — computed from this component's own
  // buffer, the one place that already knows every plotted point. (High and low are no
  // longer drawn as chips: the price axis carries the range, and the page's stat tiles
  // show the session's.) `null` until the buffer holds at least one point.
  // `high`/`low` are plot-space numbers formatted back through `formatYAxisLabel` —
  // never a raw stringify — for the same decimal-safety reason every other price on
  // this page goes through `contracts/decimal.ts`.
  const [stats, setStats] = useState<{ high: number; low: number } | null>(null);

  function recomputeStats(buffer: RingBuffer): void {
    if (buffer.length === 0) {
      setStats(null);
      return;
    }
    let high = -Infinity;
    let low = Infinity;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer.values[i]!;
      if (v > high) high = v;
      if (v < low) low = v;
    }
    setStats({ high, low });
  }

  // One uPlot instance per mount; destroyed and recreated only when `symbol` changes.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const buffer = new RingBuffer(capacityRef.current);
    bufferRef.current = buffer;

    colorsRef.current = readChartColors(container, lineDirectionRef.current);
    // Colours are passed as functions, which uPlot re-evaluates on every draw, so a
    // theme switch only has to refresh `colorsRef` and redraw (see the theme effect
    // below) and never recreates the instance.
    const accent = (): string => colorsRef.current!.accent;
    const border = (): string => colorsRef.current!.border;
    const muted = (): string => colorsRef.current!.muted;
    const referenceValue = (): number | null => {
      const ref = referencePriceRef.current;
      return ref === undefined ? null : toPlotValue(ref);
    };

    // The last-price and reference tags are plain DOM in uPlot's own plot-area overlay
    // (`plot.over`), hung off its right edge onto the price axis and repositioned by the
    // draw hook below, so following the line costs a style write per redraw rather
    // than a React render. On the axis, never inside the plot, so the line can't run
    // through them.
    const lastTag = document.createElement('span');
    lastTag.setAttribute('aria-hidden', 'true');
    lastTag.dataset.testid = 'price-chart-last-tag';
    lastTag.className =
      'absolute left-full ml-1.5 -translate-y-1/2 font-mono text-caption font-semibold tabular-nums px-1.5 py-px rounded-[5px] bg-[var(--tckr-chart-line)] text-surface pointer-events-none whitespace-nowrap';
    const referenceTag = document.createElement('span');
    referenceTag.setAttribute('aria-hidden', 'true');
    referenceTag.dataset.testid = 'price-chart-reference-tag';
    // A hairline border (in place of the last tag's 1px vertical padding, so both tags
    // keep one height): Paper Raised alone barely separates from the light glass.
    referenceTag.className =
      'absolute left-full ml-1.5 -translate-y-1/2 font-mono text-caption tabular-nums px-1.5 py-0 rounded-[5px] border border-border bg-surface-raised text-text-muted pointer-events-none whitespace-nowrap';

    // The crosshair's readout: the hovered sample's Cairo time and price, in a chip that
    // follows the cursor above the line (below it near the top edge), clamped inside the
    // plot. Without it the crosshair drew a line and a dot but never said what they meant.
    const readout = document.createElement('span');
    readout.setAttribute('aria-hidden', 'true');
    readout.dataset.testid = 'price-chart-readout';
    readout.hidden = true;
    readout.className =
      'absolute z-[1] inline-flex items-baseline gap-1.5 font-mono text-caption tabular-nums px-2 py-[3px] rounded-[7px] bg-surface text-text border border-border shadow-float pointer-events-none whitespace-nowrap';
    const readoutTime = document.createElement('span');
    readoutTime.className = 'text-text-muted';
    const readoutPrice = document.createElement('span');
    readoutPrice.className = 'font-semibold';
    readout.append(readoutTime, readoutPrice);

    const updateReadout = (u: uPlot): void => {
      const idx = u.cursor.idx;
      const t = idx == null ? undefined : u.data[0]?.[idx];
      const v = idx == null ? undefined : u.data[1]?.[idx];
      if (t == null || v == null) {
        readout.hidden = true;
        return;
      }
      const inFlight = landing !== null && idx === (u.data[0]?.length ?? 0) - 1;
      readoutTime.textContent = formatClockTime(inFlight ? landing!.t : t);
      readoutPrice.textContent = formatYAxisLabel(inFlight ? landing!.v : v, tickSizeRef.current);
      readout.hidden = false;
      const plotWidth = u.over.clientWidth;
      const halfWidth = readout.offsetWidth / 2;
      const x = u.valToPos(t, 'x');
      const y = u.valToPos(v, 'y');
      const left = Math.min(Math.max(x, halfWidth), Math.max(halfWidth, plotWidth - halfWidth));
      const above = y - readout.offsetHeight - 10;
      readout.style.left = `${left}px`;
      readout.style.top = `${above >= 0 ? above : y + 10}px`;
      readout.style.transform = 'translateX(-50%)';
    };

    // While a new sample is drawing in (see `sampleAndDraw`), the plotted last point is
    // in flight between the previous price and the new one. Only its position is in
    // flight: every number shown as text (the last-price tag, the readout) reads the
    // real sample from here, so the chart never prints a price that was not traded.
    let landing: { t: number; v: number } | null = null;

    // The line's live end: a dot in the line colour that rides the last point, and
    // rings once when a new price lands on it.
    const head = document.createElement('span');
    head.setAttribute('aria-hidden', 'true');
    head.dataset.testid = 'price-chart-head';
    head.hidden = true;
    head.className =
      'absolute size-[7px] -translate-1/2 rounded-full bg-[var(--tckr-chart-line)] shadow-[0_0_0_2px_var(--tckr-color-surface)] pointer-events-none';
    const headRing = document.createElement('span');
    headRing.className = 'absolute inset-0 rounded-full bg-[var(--tckr-chart-line)] opacity-0';
    head.append(headRing);

    const lastValue = (u: uPlot): number | null => {
      const values = u.data[1] ?? [];
      return values.length > 0 ? (values[values.length - 1] ?? null) : null;
    };
    const lastTime = (u: uPlot): number | null => {
      const times = u.data[0] ?? [];
      return times.length > 0 ? (times[times.length - 1] ?? null) : null;
    };
    const tagPositions = (u: uPlot): { last: number | null; ref: number | null } => {
      const last = lastValue(u);
      const ref = referenceValue();
      return placeAxisTags(last === null ? null : u.valToPos(last, 'y'), ref === null ? null : u.valToPos(ref, 'y'));
    };

    const drawOverlays = (u: uPlot): void => {
      const last = lastValue(u);
      const positions = tagPositions(u);
      if (last === null || positions.last === null) {
        lastTag.hidden = true;
      } else {
        lastTag.hidden = false;
        lastTag.textContent = formatYAxisLabel(landing?.v ?? last, tickSizeRef.current);
        lastTag.style.top = `${positions.last}px`;
      }
      const headT = lastTime(u);
      if (last === null || headT === null || positions.last === null) {
        head.hidden = true;
      } else {
        head.hidden = false;
        head.style.left = `${u.valToPos(headT, 'x')}px`;
        head.style.top = `${u.valToPos(last, 'y')}px`;
      }

      const ref = referencePriceRef.current;
      if (ref === undefined || last === null || positions.ref === null) {
        referenceTag.hidden = true;
        return;
      }
      const refValue = toPlotValue(ref);
      const { ctx, bbox } = u;
      const y = Math.round(u.valToPos(refValue, 'y', true)) + 0.5;
      ctx.save();
      ctx.strokeStyle = colorsRef.current!.muted;
      ctx.lineWidth = uPlot.pxRatio;
      ctx.setLineDash([4 * uPlot.pxRatio, 4 * uPlot.pxRatio]);
      ctx.beginPath();
      ctx.moveTo(bbox.left, y);
      ctx.lineTo(bbox.left + bbox.width, y);
      ctx.stroke();
      ctx.restore();
      referenceTag.hidden = false;
      referenceTag.textContent = `${referenceLabelRef.current} ${format(ref, { decimals: decimalsForTickSize(tickSizeRef.current) })}`;
      referenceTag.style.top = `${positions.ref}px`;
    };

    const plot = new uPlot(
      {
        width: container.clientWidth || DEFAULT_WIDTH,
        height: heightRef.current,
        padding: PLOT_PADDING,
        scales: {
          x: { time: false },
          y: { range: (_u, min, max) => chartYRange(min, max, referenceValue(), toPlotValue(tickSizeRef.current)) },
        },
        series: [
          {},
          {
            label: symbol,
            stroke: accent,
            // A phone-width plot packs a whole session (~540 samples) into ~250px, so a
            // 2.5px line overlaps itself into a solid band; a finer line keeps its shape.
            width: (container.clientWidth || DEFAULT_WIDTH) < NARROW_PLOT_PX ? 1.5 : 2.5,
            // The whole area under the line, in a tint of the line's own colour: one
            // colour for the whole session, by its direction (see `direction`).
            fill: () => tint(accent()),
            points: { show: false },
          },
        ],
        // A sparse Cairo-time axis along the bottom and a price axis on the right, the
        // side the eye lands on after reading the line left to right. Labels are canvas
        // text in the muted token; horizontal gridlines only, no tick marks.
        axes: [
          {
            side: 2,
            stroke: muted,
            font: AXIS_FONT,
            size: TIME_AXIS_SIZE_PX,
            gap: 8,
            space: 88,
            incrs: [...X_AXIS_INCREMENTS_MS],
            // Both ends always labelled, interior steps only where they fit (see
            // `timeAxisSplits`); `space` in CSS px converted to the scale's ms.
            splits: (u, _axisIdx, min, max, incr, space) =>
              timeAxisSplits(min, max, incr, (space * (max - min)) / Math.max(1, u.bbox.width / uPlot.pxRatio)),
            grid: { show: false },
            ticks: { show: false },
            values: (_u, splits, _axisIdx, _space, incr) => splits.map((v) => formatXAxisTick(v, incr)),
          },
          {
            side: 1,
            stroke: muted,
            font: AXIS_FONT,
            size: PRICE_AXIS_SIZE_PX,
            gap: 8,
            space: 44,
            grid: { show: true, stroke: border, width: 1 },
            ticks: { show: false },
            values: (u, splits) => {
              const { last, ref } = tagPositions(u);
              // On a narrow plot the two tags already give the scale two exact anchors;
              // axis labels between them only crowd a ~90px strip of a ~250px chart.
              if (last !== null && ref !== null && u.bbox.width / uPlot.pxRatio < NARROW_PLOT_PX) {
                return splits.map(() => '');
              }
              return splits.map((v) =>
                isUnderAxisTag(u.valToPos(v, 'y'), [last, ref]) ? '' : formatYAxisLabel(v, tickSizeRef.current),
              );
            },
          },
        ],
        legend: { show: false },
        hooks: { draw: [drawOverlays], setCursor: [updateReadout] },
        cursor: {
          show: true,
          x: true,
          y: false,
          points: { show: true },
        },
      },
      [buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)],
      container,
    );
    plotRef.current = plot;
    plot.over.append(head, lastTag, referenceTag, readout);

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
    recomputeStats(buffer);

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
      recomputeStats(current);
    };

    let tweenFrame = 0;
    const settle = (): void => {
      if (tweenFrame !== 0) {
        cancelAnimationFrame(tweenFrame);
        tweenFrame = 0;
      }
      landing = null;
    };
    settleRef.current = settle;

    const ringHead = (direction: 1 | -1): void => {
      headRing.animate(
        [
          { opacity: 0.45, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(3.6)' },
        ],
        { duration: LANDING_RING_MS, easing: EASE_OUT },
      );
      head.animate(
        // `transform` composes with the dot's own centring `translate`.
        [{ transform: `translateY(${direction * -3}px) scale(1.35)` }, { transform: 'none' }],
        { duration: LANDING_TWEEN_MS, easing: EASE_OUT },
      );
    };

    // Takes exactly one sample of `livePriceRef`'s *current* value and appends it —
    // never a queue of every notification since the last sample (see module doc for
    // why: a bounded buffer sized for "N recent samples" cannot also hold "every raw
    // tick", and trying to do both is what made the line reshuffle on every redraw).
    // Reading the ref (not the `livePrice` prop directly, which this closure would
    // otherwise capture stale) is what guarantees this always sees whatever
    // `StockDetail` is *currently* displaying, no matter when this interval happens to
    // fire relative to that page's own render/throttle cadence.
    //
    // The new sample then draws in rather than appearing: over `LANDING_TWEEN_MS` the
    // line's end travels from the previous sample to the new one while both axes glide
    // from the range they show to the range that fits the new data, so the line extends
    // and the frame eases around it, instead of the whole plot being re-drawn at a new
    // scale in one frame. The point that falls off a full buffer rides out past the
    // left edge on the same glide. Every frame is plain uPlot data and scales; the real
    // buffer is committed (and auto-ranged, exactly as before) once it lands.
    function sampleAndDraw(): void {
      const view = livePriceRef.current;
      const activePlot = plotRef.current;
      if (!activePlot) {
        return;
      }
      settle();
      if (!view) {
        redraw();
        return;
      }
      const n = buffer.length;
      const { min: x0Min, max: x0Max } = activePlot.scales?.x ?? {};
      const { min: y0Min, max: y0Max } = activePlot.scales?.y ?? {};
      const canTween =
        n > 0 &&
        typeof requestAnimationFrame === 'function' &&
        typeof window.matchMedia === 'function' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        document.visibilityState === 'visible' &&
        x0Min != null &&
        x0Max != null &&
        y0Min != null &&
        y0Max != null;

      // The plotted series as it stands (before the push, which may evict the oldest).
      const fromTimes = canTween ? buffer.times.slice(0, n) : null;
      const fromValues = canTween ? buffer.values.slice(0, n) : null;

      const t1 = view.t;
      const v1 = toPlotValue(view.p);
      buffer.push(t1, v1);

      if (!canTween || !fromTimes || !fromValues || x0Min == null || x0Max == null || y0Min == null || y0Max == null) {
        redraw();
        return;
      }
      recomputeStats(buffer);

      const count = buffer.length;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < count; i++) {
        const v = buffer.values[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const [toYMin, toYMax] = chartYRange(lo, hi, referenceValue(), toPlotValue(tickSizeRef.current));
      const toXMin = buffer.times[0]!;
      const toXMax = buffer.times[count - 1]!;
      const x0 = [x0Min, x0Max] as const;
      const y0 = [y0Min, y0Max] as const;
      const t0 = fromTimes[n - 1]!;
      const v0 = fromValues[n - 1]!;

      const times = new Float64Array(n + 1);
      const values = new Float64Array(n + 1);
      times.set(fromTimes);
      values.set(fromValues);
      landing = { t: t1, v: v1 };

      const started = performance.now();
      const step = (now: number): void => {
        const p = Math.min(1, (now - started) / LANDING_TWEEN_MS);
        const e = 1 - Math.pow(1 - p, 4);
        const lerp = (a: number, b: number): number => a + (b - a) * e;
        if (p >= 1) {
          tweenFrame = 0;
          landing = null;
          redraw();
          if (v1 !== v0) {
            ringHead(v1 > v0 ? 1 : -1);
          }
          return;
        }
        times[n] = lerp(t0, t1);
        values[n] = lerp(v0, v1);
        activePlot.batch(() => {
          activePlot.setData([times, values], false);
          activePlot.setScale('x', { min: lerp(x0[0], toXMin), max: lerp(x0[1], toXMax) });
          activePlot.setScale('y', { min: lerp(y0[0], toYMin), max: lerp(y0[1], toYMax) });
        });
        tweenFrame = requestAnimationFrame(step);
      };
      tweenFrame = requestAnimationFrame(step);
    }

    // The chart already painted once, synchronously, from `history`/`seed` above. From
    // here on it takes one fresh sample and repaints on a fixed cadence — never on tick
    // arrival — so the line only ever grows, in the same, predictable 10s steps as
    // every other visible price on the page, no matter how bursty the underlying tape
    // is. The cadence is phased to the page's wall-clock paint slots
    // (`src/display/throttle.ts`), a beat after the header repaints, so the header's
    // price changing and the line reaching it read as one event, not two.
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const now = Date.now();
    const toPhase =
      ((SAMPLE_AFTER_PAINT_MS - (now % DISPLAY_REFRESH_INTERVAL_MS)) % DISPLAY_REFRESH_INTERVAL_MS + DISPLAY_REFRESH_INTERVAL_MS) %
        DISPLAY_REFRESH_INTERVAL_MS || DISPLAY_REFRESH_INTERVAL_MS;
    const phaseId = setTimeout(() => {
      sampleAndDraw();
      intervalId = setInterval(sampleAndDraw, DISPLAY_REFRESH_INTERVAL_MS);
    }, toPhase);

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
      clearTimeout(phaseId);
      clearInterval(intervalId);
      settle();
      settleRef.current = null;
      plot.destroy();
      plotRef.current = null;
      bufferRef.current = null;
    };
    // Intentional: only `symbol`
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
    recomputeStats(buffer);
  }, [symbol, livePrice]);

  // A light/dark switch swaps the CSS tokens underneath the canvas, and a direction
  // change swaps `--tckr-chart-line` (set on the container below, already committed by
  // the time this runs); re-read them and repaint in place. Layout effect so the
  // repaint lands in the same commit as the rest of the page's change (and inside a
  // theme switch's view-transition snapshot).
  const { theme } = useTheme();
  useLayoutEffect(() => {
    const plot = plotRef.current;
    const container = containerRef.current;
    if (!plot || !container) {
      return;
    }
    colorsRef.current = readChartColors(container, lineDirection);
    plot.redraw(false, false);
  }, [theme, lineDirection]);

  // A new reference price (the open arriving with the snapshot) re-ranges and repaints.
  useEffect(() => {
    const plot = plotRef.current;
    if (plot && plot.data[0] && plot.data[0].length > 0) {
      plot.setData(plot.data);
    }
  }, [referencePrice]);

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
      settleRef.current?.();
      buffer.clear();
      // `resetScales` left at its default (`true`) — see the `redraw()` function's
      // comment above for why a blanket `false` here previously froze the y-axis at a
      // degenerate range. A discard clearing the series to empty is exactly a moment
      // the axis *should* reset (there is nothing left to scale against until the next
      // real point arrives).
      plotRef.current?.setData([buffer.times.subarray(0, buffer.length), buffer.values.subarray(0, buffer.length)]);
      recomputeStats(buffer);
    });
    return unsubscribeDiscard;
  }, []);

  return (
    <div className="flex flex-col w-full min-w-0">
      <div
        className="relative w-full min-w-0 rounded-2xl overflow-hidden"
        style={{ height, '--tckr-chart-line': `var(${LINE_TOKEN[lineDirection]})` } as CSSProperties}
        data-direction={lineDirection}
      >
        {!hasData && (
          <div
            className="absolute inset-0 z-1 flex items-center justify-center text-text-muted bg-surface-raised text-small text-center p-3"
            data-testid="price-chart-empty-state"
          >
            Waiting for ticks…
          </div>
        )}
        <div
          ref={containerRef}
          className="w-full h-full [&_.u-cursor-x]:border-l-[var(--tckr-color-text-muted)]! [&_.u-cursor-pt]:border-[var(--tckr-chart-line)]! [&_.u-cursor-pt]:bg-[var(--tckr-chart-line)]!"
          role="img"
          // The range chip and price tags are `aria-hidden` decoration for sighted users; the same
          // numbers go into the image's accessible name so a screen-reader user gets
          // the chart's substance, not just its existence.
          aria-label={
            stats
              ? `Price chart for ${symbol}, ${rangeLabel}: high ${formatYAxisLabel(stats.high, tickSize)}, low ${formatYAxisLabel(stats.low, tickSize)}${referencePrice === undefined ? '' : `, ${(referenceDescription ?? referenceLabel).toLowerCase()} ${format(referencePrice, { decimals: decimalsForTickSize(tickSize) })}`}`
              : `Price chart for ${symbol}, waiting for ticks`
          }
        />
        {stats ? (
          <span aria-hidden="true" className="absolute z-2 font-mono text-caption text-text bg-surface border border-border px-2 py-[3px] rounded-[7px] pointer-events-none top-3 left-3.5">
            {rangeLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

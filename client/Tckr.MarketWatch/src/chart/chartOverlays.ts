/**
 * The DOM that `PriceChart` hangs on uPlot's plot overlay (`plot.over`): the last-price
 * and reference tags on the price axis, the crosshair readout, and the dot that rides
 * the line's end. Positioned by uPlot's draw and cursor hooks with a style write per
 * redraw, never a React render.
 */
import uPlot from 'uplot';
import { format, type DecimalString } from '../contracts/decimal.ts';
import { decimalsForTickSize, formatClockTime, formatYAxisLabel } from './axes.ts';
import { placeAxisTags } from './chartScale.ts';
import { toPlotValue } from './ringBuffer.ts';

/** How long a new sample takes to draw in, and the ring its landing plays on the
 * line's end. Long enough to read as travel, short against the 10s cadence. */
export const LANDING_TWEEN_MS = 720;
const LANDING_RING_MS = 1100;
/** `--tckr-ease-out`, for the Web Animations on the line's end. */
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

/** Live reads from the chart (its props arrive through refs, so these are getters). */
export interface ChartOverlayInputs {
  readonly tickSize: () => DecimalString;
  readonly referencePrice: () => DecimalString | undefined;
  readonly referenceLabel: () => string;
  readonly mutedColor: () => string;
  /** The sample drawing in, if any: text shows its real value, never the in-flight
   * position (see `PriceChart`'s `sampleAndDraw`). */
  readonly landing: () => { t: number; v: number } | null;
}

export interface ChartOverlays {
  /** Append these to `plot.over`. */
  readonly elements: readonly HTMLElement[];
  readonly tagPositions: (u: uPlot) => { last: number | null; ref: number | null };
  /** uPlot `draw` hook: tags, head and the dashed reference line. */
  readonly draw: (u: uPlot) => void;
  /** uPlot `setCursor` hook: the crosshair readout. */
  readonly updateReadout: (u: uPlot) => void;
  /** Plays the landing ring on the head; `1` for a rise, `-1` for a fall. */
  readonly ring: (direction: 1 | -1) => void;
}

export function createChartOverlays(inputs: ChartOverlayInputs): ChartOverlays {
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
    const inFlight = inputs.landing() !== null && idx === (u.data[0]?.length ?? 0) - 1;
    readoutTime.textContent = formatClockTime(inFlight ? inputs.landing()!.t : t);
    readoutPrice.textContent = formatYAxisLabel(
      inFlight ? inputs.landing()!.v : v,
      inputs.tickSize(),
    );
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
    const refPrice = inputs.referencePrice();
    const ref = refPrice === undefined ? null : toPlotValue(refPrice);
    return placeAxisTags(
      last === null ? null : u.valToPos(last, 'y'),
      ref === null ? null : u.valToPos(ref, 'y'),
    );
  };

  const drawOverlays = (u: uPlot): void => {
    const last = lastValue(u);
    const positions = tagPositions(u);
    if (last === null || positions.last === null) {
      lastTag.hidden = true;
    } else {
      lastTag.hidden = false;
      lastTag.textContent = formatYAxisLabel(inputs.landing()?.v ?? last, inputs.tickSize());
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

    const ref = inputs.referencePrice();
    if (ref === undefined || last === null || positions.ref === null) {
      referenceTag.hidden = true;
      return;
    }
    const refValue = toPlotValue(ref);
    const { ctx, bbox } = u;
    const y = Math.round(u.valToPos(refValue, 'y', true)) + 0.5;
    ctx.save();
    ctx.strokeStyle = inputs.mutedColor();
    ctx.lineWidth = uPlot.pxRatio;
    ctx.setLineDash([4 * uPlot.pxRatio, 4 * uPlot.pxRatio]);
    ctx.beginPath();
    ctx.moveTo(bbox.left, y);
    ctx.lineTo(bbox.left + bbox.width, y);
    ctx.stroke();
    ctx.restore();
    referenceTag.hidden = false;
    referenceTag.textContent = `${inputs.referenceLabel()} ${format(ref, { decimals: decimalsForTickSize(inputs.tickSize()) })}`;
    referenceTag.style.top = `${positions.ref}px`;
  };

  const ring = (direction: 1 | -1): void => {
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

  return {
    elements: [head, lastTag, referenceTag, readout],
    tagPositions,
    draw: drawOverlays,
    updateReadout,
    ring,
  };
}

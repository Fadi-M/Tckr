/**
 * `PriceChart`'s uPlot configuration: scales, the one series, the time and price axes,
 * and the cursor. Colours and live values come in as functions, which uPlot re-evaluates
 * on every draw, so a theme or reference change is a redraw, never a new instance.
 */
import uPlot from 'uplot';
import type { DecimalString } from '../contracts/decimal.ts';
import { formatXAxisTick, formatYAxisLabel, timeAxisSplits, X_AXIS_INCREMENTS_MS } from './axes.ts';
import { PRICE_AXIS_SIZE_PX, TIME_AXIS_SIZE_PX } from './chartGeometry.ts';
import { chartYRange, isUnderAxisTag } from './chartScale.ts';
import { toPlotValue } from './ringBuffer.ts';

/** Below this plot width the line draws finer (see the series `width`). */
export const NARROW_PLOT_PX = 480;
// Axis labels are canvas text, so the font is spelled out rather than inherited; the
// family matches every other number on the page (IBM Plex Mono, tabular by design).
const AXIS_FONT = '500 11px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
// Top padding leaves room for the range chip so the line never runs underneath it; the
// left padding lets the first time label (centred on the session's first point) fit.
const PLOT_PADDING: [number, number, number, number] = [40, 6, 0, 30];

// The area fill's strength, as a share of its colour.
const FILL_TINT = '14%';

function tint(color: string): string {
  return `color-mix(in srgb, ${color} ${FILL_TINT}, transparent)`;
}

export interface PlotOptionsInput {
  readonly symbol: string;
  readonly width: number;
  readonly height: number;
  readonly colors: {
    readonly accent: () => string;
    readonly border: () => string;
    readonly muted: () => string;
  };
  /** The reference price in plot space, or `null` when there is none. */
  readonly referenceValue: () => number | null;
  readonly tickSize: () => DecimalString;
  readonly tagPositions: (u: uPlot) => { last: number | null; ref: number | null };
  readonly hooks: uPlot.Hooks.Arrays;
}

export function buildPlotOptions(input: PlotOptionsInput): uPlot.Options {
  return {
    width: input.width,
    height: input.height,
    padding: PLOT_PADDING,
    scales: {
      x: { time: false },
      y: {
        range: (_u, min, max) =>
          chartYRange(min, max, input.referenceValue(), toPlotValue(input.tickSize())),
      },
    },
    series: [
      {},
      {
        label: input.symbol,
        stroke: input.colors.accent,
        // A phone-width plot packs a whole session (~540 samples) into ~250px, so a
        // 2.5px line overlaps itself into a solid band; a finer line keeps its shape.
        width: input.width < NARROW_PLOT_PX ? 1.5 : 2.5,
        // The whole area under the line, in a tint of the line's own colour: one
        // colour for the whole session, by its direction (see `direction`).
        fill: () => tint(input.colors.accent()),
        points: { show: false },
      },
    ],
    // A sparse Cairo-time axis along the bottom and a price axis on the right, the
    // side the eye lands on after reading the line left to right. Labels are canvas
    // text in the muted token; horizontal gridlines only, no tick marks.
    axes: [
      {
        side: 2,
        stroke: input.colors.muted,
        font: AXIS_FONT,
        size: TIME_AXIS_SIZE_PX,
        gap: 8,
        space: 88,
        incrs: [...X_AXIS_INCREMENTS_MS],
        // Both ends always labelled, interior steps only where they fit (see
        // `timeAxisSplits`); `space` in CSS px converted to the scale's ms.
        splits: (u, _axisIdx, min, max, incr, space) =>
          timeAxisSplits(
            min,
            max,
            incr,
            (space * (max - min)) / Math.max(1, u.bbox.width / uPlot.pxRatio),
          ),
        grid: { show: false },
        ticks: { show: false },
        values: (_u, splits, _axisIdx, _space, incr) => splits.map((v) => formatXAxisTick(v, incr)),
      },
      {
        side: 1,
        stroke: input.colors.muted,
        font: AXIS_FONT,
        size: PRICE_AXIS_SIZE_PX,
        gap: 8,
        space: 44,
        grid: { show: true, stroke: input.colors.border, width: 1 },
        ticks: { show: false },
        values: (u, splits) => {
          const { last, ref } = input.tagPositions(u);
          // On a narrow plot the two tags already give the scale two exact anchors;
          // axis labels between them only crowd a ~90px strip of a ~250px chart.
          if (last !== null && ref !== null && u.bbox.width / uPlot.pxRatio < NARROW_PLOT_PX) {
            return splits.map(() => '');
          }
          return splits.map((v) =>
            isUnderAxisTag(u.valToPos(v, 'y'), [last, ref])
              ? ''
              : formatYAxisLabel(v, input.tickSize()),
          );
        },
      },
    ],
    legend: { show: false },
    hooks: input.hooks,
    cursor: {
      show: true,
      x: true,
      y: false,
      points: { show: true },
    },
  };
}

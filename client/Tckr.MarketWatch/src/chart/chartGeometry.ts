/**
 * The price chart's axis bands, shared by `PriceChart` (which hands them to uPlot) and
 * `ChartSkeleton` (which draws its stand-in label shapes in the same places). Kept out of
 * `PriceChart.tsx` so the skeleton can be used without importing uPlot: the detail
 * pane's loading fallback renders in the entry chunk, before the chart's chunk exists.
 */

/** Wide enough for the longest tag ("Open 466.25" in 11px Plex Mono plus its padding). */
export const PRICE_AXIS_SIZE_PX = 92;
/** The time axis band under the plot. */
export const TIME_AXIS_SIZE_PX = 28;

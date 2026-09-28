/**
 * ChartSkeleton — the price chart's frame before its history arrives: the same height,
 * the same 16px clip, the plot's hairline gridlines, the price-axis labels down the
 * right and the time-axis labels along the bottom, each as a skeleton shape where the
 * real one will print (`PRICE_AXIS_SIZE_PX` / `TIME_AXIS_SIZE_PX` are the live chart's
 * own axis sizes).
 *
 * It never draws a line: a placeholder curve would be a price history that didn't
 * happen. The plot area gets the light sweep instead, so the frame reads as filling in.
 */
import { Skeleton } from '../components/Skeleton.tsx';
import { PRICE_AXIS_SIZE_PX, TIME_AXIS_SIZE_PX } from './chartGeometry.ts';

const GRIDLINES = 5;
const TIME_LABELS = 5;

export function ChartSkeleton({ height }: { readonly height: number }) {
  return (
    <div
      className="relative w-full min-w-0 rounded-2xl overflow-hidden"
      style={{ height }}
      aria-hidden="true"
      data-testid="price-chart-skeleton"
    >
      {/* Plot area: gridlines at the price-axis label positions, and one sweep. */}
      <div
        className="absolute top-0 left-0"
        style={{ right: PRICE_AXIS_SIZE_PX, bottom: TIME_AXIS_SIZE_PX }}
      >
        {Array.from({ length: GRIDLINES }, (_, i) => (
          <span
            key={i}
            className="absolute left-0 right-0 h-px bg-border"
            style={{ top: `${((i + 0.5) / GRIDLINES) * 100}%` }}
          />
        ))}
        <Skeleton className="absolute! inset-0 rounded-none! bg-transparent!" />
      </div>
      {/* Price axis labels, beside each gridline. */}
      {Array.from({ length: GRIDLINES }, (_, i) => (
        <Skeleton
          key={i}
          className="absolute! h-2.5 w-11 -translate-y-1/2"
          style={{
            right: PRICE_AXIS_SIZE_PX - 8 - 44,
            top: `calc((100% - ${TIME_AXIS_SIZE_PX}px) * ${(i + 0.5) / GRIDLINES})`,
          }}
        />
      ))}
      {/* Time axis labels, first and last at the plot's ends as the real axis has them. */}
      <div
        className="absolute left-0 bottom-0 flex items-center justify-between"
        style={{ right: PRICE_AXIS_SIZE_PX, height: TIME_AXIS_SIZE_PX }}
      >
        {Array.from({ length: TIME_LABELS }, (_, i) => (
          <Skeleton key={i} className="h-2.5 w-9" />
        ))}
      </div>
    </div>
  );
}

/**
 * The detail pane's chrome: the pieces its real render and its loading stand-ins share,
 * so a skeleton is the pane's own layout rather than a lookalike that drifts.
 *
 * Deliberately free of the chart and the data layer. `DetailPaneSkeleton` is `App`'s
 * Suspense fallback while `StockDetail`'s chunk (and uPlot with it) is still
 * downloading, so this module ships in the entry chunk; importing `PriceChart` here
 * would pull uPlot in with it, and `App` may not import `src/data/**` at all
 * (`shell.no-data-import.test.ts`).
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { ChartSkeleton } from '../chart/ChartSkeleton.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { DETAIL_HEADING_ID } from './pageAnchors.ts';

/** The detail panel's glass — the price panel, and the not-found state in its place. */
export const DETAIL_PANEL_CLASS =
  'relative flex flex-col py-[22px] px-6 rounded-[22px] bg-glass-card border border-glass-border-card backdrop-blur-[26px] backdrop-saturate-[160%] shadow-float animate-detail-reveal motion-reduce:animate-none reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none contrast-more:bg-surface contrast-more:backdrop-blur-none';

// Base layout/type classes shared by every range pill, plus an active/inactive
// colour variant computed separately — same "don't let two same-property utility
// classes both land on one element" reasoning as `deltaClassName` in StockDetail.
// Replaces `.tckr-detail__range-pill`'s `all: unset` reset: Tailwind has no unset-all
// utility, so every visual property that rule used to reset-then-redeclare is
// re-declared explicitly here instead (mirrors `ThemeToggle`'s own `all: unset`
// conversion elsewhere in this migration).
export const RANGE_PILL_BASE_CLASSES =
  'appearance-none cursor-pointer font-mono text-caption font-semibold py-[7px] px-3.5 rounded-full border outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
export const RANGE_PILL_VARIANT_CLASSES = {
  active: 'bg-text text-surface border-text',
  inactive: 'bg-surface-raised text-text-muted border-border',
} as const;

export function rangePillClassName(active: boolean): string {
  return `${RANGE_PILL_BASE_CLASSES} ${active ? RANGE_PILL_VARIANT_CLASSES.active : RANGE_PILL_VARIANT_CLASSES.inactive}`;
}

/** The chart's height. Side by side with the board (desktop), the detail column is the
 * viewport's height and the chart takes what the header, figures and stat tiles leave,
 * between 340 and 600px, instead of sitting at 340 above empty glass. Stacked (phones,
 * narrow windows) the page scrolls, so it keeps 340. */
const CHART_MIN_HEIGHT = 340;
const CHART_MAX_HEIGHT = 600;
/** Everything in the viewport that isn't the chart, beside the board: the app header,
 * the price panel's own rows and padding, the stat tiles and the gaps between them. */
const CHART_CHROME_HEIGHT = 380;
const SPLIT_QUERY = '(min-width: 801px)';

function chartHeightFor(viewportHeight: number, split: boolean): number {
  if (!split) {
    return CHART_MIN_HEIGHT;
  }
  return Math.round(Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, viewportHeight - CHART_CHROME_HEIGHT)));
}

export function useChartHeight(): number {
  const read = (): number =>
    typeof window.matchMedia === 'function'
      ? chartHeightFor(window.innerHeight, window.matchMedia(SPLIT_QUERY).matches)
      : CHART_MIN_HEIGHT;
  const [height, setHeight] = useState(read);
  useEffect(() => {
    const update = (): void => setHeight(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return height;
}

export function StatTile({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="bg-glass-stat border border-glass-border-stat backdrop-blur-[20px] rounded-2xl py-[13px] px-[15px] reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none contrast-more:bg-surface contrast-more:backdrop-blur-none">
      <span className="block font-mono text-label tracking-[0.14em] uppercase text-text-muted">{label}</span>
      <span data-reveal="figures" className="block mt-[5px] font-mono text-title font-semibold tabular-nums">
        {children}
      </span>
      {note ? (
        <span data-reveal="figures" className="block mt-1 font-mono text-caption tabular-nums text-text-muted">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** A stat tile's value before the first quote: the shape of a `text-title` figure. */
export function StatSkeleton(): JSX.Element {
  return (
    <span className="flex h-6 items-center">
      <Skeleton className="h-4 w-16" />
    </span>
  );
}

/** The price block's shape until the first quote: the display-size price, its two
 * change pills, and the as-of line — each at its real size, so nothing below moves when
 * the figures land. */
export function PriceBlockSkeleton({ symbol, testId }: { readonly symbol: string; readonly testId?: string }) {
  return (
    <div data-testid={testId}>
      <span className="sr-only">Loading {symbol} price…</span>
      <div className="flex items-center gap-3.5 mt-2.5 flex-wrap">
        <Skeleton className="h-[3.25rem] w-[11.5rem] rounded-[10px]" />
        <span className="inline-flex items-center gap-2">
          <Skeleton className="h-8 w-[4.75rem] rounded-full" />
          <Skeleton className="h-8 w-[5.25rem] rounded-full" />
        </span>
      </div>
      <div className="mt-2 h-[1.0875rem] flex items-center">
        <Skeleton className="h-2.5 w-52" />
      </div>
    </div>
  );
}

const STAT_LABELS = ['Open', 'High', 'Low', 'Volume'] as const;

/**
 * The whole pane before `StockDetail` itself has loaded (`App`'s Suspense fallback):
 * the same panel, the symbol (it is in the URL, so it is known), and every figure,
 * control and the chart as shapes. The range pills and close button are shapes too:
 * they can't work yet, and a control that looks live but does nothing is worse than
 * none.
 */
export function DetailPaneSkeleton({ symbol }: { readonly symbol: string }) {
  const chartHeight = useChartHeight();
  return (
    <div className="flex flex-col gap-3" data-testid="stock-detail-fallback">
      <div className={`${DETAIL_PANEL_CLASS} gap-4`}>
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div className="max-[640px]:pr-11">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 id={DETAIL_HEADING_ID} tabIndex={-1} className="font-mono font-semibold text-headline tracking-[0.01em] outline-none">
                {symbol}
              </h2>
              <Skeleton className="inline-block! h-3.5 w-36" />
            </div>
            <PriceBlockSkeleton symbol={symbol} />
          </div>
          <div className="flex items-center gap-1.5 flex-none" aria-hidden="true">
            <Skeleton className="h-8 w-[3.25rem] rounded-full" />
            <Skeleton className="h-8 w-[2.75rem] rounded-full" />
            <Skeleton className="h-8 w-[5.25rem] rounded-full" />
            <Skeleton className="ml-1.5 h-8 w-8 rounded-full max-[640px]:absolute max-[640px]:top-[18px] max-[640px]:right-[18px] max-[640px]:ml-0" />
          </div>
        </div>
        <div>
          <span className="sr-only">Loading chart…</span>
          <ChartSkeleton height={chartHeight} />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
        {STAT_LABELS.map((label) => (
          <StatTile key={label} label={label}>
            <StatSkeleton />
          </StatTile>
        ))}
      </div>
    </div>
  );
}

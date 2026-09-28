/**
 * The board's table model, split out of `StockList.tsx`: column specs, sort state and
 * comparators, the order presets (Exchange order / Most active / Gainers / Losers) and
 * the change-percent tone and text helpers every board surface shares. "The module doc"
 * in comments below means `StockList.tsx`'s.
 */
import { type ReactNode, useState, useEffect } from 'react';
import { type DeltaTone, deltaTone } from '../components/deltaTone.ts';
import { ClockIcon } from '../components/icons.tsx';
import {
  type DecimalString,
  toDecimal,
  multiplyByQuantity,
  compare,
} from '../contracts/decimal.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { formatCairoClock } from '../data/marketCalendar.ts';
import { subscribeBeat, getPacedSymbolSnapshot } from '../display/pacedViews.ts';
import { formatPercentFigure } from '../display/percent.ts';

export const ZERO_DECIMAL: DecimalString = toDecimal('0');
export type SortColumn =
  'symbol' | 'name' | 'price' | 'change' | 'changePercent' | 'volume' | 'value';
export type ColumnKey = SortColumn | 'trend';
type SortDirection = 'asc' | 'desc';
export interface SortState {
  readonly column: SortColumn;
  readonly direction: SortDirection;
}
interface ColumnSpec {
  readonly key: ColumnKey;
  readonly label: string;
  /** Tooltip for a header whose label is shorthand (the sparkline column). */
  readonly title?: string;
  /** Unit printed after the label, in a lighter weight. A tooltip can't be opened on
   * touch, so what a figure is measured in is on the header itself. */
  readonly unit?: string;
  readonly sortable: boolean;
  /** Hidden below the 640px breakpoint (task 03's convention) so the page stays
   * scroll-free at 400px — only Symbol, Price and Change % remain. */
  readonly hideNarrow?: boolean;
  /** Right-aligned figures; the header right-aligns to match. */
  readonly numeric?: boolean;
  /** `table-layout: fixed` (kept for perf/no-reflow — a symbol's price can repaint
   * every `DISPLAY_REFRESH_INTERVAL_MS` and must never trigger a table-wide reflow)
   * otherwise divides the table into 8 *equal* columns regardless of content, which
   * hard-truncates `Name` even when other columns (e.g. `Symbol`, `Volume`) are
   * sitting on unused whitespace, and truncates short headers like "Last update" at
   * narrower widths too. These weights — rendered as a `<colgroup>` below — give
   * `table-layout: fixed`'s perf benefit without its equal-width side effect. They
   * must sum to 100 and stay in the same order as this array. */
  readonly widthPercent: number;
}
// `numeric` columns right-align their header over their right-aligned figures, so a
// column's label sits above the digits it names (the ones and tenths line up under it).
export const COLUMNS: readonly ColumnSpec[] = [
  { key: 'symbol', label: 'Symbol', sortable: true, widthPercent: 8 },
  // "Trend", not a bare "Session": the column is a shape, not a figure — the price's
  // path through the session, open to now (or to the close).
  {
    key: 'trend',
    label: 'Session trend',
    title: 'Price through the session, from the open to now (or to the close)',
    sortable: false,
    hideNarrow: true,
    widthPercent: 12,
  },
  { key: 'name', label: 'Name', sortable: true, hideNarrow: true, widthPercent: 26 },
  { key: 'price', label: 'Price', sortable: true, numeric: true, widthPercent: 10 },
  // Change is measured from the previous close (EGX convention); the caption says so on
  // the board itself, since a tooltip can't be opened on touch.
  {
    key: 'change',
    label: 'Change',
    title: 'Since the previous close',
    sortable: true,
    numeric: true,
    hideNarrow: true,
    widthPercent: 10,
  },
  {
    key: 'changePercent',
    label: 'Change %',
    title: 'Since the previous close',
    sortable: true,
    numeric: true,
    widthPercent: 11,
  },
  {
    key: 'volume',
    label: 'Volume',
    title: 'Shares traded this session',
    sortable: true,
    numeric: true,
    hideNarrow: true,
    widthPercent: 11,
  },
  {
    key: 'value',
    label: 'Value',
    unit: 'EGP',
    title: 'Traded value this session, in EGP (price × shares)',
    sortable: true,
    numeric: true,
    hideNarrow: true,
    widthPercent: 12,
  },
];
/**
 * "updated 13:42:30", once, in the board's caption: every row repaints on the same beat
 * (`src/display/pacedViews.ts`), so the per-row "Last update" column said the same thing
 * 34 times. Its own component, subscribed to the beat, so the clock re-renders this
 * line and never the rows. The time is Cairo's, like every clock on the page. On the
 * DELAYED stream it carries the amber clock: it is when the prices *arrived*, not when
 * they traded.
 */
export function BoardUpdatedAt({ delayed }: { delayed: boolean }): ReactNode {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => subscribeBeat(() => setAt(Date.now())), []);
  if (at === null) {
    return null;
  }
  return (
    <span data-testid="board-updated-at" className={delayed ? 'text-warning' : undefined}>
      {' · '}
      {delayed ? <ClockIcon size={11} className="inline -mt-0.5 mr-1" /> : null}
      updated <span className="font-mono">{formatCairoClock(at)}</span>
    </span>
  );
}
/** The columns the table renders: all of them, minus the `hideNarrow` ones when the
 * list is narrow (split pane or a phone-width viewport). The header, the `<colgroup>` and every row read this one list, so
 * they can never disagree. */
export function visibleColumns(narrow: boolean): readonly ColumnSpec[] {
  return COLUMNS.filter((column) => !(narrow && column.hideNarrow));
}
/** `table-layout: fixed`'s `<colgroup>` widths don't give a left-out column's share back
 * to the others, so each visible column's `widthPercent` is rescaled against the
 * visible total: the row always fills 100%, whichever columns it shows. */
export function columnWidthPercent(column: ColumnSpec, columns: readonly ColumnSpec[]): number {
  const total = columns.reduce((sum, visible) => sum + visible.widthPercent, 0);
  return (column.widthPercent / total) * 100;
}
type Preset = 'exchange' | 'most-active' | 'gainers' | 'losers';
// `hint` says what each ordering ranks by — the tooltip and accessible description for
// a label ("Most active") that doesn't say it on its own. "Exchange order" is the
// unsorted board and the lit default, so there is always a named way back after a
// header sort. No A–Z preset: the Symbol header already does exactly that, and the
// presets are for the orderings a trader asks for by name.
export const PRESETS: readonly {
  readonly id: Preset;
  readonly label: string;
  readonly hint: string;
  readonly sort: SortState | null;
}[] = [
  {
    id: 'exchange',
    label: 'Exchange order',
    hint: 'The order EGX lists its instruments in',
    sort: null,
  },
  {
    id: 'most-active',
    label: 'Most active',
    hint: 'Highest traded value (EGP) this session first',
    sort: { column: 'value', direction: 'desc' },
  },
  {
    id: 'gainers',
    label: 'Gainers',
    hint: 'Biggest rise first',
    sort: { column: 'changePercent', direction: 'desc' },
  },
  {
    id: 'losers',
    label: 'Losers',
    hint: 'Biggest fall first',
    sort: { column: 'changePercent', direction: 'asc' },
  },
];
export function presetFor(sortState: SortState | null): Preset | null {
  const match = PRESETS.find((preset) =>
    preset.sort === null || sortState === null
      ? preset.sort === sortState
      : preset.sort.column === sortState.column && preset.sort.direction === sortState.direction,
  );
  return match?.id ?? null;
}
/**
 * What order the board is in, in words — the table's caption, so the order is never
 * implied only by which pill or header arrow happens to be lit (and nothing is lit by
 * default). A preset names itself and what it ranks by; any other column sort says
 * which column and which way; no sort is the order the exchange lists instruments in.
 */

export function describeOrder(sortState: SortState | null): string {
  if (sortState === null) {
    return 'Exchange order';
  }
  const preset = PRESETS.find((candidate) => candidate.id === presetFor(sortState));
  if (preset && preset.sort !== null) {
    return `${preset.label} · ${preset.hint}`;
  }
  const column = COLUMNS.find((candidate) => candidate.key === sortState.column);
  const way = column?.numeric
    ? sortState.direction === 'asc'
      ? 'lowest first'
      : 'highest first'
    : sortState.direction === 'asc'
      ? 'A–Z'
      : 'Z–A';
  return `Sorted by ${column?.label ?? sortState.column}, ${way}`;
}
/** A symbol's traded value this session (last price × shares traded), exact — how
 * EGX ranks "most active". Reads the store unless the caller already holds the view.
 * Before the first snapshot: the reference price × 0. */
export function tradedValue(
  definition: SymbolDefinition,
  view = getPacedSymbolSnapshot(definition.symbol),
): DecimalString {
  return multiplyByQuantity(view?.price ?? definition.referencePrice, view?.volume ?? 0);
}
export function compareBy(column: SortColumn, a: SymbolDefinition, b: SymbolDefinition): number {
  switch (column) {
    case 'symbol':
      return a.symbol.localeCompare(b.symbol);
    case 'name':
      return a.name.localeCompare(b.name);
    case 'price': {
      const pa = getPacedSymbolSnapshot(a.symbol)?.price ?? a.referencePrice;
      const pb = getPacedSymbolSnapshot(b.symbol)?.price ?? b.referencePrice;
      return compare(pa, pb);
    }
    case 'change': {
      const ca = getPacedSymbolSnapshot(a.symbol)?.change ?? ZERO_DECIMAL;
      const cb = getPacedSymbolSnapshot(b.symbol)?.change ?? ZERO_DECIMAL;
      return compare(ca, cb);
    }
    case 'changePercent': {
      const pa = getPacedSymbolSnapshot(a.symbol)?.changePercent ?? 0;
      const pb = getPacedSymbolSnapshot(b.symbol)?.changePercent ?? 0;
      return pa - pb;
    }
    case 'volume': {
      const va = getPacedSymbolSnapshot(a.symbol)?.volume ?? 0;
      const vb = getPacedSymbolSnapshot(b.symbol)?.volume ?? 0;
      return va - vb;
    }
    case 'value':
      return compare(tradedValue(a), tradedValue(b));
    default:
      return 0;
  }
}
/** Below this magnitude a change rounds to "0.00%" at two decimals, so it is shown as
 * unchanged: a coloured "-0.00%" chip would claim a direction the figure can't show.
 * Two decimals everywhere, matching the detail pane, so one move never reads as +0.6%
 * on the board and +0.59% beside it. */
const UNCHANGED_PERCENT_THRESHOLD = 0.005;
export function isEffectivelyUnchanged(changePercent: number): boolean {
  return Math.abs(changePercent) < UNCHANGED_PERCENT_THRESHOLD;
}
/** The chip tone for a change %, matching what `formatSignedPercent` prints: flat when
 * there is none yet or it rounds to "0.00%" (so a neutral figure never wears a colour). */
export function percentTone(changePercent: number | undefined): DeltaTone {
  return changePercent === undefined || isEffectivelyUnchanged(changePercent)
    ? 'flat'
    : deltaTone(changePercent);
}
/**
 * Every row repaints on the same wall-clock beat (`src/display/throttle.ts`), and 34
 * rows changing in one frame reads as the whole board being redrawn. Each row's figures
 * land a few milliseconds after the row above, so a repaint travels down the board as
 * one wave instead. Capped so the last rows are never more than ~quarter of a second
 * behind: the values are already in the DOM; only their arrival animation waits.
 */
const TICK_STAGGER_MS = 9;
const TICK_STAGGER_MAX_MS = 260;
export function tickDelay(boardIndex: number): string {
  return `${Math.min(boardIndex * TICK_STAGGER_MS, TICK_STAGGER_MAX_MS)}ms`;
}
export function formatSignedPercent(value: number): string {
  if (isEffectivelyUnchanged(value)) {
    return '0.00%';
  }
  return `${formatPercentFigure(value)}%`;
}

/**
 * StockList — task 04 (docs/phase-3-web-client/04-stock-list.md), route `/`.
 *
 * Renders the 34-instrument universe as a searchable, sortable table where a tick for
 * one symbol re-renders that row and nothing else (README.md design decision #9). The
 * page itself never subscribes to price data — it owns the symbol list (from
 * `getUniverse()`), the search text and the sort state; each `StockListRow` below
 * subscribes to its own symbol via `useSyncExternalStore`.
 *
 * Sorting by a live column (Price/Change/Change %/Volume/Last update) reads the store
 * *imperatively* through `getSymbolSnapshot` at render time — never reactively. That is
 * deliberate: resorting on every tick would reintroduce the whole-table re-render this
 * page exists to avoid, and would also make rows jump around under a user's cursor. The
 * displayed order is therefore a snapshot taken when the page itself re-renders (mount,
 * a debounced search, or a sort click) — see "Notes for other tasks".
 *
 * ---------------------------------------------------------------------------------
 * "Tckr First Run" design pass additions (docs/decisions — design import)
 * ---------------------------------------------------------------------------------
 * Two presentational/decorative additions live in this file rather than in
 * `App.tsx`, which is contractually data-source-agnostic
 * (`shell.no-data-import.test.ts`), while this page already owns the `/` route and
 * imports `src/data/**`:
 *
 *  - A connection-state banner (`useConnectionBanner`) — an independent observer of the
 *    shared `MarketDataSource`, exactly like `ConnectionStatus` is (and like the now-
 *    deleted `StreamBadge` used to be — multiple independent subscribers to the same
 *    singleton is an established pattern, not a new one). Its "Retry now"/"Reconnect"
 *    buttons call
 *    `reconnectSharedSource()` (`src/data/config.ts`) — the one sanctioned way a call
 *    site may force a fresh connection attempt, for exactly this "one-off user action"
 *    case. A bare `source.connect()` is deliberately NOT used here: it is not safe on
 *    `TckrGatewaySource` while `reconnecting` (see `config.ts`'s doc comment on
 *    `reconnectSharedSource()` for why), so `config.ts` keeps `.connect()` itself off
 *    limits to every call site, with no exception.
 *  - Per-row sparklines — a small bounded (20-point) price history kept in a ref on
 *    each `StockListRow`, persisted in a `useEffect` (same "commit after render, guard
 *    on the value actually changing" shape `PriceCell` already uses for its flash
 *    animation, so it stays StrictMode-safe) and rendered as a tiny inline SVG. Purely
 *    decorative: every price a user can read as *text* still goes through `PriceCell`/
 *    `format()` — the sparkline's own numeric conversion never reaches the page as
 *    text, only as pixel geometry, and reuses `chart/ringBuffer.ts`'s `toPlotValue`
 *    (the one sanctioned `DecimalString` -> `number` conversion for exactly this
 *    purpose) rather than inlining a second, duplicate string-to-number conversion of
 *    its own.
 *
 * ---------------------------------------------------------------------------------
 * "Frosted Glass Revamp" design pass additions (design import:
 * "Tckr.MarketWatch Frosted Glass Revamp/Tckr Market Watch.dc.html")
 * ---------------------------------------------------------------------------------
 *  - The ticker tape marquee ("Tckr First Run"'s `TickerTape`) is removed — the
 *    design import has no scrolling-tape element anywhere in it (checked against
 *    the `.dc.html` directly), and it is the design file, not the prior design
 *    pass, that is the source of truth for this revamp.
 *  - Hero cards (`HeroCards`/`HeroCard`) — Top Gainer / Top Loser / Most Active,
 *    picked from an imperative `getSymbolSnapshot` sweep of the universe on the same
 *    interval discipline as the active-preset re-sort above (never a per-tick
 *    subscription), then each card independently subscribes to its own symbol
 *    exactly like `StockListRow` (same throttled-subscribe/bounded-sparkline shape)
 *    so its own price/percent/spark stay live between hero re-picks. Hidden while a
 *    detail pane is open (mirrors the design's `isDetail`-collapsed hero row).
 *  - Split-pane detail: `/EGX/symbols/:symbol` is now a *child* route of `/`
 *    (`App.tsx`), rendered into this component's own `<Outlet />` rather than
 *    replacing the whole page — the design's list-narrows/detail-slides-in-beside-it
 *    layout. `useMatch(SYMBOL_ROUTE_PATTERN)` tells this component whether a detail
 *    pane is open (and for which symbol) purely from the URL, so opening/closing a
 *    symbol never remounts `StockList` itself (search text, sort state, and every
 *    row's subscription survive) — only the `<Outlet />` content and the grid's
 *    column widths change. `StockDetail` itself is untouched: it already accepts a
 *    bare `symbol` prop and owns its own subscribe/unsubscribe lifecycle, so it
 *    renders identically whether it fills a page or a side pane.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, Outlet, useMatch } from 'react-router-dom';
import {
  compare,
  decimalPlaces,
  format,
  formatCompact,
  multiplyByQuantity,
  toDecimal,
  type DecimalString,
} from '../contracts/decimal.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import { getSharedSource, reconnectSharedSource } from '../data/config.ts';
import type { ConnectionState } from '../data/MarketDataSource.ts';
import type { Stream } from '../contracts/messages.ts';
import { streamDelay } from '../components/streamDelay.ts';
import { BOARD_ID, DETAIL_HEADING_ID } from './pageAnchors.ts';
import { SYMBOL_ROUTE_PATTERN, symbolPath } from './routes.ts';
import {
  getPacedSymbolSnapshot,
  subscribeBeat,
  subscribePacedSymbol,
} from '../display/pacedViews.ts';
import {
  formatCairoClock,
  formatCairoDateShort,
  formatCairoTimeShort,
  formatNextOpen,
  isPreOpenAuction,
  type MarketStatus,
} from '../data/marketCalendar.ts';
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  RetryIcon,
  SearchIcon,
} from '../components/icons.tsx';
import { FormingCandle } from '../motion/FormingCandle.tsx';
import { formatUntil } from '../display/formatUntil.ts';
import { ScrambleWord } from '../motion/ScrambleWord.tsx';
import { loadMotion, loadedMotion, type Motion } from '../motion/motion.ts';
import { closestInstruments } from './closestInstruments.ts';
import { PriceCell } from '../components/PriceCell.tsx';
import { TickingText } from '../components/RollingText.tsx';
import { DELTA_TONE_CLASSES, deltaTone, type DeltaTone } from '../components/deltaTone.ts';
import { isEditableTarget, modifierKeyLabel } from '../components/keyboard.ts';
import { prefersReducedMotion } from '../components/prefersReducedMotion.ts';
import { useMarketStatus } from '../components/useMarketStatus.ts';
import { isHeld, useConnectionState } from '../components/useConnectionState.ts';
import { HeldTag } from '../components/HeldTag.tsx';
import { useViewTransitionNavigate } from '../components/useViewTransitionNavigate.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';
import { formatPercentFigure } from '../display/percent.ts';
import { toPlotValue } from '../chart/ringBuffer.ts';
import { sparklineDirection, useSessionSparkline } from './useBoundedSparkline.ts';

const ZERO_DECIMAL: DecimalString = toDecimal('0');

type SortColumn = 'symbol' | 'name' | 'price' | 'change' | 'changePercent' | 'volume' | 'value';
type ColumnKey = SortColumn | 'trend';
type SortDirection = 'asc' | 'desc';

interface SortState {
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
const COLUMNS: readonly ColumnSpec[] = [
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
function BoardUpdatedAt({ delayed }: { delayed: boolean }): ReactNode {
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
function visibleColumns(narrow: boolean): readonly ColumnSpec[] {
  return COLUMNS.filter((column) => !(narrow && column.hideNarrow));
}

/** `table-layout: fixed`'s `<colgroup>` widths don't give a left-out column's share back
 * to the others, so each visible column's `widthPercent` is rescaled against the
 * visible total: the row always fills 100%, whichever columns it shows. */
function columnWidthPercent(column: ColumnSpec, columns: readonly ColumnSpec[]): number {
  const total = columns.reduce((sum, visible) => sum + visible.widthPercent, 0);
  return (column.widthPercent / total) * 100;
}

type Preset = 'exchange' | 'most-active' | 'gainers' | 'losers';

// `hint` says what each ordering ranks by — the tooltip and accessible description for
// a label ("Most active") that doesn't say it on its own. "Exchange order" is the
// unsorted board and the lit default, so there is always a named way back after a
// header sort. No A–Z preset: the Symbol header already does exactly that, and the
// presets are for the orderings a trader asks for by name.
const PRESETS: readonly {
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

function presetFor(sortState: SortState | null): Preset | null {
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
function tradedValue(
  definition: SymbolDefinition,
  view = getPacedSymbolSnapshot(definition.symbol),
): DecimalString {
  return multiplyByQuantity(view?.price ?? definition.referencePrice, view?.volume ?? 0);
}

function compareBy(column: SortColumn, a: SymbolDefinition, b: SymbolDefinition): number {
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

function isEffectivelyUnchanged(changePercent: number): boolean {
  return Math.abs(changePercent) < UNCHANGED_PERCENT_THRESHOLD;
}

/** The chip tone for a change %, matching what `formatSignedPercent` prints: flat when
 * there is none yet or it rounds to "0.00%" (so a neutral figure never wears a colour). */
function percentTone(changePercent: number | undefined): DeltaTone {
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
function tickDelay(boardIndex: number): string {
  return `${Math.min(boardIndex * TICK_STAGGER_MS, TICK_STAGGER_MAX_MS)}ms`;
}

function formatSignedPercent(value: number): string {
  if (isEffectivelyUnchanged(value)) {
    return '0.00%';
  }
  return `${formatPercentFigure(value)}%`;
}

const NARROW_VIEWPORT_QUERY = '(max-width: 640px)';

/** True below the 640px breakpoint (task 03's convention) — the *other* trigger,
 * besides the split-pane, for narrowing the table down to Symbol/Price/Change %
 * (see `StockListRow`'s `columns` prop doc for why this needs to physically remove
 * the hidden columns from the DOM rather than the CSS-only `display: none` this
 * breakpoint used before the "Frosted Glass Revamp" split-pane pass: that CSS-only
 * approach and `table-layout: fixed`'s per-column `<colgroup>` percentages
 * miscompute in Chromium whenever a hidden column's `<col>` sits ahead of a visible
 * one in the same `<colgroup>` — verified against this exact table, the visible
 * column collapses to ~0 width instead of its specified percentage). Guarded for
 * `window.matchMedia` not existing (jsdom in this repo's test environment has no
 * `matchMedia` — see `shell.banner-everywhere.test.tsx`'s comment) so this always
 * reads `false`, never throws, under test. */
function useNarrowViewport(): boolean {
  const getMatches = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(NARROW_VIEWPORT_QUERY).matches
      : false;
  const [matches, setMatches] = useState(getMatches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const handleChange = () => setMatches(mql.matches);
    handleChange();
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);
  return matches;
}

// ---------------------------------------------------------------------------------
// Connection banner — independent observer of the shared MarketDataSource, mirroring
// (not sharing state with) ConnectionStatus (and the now-deleted StreamBadge). See
// module doc.
// ---------------------------------------------------------------------------------

/** Which stream the viewer is on, from the server's `identity()` only (never a
 * client-side default: `null` until the handshake). Re-read on every status transition
 * and entitlement change, the same two signals the header's StreamBadge follows. */
function useViewerStream(): Stream | null {
  const [stream, setStream] = useState<Stream | null>(
    () => getSharedSource().identity()?.stream ?? null,
  );
  useEffect(() => {
    const source = getSharedSource();
    const refresh = (): void => setStream(source.identity()?.stream ?? null);
    const unsubStatus = source.on.status(refresh);
    const unsubEntitlement = source.on.entitlement(refresh);
    return () => {
      unsubStatus();
      unsubEntitlement();
    };
  }, []);
  return stream;
}

/** Shown while the viewer is on the DELAYED stream, above everything that carries a
 * price — the highlight cards, the board and the detail pane alike — so no price on
 * the page can be taken for a live one (the header badge alone was one small pill).
 * A lighter amber than the "stream dropped" warning: this is an entitlement, not a
 * fault (DESIGN.md, "The Tinted Status Rule": 9% tint, 24% border). */
function DelayedStreamBanner() {
  const delay = streamDelay();
  return (
    <div
      className={`${CONN_BANNER_BASE} ${CONN_BANNER_DELAYED}`}
      role="note"
      data-testid="delayed-stream-banner"
    >
      <ClockIcon className="text-warning" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-small">Delayed prices · {delay.short} behind</div>
        {/* On a phone the title carries it: the header badge already says DELAYED, and
            the explanation would push the board a banner-height further down. */}
        <div className="mt-[3px] text-caption text-text-muted max-[640px]:sr-only">
          {delay.simulated
            ? `Every price on this page is ${delay.short} behind the exchange (simulated; a real delayed entitlement is 15\u00a0min).`
            : `Every price on this page is ${delay.short} behind the exchange, per your entitlement.`}
        </div>
      </div>
    </div>
  );
}

function useConnectionBanner(): {
  state: ConnectionState;
  remainingSecs: number;
  heldSince: number | null;
} {
  const { state, eventReceivedAt, heldSince } = useConnectionState();
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (state.kind !== 'reconnecting') {
      return;
    }
    const id = setInterval(() => forceTick(), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const remainingSecs =
    state.kind === 'reconnecting'
      ? Math.max(0, Math.ceil((state.nextRetryMs - (Date.now() - eventReceivedAt)) / 1000))
      : 0;

  return { state, remainingSecs, heldSince };
}

function closeDetail(code: CloseCode): string {
  switch (code) {
    case CloseCode.Normal:
      return 'The stream closed and will not retry on its own.';
    case CloseCode.Unauthenticated:
      return 'Not authenticated. Sign in again, then reconnect.';
    case CloseCode.TokenExpired:
      return 'Your session expired.';
    case CloseCode.HeartbeatTimeout:
      return 'The connection timed out.';
    case CloseCode.SlowConsumer:
      return 'This client fell behind and was disconnected. Try watching fewer symbols.';
  }
}

// Shared banner treatment — ConnectionBanner (warning/danger) and MarketClosedBanner
// (info) all render the same frosted-glass pill shape, animate in the same way, and
// share the same reduced-transparency/contrast-more opaque fallback (previously
// `.tckr-conn-banner` + a `--warning`/`--danger`/`--info` modifier). Each tone's
// background/border is a `color-mix` the design tokens don't expose as a plain
// utility, so it stays as an arbitrary value here rather than a new token.
const CONN_BANNER_BASE =
  'flex items-center gap-3 px-4 py-3 rounded-full mb-3.5 backdrop-blur-tckr backdrop-saturate-150 animate-banner-in reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';
const CONN_BANNER_WARNING =
  'bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-warning)_32%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-color-surface))]';
const CONN_BANNER_DANGER =
  'bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-down)_32%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-down)_16%,var(--tckr-color-surface))]';
const CONN_BANNER_INFO =
  'bg-glass border border-glass-border reduced-transparency:bg-surface contrast-more:bg-surface';
const CONN_BANNER_DELAYED =
  'bg-[color-mix(in_oklab,var(--tckr-color-warning)_9%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-warning)_24%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-warning)_9%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-warning)_9%,var(--tckr-color-surface))]';
const CONN_BANNER_GOOD =
  'bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,var(--tckr-glass-bg))] border border-[color-mix(in_oklab,var(--tckr-color-up)_28%,transparent)] reduced-transparency:bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,var(--tckr-color-surface))] contrast-more:bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,var(--tckr-color-surface))]';
// 75px = the sticky app header (59px) + a 16px gap, the same offset the detail pane uses.
const CONN_BANNER_STICKY = 'sticky top-[75px] z-[4]';
const CONN_BANNER_STICKY_PHONE = 'max-[800px]:sticky max-[800px]:top-[75px] max-[800px]:z-[4]';
const BANNER_DISMISS =
  'flex-none text-caption font-medium text-text-muted px-2.5 py-1.5 rounded-md cursor-pointer [transition:color_150ms_ease] fine-hover:text-text focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
const CONN_BANNER_ACTION =
  'font-semibold text-caption px-[13px] py-[7px] rounded-md border border-border bg-text text-surface cursor-pointer flex-none [transition:transform_120ms_ease-out,opacity_150ms_ease] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';

function ConnectionBanner({
  state,
  remainingSecs,
  className = '',
}: {
  state: ConnectionState;
  remainingSecs: number;
  className?: string;
}) {
  if (state.kind === 'reconnecting') {
    return (
      <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_WARNING} ${className}`} role="alert">
        <RetryIcon className="text-warning" />
        <div className="flex-1 min-w-0">
          {/* The countdown ticks every second inside this alert region; hiding it from
              assistive tech keeps the alert to one announcement, not one per second. */}
          <div className="font-semibold text-small">
            The stream dropped<span aria-hidden="true"> — retrying in {remainingSecs}s</span>
            <span className="sr-only"> — retrying automatically</span>
          </div>
          <div className="mt-[3px] text-caption text-text-muted">
            Attempt {state.attempt}. Prices below are the last values received and are no longer
            moving.
          </div>
        </div>
        <button
          type="button"
          className={CONN_BANNER_ACTION}
          onClick={() => {
            reconnectSharedSource();
          }}
        >
          Retry now
        </button>
      </div>
    );
  }

  if (state.kind === 'closed') {
    return (
      <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_DANGER} ${className}`} role="alert">
        <AlertIcon className="text-down" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-small">Disconnected</div>
          <div className="mt-[3px] text-caption text-text-muted">{closeDetail(state.code)}</div>
        </div>
        <button
          type="button"
          className={CONN_BANNER_ACTION}
          onClick={() => {
            reconnectSharedSource();
          }}
        >
          Reconnect
        </button>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------------
// Market-closed banner — an independent observer of `marketCalendar.getMarketStatus()`
// (via `useMarketStatus`), not the connection/transport (`ConnectionBanner` above).
// EGX being closed overnight/on the weekend/outside session hours is routine, expected
// state, distinct from a dropped WebSocket — the two must never be conflated into one
// banner, since a user restarting a healthy connection can't do anything about market
// hours, and vice versa.
// ---------------------------------------------------------------------------------

export { formatUntil } from '../display/formatUntil.ts';

/**
 * True for `durationMs` after `trigger` is raised (see callers), plus a dismiss. Used
 * for the two moments this page marks once and then gets out of the way: the opening
 * bell and a recovered stream. Never on mount — only a change observed while mounted.
 */
function useMoment(durationMs: number): { shown: boolean; show: () => void; dismiss: () => void } {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) {
      return;
    }
    const id = setTimeout(() => setShown(false), durationMs);
    return () => clearTimeout(id);
  }, [shown, durationMs]);
  return {
    shown,
    show: useCallback(() => setShown(true), []),
    dismiss: useCallback(() => setShown(false), []),
  };
}

/** The opening bell: shown once when EGX opens while this page is open. */
function useOpeningBell(status: MarketStatus) {
  const moment = useMoment(8000);
  const previousState = useRef(status.state);
  const { show } = moment;
  useEffect(() => {
    if (previousState.current === 'closed' && status.state === 'open') {
      show();
    }
    previousState.current = status.state;
  }, [status.state, show]);
  return moment;
}

/** Shown briefly when the stream comes back after a drop, so recovery is confirmed
 * rather than inferred from a warning that silently disappeared. */
function useRecoveryMoment(state: ConnectionState) {
  const moment = useMoment(4000);
  const interrupted = useRef(false);
  const { show } = moment;
  useEffect(() => {
    if (state.kind === 'reconnecting' || state.kind === 'closed') {
      interrupted.current = true;
    } else if (state.kind === 'connected' && interrupted.current) {
      interrupted.current = false;
      show();
    }
  }, [state.kind, show]);
  return moment;
}

function MomentBanner({
  icon,
  title,
  detail,
  onDismiss,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onDismiss: () => void;
}) {
  return (
    <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_GOOD}`} role="status">
      <span className="flex-none text-up">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-small">{title}</div>
        <div className="mt-[3px] text-caption text-text-muted">{detail}</div>
      </div>
      <button type="button" className={BANNER_DISMISS} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** `compact`: the split view's ~380px list column, where the full sentence wrapped to
 * three lines and pushed the board down. The chart beside it already says which session
 * it shows, so the column keeps only when trading resumes. */
function MarketClosedBanner({
  status,
  className = '',
  compact = false,
}: {
  status: MarketStatus;
  className?: string;
  compact?: boolean;
}) {
  if (status.state !== 'closed') {
    return null;
  }
  // 09:30–10:00 Cairo is EGX's pre-open auction: orders are being collected but nothing
  // trades until the 10:00 open, so it gets its own wording rather than a flat "closed".
  const now = Date.now();
  const preOpen = isPreOpenAuction(status, now);
  // Re-rendered every 30s by `useMarketStatus`, so the countdown stays current to the
  // minute without a clock of its own.
  const until = formatUntil(status.nextOpenAt - now);
  return (
    <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_INFO} ${className}`} role="status">
      <ClockIcon className="text-text-muted" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-small">
          {preOpen ? 'Pre-open auction' : 'Market closed'}
        </div>
        <div className="mt-[3px] text-caption text-text-muted">
          {/* The relative countdown is visual only: it changes every minute inside a
              status region, and the absolute Cairo time already says when. */}
          {compact ? (
            <>
              {preOpen ? 'Trading starts' : 'Reopens'} {formatNextOpen(status, now)} Cairo
            </>
          ) : preOpen ? (
            <>
              Continuous trading starts at {formatCairoTimeShort(status.nextOpenAt)} Cairo time
              <span aria-hidden="true">, {until}</span>. Prices below are from the last completed
              session.
            </>
          ) : (
            <>
              Showing the last completed session. Reopens {formatNextOpen(status, now)} Cairo time
              <span aria-hidden="true">, {until}</span>.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Sparkline — decorative only. See module doc for the "text vs. pixel geometry"
// boundary this keeps.
// ---------------------------------------------------------------------------------

function Sparkline({
  points,
  direction,
  variant = 'row',
}: {
  points: readonly number[];
  direction: 'up' | 'down' | 'flat';
  /** `'row'` (the default, `StockListRow`'s inline cell) sizes to `width:100%;
   * height:24px` (`h-6`). `'hero'` (`HeroCard`'s price row) instead sizes to the fixed
   * `96px x 30px` the design gives it there — this is a *different, non-overlapping*
   * className, not a base-then-override pair, so the two sizings never fight over
   * the same `width`/`height` utility (previously a `.tckr-hero__price-row
   * .tckr-sparkline` descendant-selector override). */
  variant?: 'row' | 'hero';
}) {
  const sizeClass = variant === 'hero' ? 'block w-24 h-[30px] flex-none' : 'block w-full h-6';
  const lineClass = `[stroke-width:1.6] [transition:stroke_200ms_ease] ${
    direction === 'up' ? 'stroke-up' : direction === 'down' ? 'stroke-down' : 'stroke-text-muted'
  }`;
  if (points.length < 2) {
    return (
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" className={sizeClass} aria-hidden="true">
        <line x1="0" y1="17" x2="100" y2="17" className={lineClass} />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(2)},${(30 - ((p - min) / span) * 28).toFixed(2)}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className={sizeClass} aria-hidden="true">
      <polyline points={coords} fill="none" className={lineClass} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------
// Hero cards — Top Gainer / Top Loser / Most Active. See module doc.
// ---------------------------------------------------------------------------------

interface HeroPick {
  readonly kind: 'gainer' | 'loser' | 'active';
  readonly kicker: string;
  readonly definition: SymbolDefinition;
}

/** Imperative, one-shot read of the whole universe's current snapshots — same
 * "poll on an interval, never subscribe per-tick" discipline as `TickerTape`/the
 * active-sort-preset resort above. Falls back to each definition's own
 * `referencePrice`/0 for a symbol with no snapshot yet (pre-first-tick), so the
 * picks are stable even immediately after mount. */
function pickHeroes(universe: readonly SymbolDefinition[]): readonly HeroPick[] {
  if (universe.length === 0) {
    return [];
  }
  const metrics = universe.map((definition) => {
    const view = getPacedSymbolSnapshot(definition.symbol);
    return { definition, changePercent: view?.changePercent ?? 0, value: tradedValue(definition) };
  });
  const gainer = [...metrics].sort((a, b) => b.changePercent - a.changePercent)[0]!;
  const loser = [...metrics].sort((a, b) => a.changePercent - b.changePercent)[0]!;
  const active = [...metrics].sort((a, b) => compare(b.value, a.value))[0]!;
  const candidates: readonly HeroPick[] = [
    { kind: 'gainer', kicker: 'TOP GAINER', definition: gainer.definition },
    { kind: 'loser', kicker: 'TOP LOSER', definition: loser.definition },
    { kind: 'active', kicker: 'MOST ACTIVE', definition: active.definition },
  ];
  // A card only shows a symbol its label is true of: when nothing on the board is up,
  // there is no top gainer (the least-down stock is not one), and likewise for losers.
  // A tiny universe (or a fixture in a test) can have the same symbol win more than
  // one slot — keep only the first (highest-priority) pick per symbol so a card never
  // renders twice.
  const qualifies = (pick: HeroPick, changePercent: number): boolean =>
    pick.kind === 'active' ||
    (!isEffectivelyUnchanged(changePercent) &&
      (pick.kind === 'gainer' ? changePercent > 0 : changePercent < 0));
  const changeOf = new Map(metrics.map((m) => [m.definition.symbol, m.changePercent]));
  const seen = new Set<string>();
  return candidates.filter((pick) => {
    if (!qualifies(pick, changeOf.get(pick.definition.symbol) ?? 0)) {
      return false;
    }
    if (seen.has(pick.definition.symbol)) {
      return false;
    }
    seen.add(pick.definition.symbol);
    return true;
  });
}

interface HeroCardProps {
  readonly kicker: string;
  readonly kind: HeroPick['kind'];
  readonly definition: SymbolDefinition;
  readonly priceDecimals: number;
  readonly onActivate: (symbol: string) => void;
  /** Same as `StockListRowProps.sessionTrend`. */
  readonly sessionTrend?: readonly number[] | undefined;
  /** While EGX is closed the picks describe a past session, e.g. `"Thu 24 Sep"`;
   * `undefined` while it trades, when "today" goes without saying. */
  readonly sessionDate?: string | undefined;
  /** The card's place in the row, which staggers its closing-bell label. */
  readonly index?: number;
}

// `all: unset` on the card button had no direct Tailwind equivalent (see module's
// migration notes) — only the native-button chrome that the rest of this rule does
// NOT go on to re-declare (appearance, margin, outline, inherited text properties)
// needs an explicit reset here; every property the original rule re-declares after
// `all: unset` (box-sizing, cursor, width, padding, border-radius, background,
// backdrop-filter, border, box-shadow, transition) is just applied directly below,
// with no separate reset step, so there is never a same-property class pair whose
// winner depends on Tailwind's internal utility ordering.
const HERO_CARD_CLASS =
  'appearance-none m-0 p-0 outline-none text-inherit text-left box-border cursor-pointer w-full max-[640px]:w-[78%] max-[640px]:flex-none max-[640px]:snap-start max-[640px]:pt-3 max-[640px]:px-4 max-[640px]:pb-3 pt-4 px-[18px] pb-[15px] rounded-[20px] bg-glass border border-glass-border shadow-float backdrop-blur-tckr backdrop-saturate-[1.6] [transition:transform_160ms_ease-out,border-color_160ms_ease] fine-hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2 reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';

function HeroCard({
  kicker,
  kind,
  definition,
  priceDecimals,
  onActivate,
  sessionTrend,
  sessionDate,
  index = 0,
}: HeroCardProps) {
  const { symbol, name, referencePrice } = definition;

  // The closing bell: when EGX closes while this card is on screen, its label's session
  // day ("· THU") resolves in, the three cards one after another, marking that the picks
  // are now a recap. A page opened on a closed market just shows it (never on first paint).
  const sawTrading = useRef(sessionDate === undefined);
  const closedWhileWatching = sawTrading.current && sessionDate !== undefined;
  useEffect(() => {
    sawTrading.current = sessionDate === undefined;
  }, [sessionDate]);

  // Same throttled-subscribe shape as `StockListRow` — see that component's doc for
  // why a hand-rolled interval/gate is the wrong tool here.
  // Paced, not live: a render between beats (a click, a sort) shows what the last beat
  // painted — see `src/display/pacedViews.ts`.
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribePacedSymbol(symbol, onStoreChange),
    [symbol],
  );
  const view = useSyncExternalStore(subscribe, () => getPacedSymbolSnapshot(symbol));

  const priceMuted = view === undefined;
  const price = view?.price ?? referencePrice;
  const changePercent = view?.changePercent;
  const valueLabel = view ? `EGP ${formatCompact(tradedValue(definition, view))}` : '—';
  const delayed = view?.stream === 'DELAYED';

  // Session sparkline — same shape/purpose as `StockListRow`'s (decorative only; every
  // price shown as *text* here still goes through `PriceCell`), seeded from the
  // session history via `useSessionSparkline`, with this card's own 26-point cap.
  const currentPriceNum = toPlotValue(price);
  const sparklinePoints = useSessionSparkline(currentPriceNum, 26, sessionTrend);
  const direction = sparklineDirection(changePercent);

  const badgeText =
    kind === 'active'
      ? valueLabel
      : changePercent === undefined
        ? '—'
        : formatSignedPercent(changePercent);
  // Most active shows a traded value, not a move, so its badge stays neutral.
  const badgeDeltaClass =
    DELTA_TONE_CLASSES[kind === 'active' ? 'flat' : percentTone(changePercent)];

  const directionWord = direction === 'flat' ? 'unchanged' : direction;
  // On a closed day "Top gainer" would otherwise read as today's; the weekday alone
  // fits the card's label row, and the accessible name carries the full date.
  const kickerDay =
    sessionDate === undefined ? null : ` · ${sessionDate.split(' ')[0]!.toUpperCase()}`;
  const spokenKicker = sessionDate === undefined ? kicker : `${kicker}, ${sessionDate} session`;
  const baseAriaLabel =
    kind === 'active'
      ? `${spokenKicker}: ${symbol}, ${String(price)}, traded value ${valueLabel}`
      : changePercent === undefined
        ? `${spokenKicker}: ${symbol}, ${String(price)}`
        : `${spokenKicker}: ${symbol}, ${String(price)}, ${directionWord} ${formatPercentFigure(changePercent, { magnitude: true })}%`;
  // Same rule as a board row: a delayed price is never read, or shown, as live.
  const ariaLabel = delayed ? `${baseAriaLabel}, delayed stream` : baseAriaLabel;

  return (
    <button
      type="button"
      className={HERO_CARD_CLASS}
      aria-label={ariaLabel}
      onClick={() => onActivate(symbol)}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-label font-semibold tracking-[0.14em] ${delayed ? 'text-warning' : 'text-text-muted'}`}
          aria-hidden="true"
        >
          {delayed ? <ClockIcon size={11} /> : null}
          <span>
            {kicker}
            {kickerDay === null ? null : (
              <ScrambleWord
                key={kickerDay}
                text={kickerDay}
                from={closedWhileWatching ? '' : undefined}
                delay={index * 0.09}
              />
            )}
          </span>
        </span>
        <span
          className={`font-mono text-label font-semibold px-2.5 py-[3px] rounded-full whitespace-nowrap [transition:background-color_600ms_var(--tckr-ease-out),color_600ms_var(--tckr-ease-out)] ${badgeDeltaClass}`}
          aria-hidden="true"
        >
          <TickingText
            text={badgeText}
            direction={changePercent !== undefined && changePercent < 0 ? 'down' : 'up'}
          />
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-3 min-w-0" aria-hidden="true">
        <span className="font-mono font-semibold text-title">{symbol}</span>
        <span className="text-caption text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">
          {name}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2.5 mt-2.5" aria-hidden="true">
        <span className="font-mono font-semibold text-price">
          <PriceCell
            value={price}
            decimals={priceDecimals}
            muted={priceMuted}
            flashDirectionOverride={
              changePercent === undefined
                ? undefined
                : changePercent > 0
                  ? 'up'
                  : changePercent < 0
                    ? 'down'
                    : null
            }
          />
        </span>
        <Sparkline points={sparklinePoints} direction={direction} variant="hero" />
      </div>
    </button>
  );
}

function HeroCards({
  universe,
  priceDecimalsBySymbol,
  onActivate,
  sessionTrends,
  sessionDate,
}: {
  universe: readonly SymbolDefinition[] | null;
  priceDecimalsBySymbol: Map<string, number>;
  onActivate: (symbol: string) => void;
  sessionTrends: ReadonlyMap<string, readonly number[]>;
  sessionDate: string | undefined;
}) {
  // Top Gainer / Top Loser / Most Active — re-picked on the price beat itself
  // (`subscribeBeat`), in the same commit as the figures they are picked by, so a card's
  // label and its numbers are one read and can never contradict each other. The pick
  // lives here, not in `StockList`, so a beat re-renders these cards and never the
  // board's 34 rows.
  const [heroTick, forceHeroRecompute] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!universe) {
      return undefined;
    }
    return subscribeBeat(forceHeroRecompute);
  }, [universe]);
  // `heroTick` is intentionally in this array even though the body never reads it —
  // bumping it is exactly what forces this memo to recompute on the beat above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const picks = useMemo(() => (universe ? pickHeroes(universe) : []), [universe, heroTick]);
  if (picks.length === 0) {
    return null;
  }
  return (
    // Below 640px the three cards stacked to ~430px and pushed the board — the page's
    // reason to exist — below the first screen. There they become one swipeable row
    // (the next card peeks in at the edge, so the row reads as scrollable) that bleeds
    // to the screen edge; the glass shadows get vertical room so the scroller doesn't
    // clip them.
    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] max-[640px]:flex max-[640px]:gap-2.5 max-[640px]:overflow-x-auto max-[640px]:snap-x max-[640px]:snap-mandatory max-[640px]:-mx-3 max-[640px]:px-3 max-[640px]:scroll-px-3 max-[640px]:pt-0.5 max-[640px]:pb-3 max-[640px]:-mb-3 max-[640px]:[scrollbar-width:none] max-[640px]:[&::-webkit-scrollbar]:hidden">
      {picks.map((pick, index) => (
        <HeroCard
          key={pick.kind}
          index={index}
          kicker={pick.kicker}
          kind={pick.kind}
          definition={pick.definition}
          priceDecimals={priceDecimalsBySymbol.get(pick.definition.symbol) ?? 2}
          onActivate={onActivate}
          sessionTrend={sessionTrends.get(pick.definition.symbol)}
          sessionDate={sessionDate}
        />
      ))}
    </div>
  );
}

// Shared `<th>`/`<td>` base — previously the tag-selector `.tckr-stocklist__table
// th, .tckr-stocklist__table td { ... }`, which applied automatically without a
// class; Tailwind utilities need an explicit class on every cell instead. Excludes
// `text-align` on purpose — every cell chooses `text-left` or `text-right` for
// itself (see call sites) rather than this constant asserting one and a numeric
// cell overriding it, which would be two same-specificity utility classes fighting
// over the same property.
// 40px rows (8px + 24px line + 8px) on a mouse — a trading board is read by scanning
// many rows at once — and 44px on touch, the minimum comfortable tap target.
const CELL_BASE =
  'px-3 py-2 pointer-coarse:py-2.5 border-b border-glass-border overflow-hidden text-ellipsis whitespace-nowrap';

interface StockListRowProps {
  readonly definition: SymbolDefinition;
  /** The row's position on the board, which staggers its repaint (see `tickDelay`). */
  readonly boardIndex?: number;
  readonly priceDecimals: number;
  /** The board's widest price precision, so every row's decimal point lines up (see
   * `PriceCell`'s `alignDecimals`). */
  readonly alignDecimals?: number;
  readonly onActivate: (symbol: string) => void;
  /** Whether this row's symbol is the one currently open in the split-pane detail
   * view (see `useMatch(SYMBOL_ROUTE_PATTERN)` in `StockList`). Purely presentational
   * (a glass highlight + accent edge) — never affects subscription lifecycle. */
  readonly selected?: boolean;
  /** The columns this row renders a cell for — `visibleColumns(...)` in `StockList`,
   * the same list its header and `<colgroup>` use. Left-out columns' `<td>`s are
   * omitted from the DOM entirely, not hidden: `table-layout: fixed`'s per-column
   * width comes from each column's `<col>` percentage, and Chromium (verified against
   * this exact table) miscomputes it when a visible column's `<col>` sits *after* a
   * `display: none`-hidden one in the same `<colgroup>`, collapsing it to ~0 width. */
  readonly columns: ReadonlySet<ColumnKey>;
  /** Roving tabindex: exactly one row in the table is a Tab stop (`tabIndex=0`); the
   * rest are `-1` and reached with the arrow keys (see `handleTableKeyDown` in
   * `StockList`). Keeps the whole 34-row table to one Tab stop, so a keyboard user can
   * reach the detail pane beside it without tabbing through every row. */
  readonly tabStop?: boolean;
  readonly onRowFocus?: (symbol: string) => void;
  /** The symbol's full session price history (plot values), for `useSessionSparkline`;
   * `undefined` until `StockList`'s one-time history fetch resolves. */
  readonly sessionTrend?: readonly number[] | undefined;
}

function StockListRow({
  definition,
  priceDecimals,
  alignDecimals,
  onActivate,
  selected = false,
  columns,
  tabStop = true,
  onRowFocus,
  sessionTrend,
  boardIndex = 0,
}: StockListRowProps) {
  const { symbol, name, referencePrice } = definition;

  // A hot symbol can tick dozens of times/sec even after `TickDispatcher`'s per-frame
  // coalescing (that cap is a data-correctness contract, not a readability one — see
  // `src/display/throttle.ts`). This row shows its symbol's paced view
  // (`src/display/pacedViews.ts`), which advances at most once per
  // `DISPLAY_REFRESH_INTERVAL_MS` on wall-clock-aligned slots, so the selected row and
  // `StockDetail`'s header flush the same burst on the same beat. Pacing the view, not
  // just the notification, is what keeps a re-render from elsewhere (a click, a sort)
  // from painting prices early.
  // Paced, not live: a render between beats (a click, a sort) shows what the last beat
  // painted — see `src/display/pacedViews.ts`.
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribePacedSymbol(symbol, onStoreChange),
    [symbol],
  );
  const view = useSyncExternalStore(subscribe, () => getPacedSymbolSnapshot(symbol));

  // Test-support only: a per-row render counter surfaced as a data attribute so
  // `StockList.render-isolation.test.tsx` can assert exactly one extra render for the
  // ticked row and zero for every other row. Never read by production code or styling.
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const priceMuted = view === undefined;
  const price = view?.price ?? referencePrice;
  const change = view?.change ?? ZERO_DECIMAL;
  const changePercent = view?.changePercent;
  const volumeLabel = view ? view.volume.toLocaleString('en-US') : '—';
  const valueLabel = view
    ? formatCompact(tradedValue(definition, view), { fixedFraction: true })
    : '—';

  // Decorative sparkline history — bounded, committed post-render (see module doc for
  // why this mirrors PriceCell's flash-tracking shape rather than mutating during
  // render). Never read as text anywhere; text prices always go through PriceCell.
  // `toPlotValue` (`src/chart/ringBuffer.ts`) is the one sanctioned `DecimalString` ->
  // `number` conversion for exactly this "plotting/decoration, never re-displayed as
  // text" purpose — reused here rather than a second, duplicate inline conversion.
  // Shared ref/effect/read-back triplet lives in `useBoundedSparkline.ts`; this row
  // keeps its own 20-point cap (`HeroCard`'s is 26).
  // Seeded from the session history once it loads — see `useSessionSparkline`.
  const currentPriceNum = toPlotValue(price);
  const sparklinePoints = useSessionSparkline(currentPriceNum, 20, sessionTrend);
  const direction = sparklineDirection(changePercent);

  // A sighted user reads price and up/down direction straight off the row (that's the
  // entire point of it); `aria-label={symbol}` alone gives a keyboard/screen-reader
  // user — the row is the focus target (`tabIndex` below) — none of that. Build a
  // richer label from data already computed above rather than a new formatting
  // dependency: `price` is already a plain decimal string, so `String(price)` is a
  // type-safe pass-through, not a numeric reformat. Recomputed on every render (cheap,
  // plain string concatenation) — deliberately *not* wired to `aria-live`: constant
  // per-tick announcements across 34 independently-ticking rows would spam a screen
  // reader, so this only changes what is read when the row is *visited*, not when it
  // changes.
  const directionWord =
    direction === 'flat' || (changePercent !== undefined && isEffectivelyUnchanged(changePercent))
      ? 'unchanged'
      : direction;
  const baseAriaLabel =
    changePercent === undefined
      ? `${symbol}, ${String(price)}`
      : `${symbol}, ${String(price)}, ${directionWord} ${formatPercentFigure(changePercent, { magnitude: true })}%`;
  // The header's StreamBadge says which stream the whole board is on; a row visited in
  // isolation by a screen reader repeats it, so a delayed price is never read as live.
  // Change amount and volume follow once a tick or snapshot has arrived — the same
  // figures the Change and Volume columns show, which a narrow row doesn't render at all.
  const detailAriaLabel = view
    ? `${baseAriaLabel}, change ${format(change, { decimals: priceDecimals, sign: true })}, volume ${volumeLabel}`
    : baseAriaLabel;
  const rowAriaLabel =
    view?.stream === 'DELAYED' ? `${detailAriaLabel}, delayed stream` : detailAriaLabel;

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(symbol);
    }
  };

  const changeDeltaClass = DELTA_TONE_CLASSES[percentTone(changePercent)];

  return (
    <tr
      // `fine-hover:` compiles to a `:hover`-suffixed class, which (like the plain
      // CSS this replaces) has higher specificity than the plain `bg-[...]` class
      // `selected` adds below, so hovering a selected row still shows the ordinary
      // hover tint instead of the selected highlight — matching the original
      // `.tckr-stocklist__row:hover` (two compound selectors) outranking
      // `.tckr-stocklist__row--selected` (one class) under real CSS specificity
      // rules. That relationship survives here because Tailwind gives a pseudo-class
      // variant genuinely higher specificity, not just later source order.
      className={`cursor-pointer [transition:background-color_120ms_ease,box-shadow_120ms_ease] fine-hover:bg-[color-mix(in_oklab,var(--tckr-color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:-outline-offset-2${
        selected
          ? ' bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,transparent)] shadow-[inset_3px_0_0_var(--tckr-color-up)]'
          : ''
      }`}
      tabIndex={tabStop ? 0 : -1}
      aria-label={rowAriaLabel}
      aria-selected={selected}
      style={{ '--tckr-tick-delay': tickDelay(boardIndex) } as CSSProperties}
      data-symbol={symbol}
      data-render-count={renderCountRef.current}
      onClick={() => onActivate(symbol)}
      onKeyDown={handleKeyDown}
      onFocus={onRowFocus ? () => onRowFocus(symbol) : undefined}
    >
      <td className={`${CELL_BASE} text-left font-mono font-semibold`}>
        {/* The row is the keyboard target (one Tab stop for the board), but a <tr> has
            no role that says it opens anything. This link gives screen-reader users a
            real, discoverable action (links list, "open in new tab") without adding a
            Tab stop. A plain click falls through to the row's own handler, which also
            closes an already-open symbol; a modified click keeps the browser default. */}
        <Link
          to={symbolPath(symbol)}
          tabIndex={-1}
          className="text-inherit no-underline"
          aria-label={`Open ${symbol} details`}
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0
            ) {
              event.stopPropagation();
              return;
            }
            event.preventDefault();
          }}
        >
          {symbol}
        </Link>
      </td>
      {columns.has('trend') ? (
        <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>
          <Sparkline points={sparklinePoints} direction={direction} />
        </td>
      ) : null}
      {columns.has('name') ? (
        <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>{name}</td>
      ) : null}
      <td className={`${CELL_BASE} text-right tabular-nums`}>
        <PriceCell
          value={price}
          decimals={priceDecimals}
          alignDecimals={alignDecimals}
          muted={priceMuted}
          flashDirectionOverride={
            changePercent === undefined
              ? undefined
              : changePercent > 0
                ? 'up'
                : changePercent < 0
                  ? 'down'
                  : null
          }
        />
      </td>
      {columns.has('change') ? (
        <td className={`${CELL_BASE} text-right tabular-nums max-[640px]:hidden`}>
          <PriceCell
            value={change}
            decimals={priceDecimals}
            alignDecimals={alignDecimals}
            sign
            muted={priceMuted}
            indicateSign
          />
        </td>
      ) : null}
      <td className={`${CELL_BASE} text-right tabular-nums`}>
        {changePercent === undefined ? (
          <span className="font-mono tabular-nums text-text-muted">—</span>
        ) : (
          <span
            className={`font-mono tabular-nums inline-block align-middle px-2 py-0.5 leading-5 rounded-[5px] [transition:background-color_600ms_var(--tckr-ease-out),color_600ms_var(--tckr-ease-out)] [transition-delay:var(--tckr-tick-delay,0ms)] ${changeDeltaClass}`}
          >
            <TickingText
              text={formatSignedPercent(changePercent)}
              direction={changePercent < 0 ? 'down' : 'up'}
            />
          </span>
        )}
      </td>
      {columns.has('volume') ? (
        <td className={`${CELL_BASE} text-right font-mono tabular-nums max-[640px]:hidden`}>
          {volumeLabel}
        </td>
      ) : null}
      {columns.has('value') ? (
        <td className={`${CELL_BASE} text-right font-mono tabular-nums max-[640px]:hidden`}>
          {valueLabel}
        </td>
      ) : null}
    </tr>
  );
}

// ---------------------------------------------------------------------------------
// Shared class fragments for `StockList`'s own return (below) — kept as named
// constants/helpers, in the same spirit as `CONN_BANNER_*` above, rather than
// inlined into the JSX twice (the loading branch and the loaded branch both render
// the split shell). Where a modifier flips a property the base value also sets
// (width, opacity/transform, max-height/margin — previously
// `.tckr-stocklist__shell--split .tckr-stocklist__list-col` etc., a parent-state ->
// child-class selector with no Tailwind utility-class equivalent), the helper
// returns one full mutually-exclusive class string per state rather than a base
// string plus a conditionally-appended override, so there is never a pair of
// same-specificity utility classes whose winner depends on Tailwind's internal
// ordering.
// ---------------------------------------------------------------------------------

// Split-pane layout. None of these animate a layout property: opening or closing a
// symbol switches the layout in a single step, and the motion comes from a view
// transition (`useViewTransitionNavigate`) that animates snapshots of the named regions
// below on the compositor — see the `::view-transition-*` rules in tailwind.css.
// Earlier versions transitioned `width`, `max-height` and `margin-bottom` here, which
// re-ran layout for the whole page, 34-row table included, on every frame.
//
// The detail pane is `hidden` (not merely zero-width) while closed, so it neither
// takes a flex gap nor leaves the table card short of the search row's right edge.
const FLIP_DURATION_MS = 420;
const MOVING_ROW_BACKGROUND = 'color-mix(in oklab, var(--tckr-color-surface) 94%, transparent)';

const SHELL_CLASS = 'flex items-start gap-4 max-[800px]:flex-col max-[800px]:items-stretch';

function shellListColClass(split: boolean): string {
  return `min-w-0 [view-transition-name:tckr-list] ${split ? 'flex-none w-[380px] max-[800px]:hidden' : 'w-full'}`;
}

// Beside the list, the detail pane sticks just under the sticky app header (59px + a
// 16px gap), so scrolling a 34-row board never scrolls the open chart away. Only where
// the viewport is tall enough to hold the whole pane (≈615px) under the header;
// shorter windows keep normal flow so the stat tiles are never cut off.
const DETAIL_PANE_STICKY =
  '[@media(min-width:801px)_and_(min-height:720px)]:sticky [@media(min-width:801px)_and_(min-height:720px)]:top-[75px]';

function shellDetailPaneClass(split: boolean): string {
  return `flex-1 min-w-0 max-[800px]:w-full [view-transition-name:tckr-detail] ${split ? DETAIL_PANE_STICKY : 'hidden'}`;
}

// `hidden` (display: none) while split: the cards leave the layout, the Tab order and
// the accessibility tree at once, and the view transition fades their snapshot out.
function heroWrapClass(split: boolean): string {
  return split ? 'hidden' : 'mb-3.5 [view-transition-name:tckr-hero]';
}

const PILL_BASE =
  'text-caption px-3 py-[7px] rounded-full border cursor-pointer [transition:background-color_150ms_ease,color_150ms_ease,border-color_150ms_ease,transform_120ms_ease-out] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';
const PILL_ACTIVE = 'bg-text text-surface border-text font-semibold';
const PILL_INACTIVE = 'bg-transparent text-text-muted border-border font-medium';

const SEARCH_WRAP_CLASS =
  'flex-[1_1_240px] min-w-[160px] flex items-center gap-2 py-2.5 px-3.5 border border-glass-border rounded-full bg-glass backdrop-blur-tckr backdrop-saturate-150 [transition:border-color_150ms_ease] focus-within:border-[var(--tckr-field-focus-border)] focus-within:outline-[3px] focus-within:outline-[var(--tckr-field-focus-halo)] focus-within:outline-offset-0 reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';

function tableWrapClass(stale: boolean): string {
  const base =
    'w-full max-w-full border border-glass-border rounded-[18px] overflow-hidden bg-glass backdrop-blur-tckr backdrop-saturate-[1.6] shadow-float [transition:border-color_250ms_ease,outline-color_250ms_ease] reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';
  // Held prices keep full contrast (they are exactly what the user is judging); the
  // card's edge turns amber and the caption says since when, instead of dimming them.
  return stale
    ? `${base} border-[color-mix(in_oklab,var(--tckr-color-warning)_45%,transparent)]! outline outline-offset-0 outline-[color-mix(in_oklab,var(--tckr-color-warning)_20%,transparent)]`
    : base;
}

const SORT_BUTTON_CLASS =
  'appearance-none bg-transparent border-none m-0 p-0 outline-none text-inherit [text-transform:inherit] cursor-pointer font-semibold inline-flex items-center gap-0.5 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';

const KBD_CLASS =
  'font-mono text-label border border-border rounded px-1.5 py-px bg-surface-raised';

const BOARD_HELP_ID = 'tckr-board-help';

/**
 * The board's keyboard model, said once for each audience. Screen readers get it as
 * the table's description (`aria-describedby`). Sighted keyboard users get a legend
 * that floats at the bottom of the viewport while a row has keyboard focus, so it is
 * in view wherever in the 34 rows they are, and never clutters the board for anyone
 * else. Hidden on touch devices, where none of these keys exist.
 */
function BoardKeyboardHelp({ detailOpen }: { detailOpen: boolean }) {
  const mod = modifierKeyLabel();
  return (
    <>
      <p id={BOARD_HELP_ID} className="sr-only">
        Arrow keys move between instruments, Home and End jump to the first and last, Enter opens
        one
        {detailOpen ? ', and the open details follow the arrow keys; Escape closes them' : ''}.
        Press {mod}K or slash to search.
      </p>
      <p
        className="hidden group-has-[tr:focus-visible]/board:flex pointer-coarse:!hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-10 items-center flex-wrap justify-center gap-x-3.5 gap-y-1 px-4 py-2 rounded-full bg-glass-strong border border-glass-border backdrop-blur-tckr shadow-[0_12px_30px_-16px_rgba(20,24,31,0.45)] text-caption text-text-muted whitespace-nowrap reduced-transparency:bg-surface contrast-more:bg-surface"
        aria-hidden="true"
      >
        <span>
          <kbd className={KBD_CLASS}>↑</kbd> <kbd className={KBD_CLASS}>↓</kbd> move
        </span>
        <span>
          <kbd className={KBD_CLASS}>Home</kbd> <kbd className={KBD_CLASS}>End</kbd> jump
        </span>
        <span>
          <kbd className={KBD_CLASS}>Enter</kbd> open
        </span>
        {detailOpen ? (
          <span>
            <kbd className={KBD_CLASS}>Esc</kbd> close
          </span>
        ) : null}
        <span>
          <kbd className={KBD_CLASS}>{mod}K</kbd> or <kbd className={KBD_CLASS}>/</kbd> search
        </span>
      </p>
    </>
  );
}

const EMPTY_ACTION_BUTTON_BASE =
  'font-semibold text-caption px-3.5 py-[9px] rounded-[7px] cursor-pointer [transition:transform_120ms_ease-out,opacity_150ms_ease] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2';

export function StockList() {
  // Every navigation from this page opens or closes the split pane, so every one goes
  // through the view-transition wrapper (see `useViewTransitionNavigate`).
  const navigate = useViewTransitionNavigate();
  const subscribedRef = useRef<readonly string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [universe, setUniverse] = useState<readonly SymbolDefinition[] | null>(null);
  // A rejected `getUniverse()` leaves nothing to render, so the loading branch turns into
  // an error with a retry. Bumping `universeAttempt` re-runs the fetch effect below.
  const [universeFailed, setUniverseFailed] = useState(false);
  const [universeAttempt, retryUniverse] = useReducer((n: number) => n + 1, 0);
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortState, setSortState] = useState<SortState | null>(null);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
  const [sessionTrends, setSessionTrends] = useState<ReadonlyMap<string, readonly number[]>>(
    () => new Map(),
  );
  const { state: connState, remainingSecs, heldSince } = useConnectionBanner();
  const recovery = useRecoveryMoment(connState);
  const marketStatus = useMarketStatus();
  const viewerStream = useViewerStream();
  const openingBell = useOpeningBell(marketStatus);

  // Whether a `/EGX/symbols/:symbol` child route is open, read straight from the URL —
  // see module doc "Split-pane detail". Purely presentational (grid columns, hero
  // visibility, row highlight); the detail pane's own data lifecycle is owned
  // entirely by `StockDetail` via the `<Outlet />` below, not by this value.
  const detailMatch = useMatch(SYMBOL_ROUTE_PATTERN);
  const selectedSymbol = detailMatch?.params.symbol ?? null;
  const isNarrowViewport = useNarrowViewport();

  // `sorted` below reads live snapshot values *imperatively*, only when it recomputes
  // (see module doc: resorting on every tick would reintroduce the whole-table
  // re-render this page exists to avoid, and would make rows jump under the cursor).
  // Left alone, that means an active preset (e.g. "Most active") can show a stale,
  // increasingly-misleading ranking indefinitely between sort clicks/searches, even as
  // every individual row keeps visibly repainting. `resortTick` re-ranks on the price
  // beat itself (`subscribeBeat`), in the same commit as the figures it ranks by, so a
  // sorted board never shows an order its own numbers contradict (a falling row on top
  // of "Gainers"), without resorting on every tick. Mirrors
  // `useConnectionBanner`'s reconnecting-interval: only runs while there is something
  // to keep fresh (`sortState !== null`), and is keyed off that boolean rather than the
  // `SortState` object itself so switching between sort columns doesn't restart the
  // re-rank window.
  const [resortTick, forceResort] = useReducer((n: number) => n + 1, 0);
  const hasActiveSort = sortState !== null;
  useEffect(() => {
    if (!hasActiveSort) {
      return undefined;
    }
    return subscribeBeat(forceResort);
  }, [hasActiveSort]);

  useEffect(() => {
    // `getSharedSource()` is the one app-wide `MarketDataSource` instance — it connects
    // itself, once, at first access (client-contract.md §3: one connection per client).
    // StockList must not call `.connect()`/`.disconnect()` on it: disconnecting here
    // would kill the connection StockDetail shares. Leaving the route only releases
    // this page's own subscriptions.
    const source = getSharedSource();
    let cancelled = false;

    source
      .getUniverse()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const symbols = response.symbols.map((def) => def.symbol);
        subscribedRef.current = symbols;
        source.subscribe(symbols);
        setUniverse(response.symbols);

        // `subscribe()` above only starts *future* ticks flowing into the shared store —
        // it does not backfill whatever volume the source had already accumulated before
        // this page opened (the simulator/gateway tracks true cumulative volume
        // independent of whether any page is watching). Without this, every row's volume
        // would start from 0 and only reflect ticks received after mount, understating
        // the true figure for as long as the page stays open. `getSnapshot()` already
        // writes its result into the shared store via `applySnapshot` internally (see
        // `SimulatedSource.getSnapshot`/`TckrGatewaySource.getSnapshot`), so there is
        // nothing to do with these results beyond letting them resolve —
        // `StockDetail.tsx` does the equivalent for its one symbol. Fired *after*
        // `setUniverse` (not awaited before it) so the table paints immediately rather
        // than waiting on 34 network/simulator round-trips, and `allSettled` (not `all`)
        // so one symbol's rejected snapshot can never stop the others from applying.
        void Promise.allSettled(symbols.map((s) => source.getSnapshot(s)));

        // One history fetch per symbol, once, to seed every Session sparkline — table rows
        // and hero cards (see `sessionSparkline`). A symbol whose history fails simply keeps the
        // live-accumulating line — the column is decorative, so this never surfaces an error.
        void Promise.allSettled(symbols.map((s) => source.getHistory(s))).then((results) => {
          if (cancelled) {
            return;
          }
          const trends = new Map<string, readonly number[]>();
          results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.points.length > 1) {
              trends.set(
                symbols[index]!,
                result.value.points.map((point) => toPlotValue(point.p)),
              );
            }
          });
          if (trends.size > 0) {
            setSessionTrends(trends);
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setUniverseFailed(true);
        }
      });

    return () => {
      cancelled = true;
      if (subscribedRef.current.length > 0) {
        source.unsubscribe(subscribedRef.current);
        subscribedRef.current = [];
      }
    };
  }, [universeAttempt]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  // Page shortcuts: ⌘K / Ctrl+K and "/" focus the search box; Escape closes the open
  // detail pane. None of them fire while the user is typing in a field, where Escape
  // already means "clear this field" and "/" is a character.
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && selectedSymbol !== null) {
        event.preventDefault();
        navigate('/');
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [navigate, selectedSymbol]);

  // Keeps keyboard focus somewhere visible whenever the detail opens, switches or
  // closes — however that happened (a row, Escape, the pane's close button, the logo).
  // Only steps in when the focused element has gone: opening hides the list column
  // below 800px (focus moves to the detail's heading), and closing unmounts the pane
  // (focus returns to the row of the symbol that was open). On desktop a focused row
  // stays visible and keeps focus, so the arrow keys keep browsing the board.
  const previousSelectedRef = useRef(selectedSymbol);
  useEffect(() => {
    const previous = previousSelectedRef.current;
    previousSelectedRef.current = selectedSymbol;
    const id = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const focusLost = !active || active === document.body || active.getClientRects().length === 0;
      if (!focusLost) {
        return;
      }
      if (selectedSymbol !== null) {
        document.getElementById(DETAIL_HEADING_ID)?.focus();
      } else if (previous !== null) {
        tbodyRef.current
          ?.querySelector<HTMLTableRowElement>(`tr[data-symbol="${CSS.escape(previous)}"]`)
          ?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedSymbol]);

  const priceDecimalsBySymbol = useMemo(() => {
    const map = new Map<string, number>();
    for (const def of universe ?? []) {
      map.set(def.symbol, Math.max(decimalPlaces(def.referencePrice), decimalPlaces(def.tickSize)));
    }
    return map;
  }, [universe]);
  const boardPriceDecimals = useMemo(
    () => Math.max(0, ...priceDecimalsBySymbol.values()),
    [priceDecimalsBySymbol],
  );

  const filtered = useMemo(() => {
    if (!universe) {
      return [];
    }
    const query = debouncedQuery.trim().toLowerCase();
    if (query === '') {
      return universe;
    }
    return universe.filter(
      (def) => def.symbol.toLowerCase().includes(query) || def.name.toLowerCase().includes(query),
    );
  }, [universe, debouncedQuery]);

  const sorted = useMemo(() => {
    if (!sortState) {
      return filtered;
    }
    const { column, direction } = sortState;
    const factor = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => factor * compareBy(column, a, b));
    // `resortTick` is intentionally in this array even though the body never reads
    // it — bumping it is exactly what forces this memo to recompute (and re-read live
    // snapshot values via `compareBy`) once per `DISPLAY_REFRESH_INTERVAL_MS`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resortTick is the recompute trigger (above)
  }, [filtered, sortState, resortTick]);

  // Only computed when the search matched nothing (see the empty state).
  const suggestions = useMemo(
    () => (universe && filtered.length === 0 ? closestInstruments(debouncedQuery, universe) : []),
    [universe, filtered.length, debouncedQuery],
  );

  const handleSort = useCallback((column: SortColumn) => {
    setSortState((current) => {
      if (!current || current.column !== column) {
        // Figures lead with the biggest (the top price, the heaviest volume), the way a
        // trader reads a ranking; text columns start at A.
        const numeric = COLUMNS.find((candidate) => candidate.key === column)?.numeric === true;
        return { column, direction: numeric ? 'desc' : 'asc' };
      }
      // Toggles between the two directions; never silently drops back to "unsorted" on
      // a third click. The "Exchange order" preset is the named way back.
      return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  }, []);

  const handleRowActivate = useCallback(
    (symbol: string) => {
      // Mirrors the design import's `toggle()`: activating the already-open symbol
      // closes the detail pane instead of re-navigating to the same route.
      navigate(selectedSymbol === symbol ? '/' : symbolPath(symbol));
    },
    [navigate, selectedSymbol],
  );

  const clearSearch = useCallback(() => setRawQuery(''), []);

  // Arrow-key movement between rows (roving tabindex — see `StockListRowProps.tabStop`).
  // Reads the rendered row order from the DOM rather than `sorted`, so it always matches
  // what the user sees, including after a re-sort.
  const handleTableKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableSectionElement>) => {
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const current = (event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-symbol]');
      if (!current) {
        return;
      }
      const rows = Array.from(
        event.currentTarget.querySelectorAll<HTMLTableRowElement>('tr[data-symbol]'),
      );
      const index = rows.indexOf(current);
      const next =
        event.key === 'Home'
          ? rows[0]
          : event.key === 'End'
            ? rows[rows.length - 1]
            : rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
        // With the detail open, the pane follows the focused row (master-detail), so
        // ↑/↓ steps through instruments without an Enter per symbol. It replaces the
        // history entry, so Back closes the pane rather than replaying every row passed.
        const nextSymbol = next.dataset.symbol;
        if (selectedSymbol !== null && nextSymbol && nextSymbol !== selectedSymbol) {
          navigate(symbolPath(nextSymbol), { replace: true });
        }
      }
    },
    [navigate, selectedSymbol],
  );

  // ---------------------------------------------------------------------------------
  // Re-rank motion (GSAP Flip). When the row order changes — a preset or header sort,
  // the per-beat re-rank of an active sort, or a search narrowing the list — each row
  // that moved glides from where it was to its new rank, and rows newly in the list
  // fade in. Without it rows teleport, and the symbol you were watching is lost.
  //
  // The "before" is read during the render that changes the order, i.e. from the DOM
  // React is about to replace, so it is where each row *is on screen* — mid-glide
  // included. A re-rank that lands while the last one is still flying (a sort click, a
  // search keystroke) carries each row on from where it actually is, instead of
  // snapping it back to its old resting place first. (That read is the one layout read
  // this render does, only when the order changes; if React throws the render away,
  // the next one reads again.) The layout effect then clears the previous glide and
  // plays this one before paint: transform and opacity, plus a moving row's background
  // (paint only, never layout).
  //
  // Needs GSAP already loaded (`loadMotion` below): the first re-rank after a cold load
  // may land unanimated, never late.
  // ---------------------------------------------------------------------------------
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const orderKey = sorted.map((def) => def.symbol).join(',');
  const committedOrderKeyRef = useRef<string | null>(null);
  const flipRef = useRef<{
    readonly orderKey: string;
    readonly state: ReturnType<Motion['Flip']['getState']>;
  } | null>(null);
  const glideRef = useRef<ReturnType<Motion['Flip']['from']> | null>(null);

  useEffect(() => {
    void loadMotion().catch(() => undefined);
  }, []);

  const flipMotion = loadedMotion();
  if (
    flipMotion !== null &&
    tbodyRef.current !== null &&
    committedOrderKeyRef.current !== null &&
    committedOrderKeyRef.current !== orderKey &&
    flipRef.current?.orderKey !== orderKey &&
    !prefersReducedMotion()
  ) {
    flipRef.current = {
      orderKey,
      state: flipMotion.Flip.getState(tbodyRef.current.querySelectorAll('tr[data-symbol]'), {
        simple: true,
      }),
    };
  }

  useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    const pending = flipRef.current;
    const motion = loadedMotion();
    committedOrderKeyRef.current = tbody ? orderKey : null;
    flipRef.current = null;
    if (!tbody || !motion || pending?.orderKey !== orderKey) {
      return;
    }
    const { gsap, Flip } = motion;
    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-symbol]'));
    // The last glide's transforms are still inline; clear them so this one measures
    // the rows' true new places.
    glideRef.current?.kill();
    gsap.set(rows, { clearProps: 'transform,opacity' });
    const moved = rows.filter((row) => {
      const before = pending.state.getElementState(row);
      return before !== undefined && Math.abs(before.y - row.getBoundingClientRect().top) > 0.5;
    });
    const glide = Flip.from(pending.state, {
      targets: rows,
      duration: FLIP_DURATION_MS / 1000,
      simple: true,
      onEnter: (entering) =>
        gsap.fromTo(entering, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' }),
    });
    // Rows are transparent over the glass, so rows crossing each other would overprint
    // their text. A moving row carries a near-opaque surface for the flight and only
    // hands back to its own background (the last keyframe omits it) once it has almost
    // landed — a separate, linear animation, because the glide's front-loaded ease-out
    // would thin the surface out almost at once. Web Animations rather than GSAP: it
    // fades to whatever the row's own background resolves to, selected tint included.
    for (const row of moved) {
      if (typeof row.animate === 'function') {
        row.animate(
          [
            { backgroundColor: MOVING_ROW_BACKGROUND },
            { backgroundColor: MOVING_ROW_BACKGROUND, offset: 0.7 },
            {},
          ],
          { duration: FLIP_DURATION_MS, easing: 'linear' },
        );
      }
    }
    glide.eventCallback('onComplete', () => {
      gsap.set(rows, { clearProps: 'transform,opacity' });
    });
    glideRef.current = glide;
  }, [orderKey]);

  useEffect(
    () => () => {
      glideRef.current?.kill();
    },
    [],
  );

  if (universe === null) {
    const loadingSplit = selectedSymbol !== null;
    return (
      <>
        <h1 className="sr-only">Tckr Market Watch</h1>
        <div className={SHELL_CLASS}>
          <div data-greet-rise className={shellListColClass(loadingSplit)}>
            {universeFailed ? (
              <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_DANGER}`} role="alert">
                <AlertIcon className="text-down" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-small">Couldn’t load the instrument list</div>
                  <div className="mt-[3px] text-caption text-text-muted">
                    The board can’t show prices until the list arrives. Check your connection, then
                    try again.
                  </div>
                </div>
                <button
                  type="button"
                  className={CONN_BANNER_ACTION}
                  onClick={() => {
                    setUniverseFailed(false);
                    retryUniverse();
                  }}
                >
                  Try again
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-2.5 text-text-muted">
                <FormingCandle height={22} loop />
                Loading instruments…
              </p>
            )}
          </div>
          <div data-greet-rise className={shellDetailPaneClass(loadingSplit)}>
            <Outlet />
          </div>
        </div>
      </>
    );
  }

  const isStale = isHeld(connState);
  const activePreset = presetFor(sortState);
  const searching = debouncedQuery.trim() !== '';
  const isSplit = selectedSymbol !== null;
  // The list column collapses to Symbol/Price/Change % whenever *either* the
  // split-pane detail is open or the real viewport is narrow — see
  // `useNarrowViewport`'s doc for why both paths share this one DOM-level
  // mechanism instead of the split-pane using it and the viewport case keeping
  // the old CSS-only `display: none` one.
  const narrow = isSplit || isNarrowViewport;
  const columns = visibleColumns(narrow);
  const columnKeys: ReadonlySet<ColumnKey> = new Set(columns.map((column) => column.key));
  // The one row that is a Tab stop: whichever row last had focus, else the open
  // symbol's row, else the first row — always one that is actually rendered.
  const tabStopSymbol =
    [focusedSymbol, selectedSymbol].find(
      (candidate) => candidate !== null && sorted.some((def) => def.symbol === candidate),
    ) ??
    sorted[0]?.symbol ??
    null;

  // The open symbol's neighbours in the board's current order (sort and search
  // included), for the phone's previous/next buttons.
  const selectedIndex =
    selectedSymbol === null ? -1 : sorted.findIndex((def) => def.symbol === selectedSymbol);
  const previousSymbol = selectedIndex > 0 ? sorted[selectedIndex - 1]!.symbol : null;
  const nextSymbol =
    selectedIndex >= 0 && selectedIndex < sorted.length - 1
      ? sorted[selectedIndex + 1]!.symbol
      : null;

  // One instance of each control, placed by the layout below: in the toolbar row over
  // the full board, or at the top of the list column in split view.
  const presetPills = (
    <div className="flex gap-1.5 flex-wrap">
      {PRESETS.map((preset) => (
        // eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is ARIA 1.3; the plugin predates it
        <button
          key={preset.id}
          type="button"
          className={`${PILL_BASE} ${activePreset === preset.id ? PILL_ACTIVE : PILL_INACTIVE}`}
          aria-pressed={activePreset === preset.id}
          title={preset.hint}
          aria-description={preset.hint}
          onClick={() => setSortState(preset.sort)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
  // The sortable headers are one Tab stop (the sorted column, else Symbol, which is never
  // hidden), not eight between the search field and the rows; ←/→/Home/End move along
  // them, the way ↑/↓ move along the rows.
  const sortedColumnSpec = sortState
    ? COLUMNS.find((column) => column.key === sortState.column)
    : undefined;
  const headerTabStop =
    sortedColumnSpec && !sortedColumnSpec.hideNarrow ? sortedColumnSpec.key : 'symbol';
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
    ).filter(
      // Headers the narrow layout hides (`max-[640px]:hidden`) are skipped.
      (button) => getComputedStyle(button.closest('th') ?? button).display !== 'none',
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index === -1) {
      return;
    }
    const next =
      event.key === 'Home'
        ? buttons[0]
        : event.key === 'End'
          ? buttons[buttons.length - 1]
          : buttons[index + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  // Search is the fastest way to a symbol, so it hands off to the board directly: Enter
  // opens the exact ticker typed (or else the first match in the board's order), and ↓
  // moves focus onto the first row, where ↑/↓/Enter take over.
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      const first = tbodyRef.current?.querySelector<HTMLTableRowElement>('tr[data-symbol]');
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    const query = rawQuery.trim().toLowerCase();
    if (event.key !== 'Enter' || !universe || query === '') {
      return;
    }
    // The board may still be showing the previous query (it's debounced); match what
    // was typed, not what has rendered.
    const matches =
      rawQuery === debouncedQuery
        ? sorted
        : universe.filter(
            (def) =>
              def.symbol.toLowerCase().includes(query) || def.name.toLowerCase().includes(query),
          );
    const target = matches.find((def) => def.symbol.toLowerCase() === query) ?? matches[0];
    if (target) {
      event.preventDefault();
      if (target.symbol !== selectedSymbol) {
        navigate(symbolPath(target.symbol));
      }
    }
  };

  const searchField = (
    <label className={SEARCH_WRAP_CLASS} htmlFor="tckr-stocklist-search">
      <SearchIcon size={14} className="text-text-muted" />
      <input
        id="tckr-stocklist-search"
        ref={searchInputRef}
        type="search"
        className="appearance-none bg-transparent border-none m-0 p-0 outline-none [&::-webkit-search-cancel-button]:appearance-none flex-[1_1_auto] min-w-0 text-text text-small pointer-coarse:text-body placeholder:text-text-muted"
        aria-label="Search symbol or name"
        aria-keyshortcuts="Meta+K Control+K /"
        placeholder="Search symbol or name"
        value={rawQuery}
        onChange={(event) => setRawQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
      />
      {rawQuery !== '' ? (
        <button
          type="button"
          aria-label="Clear search"
          className="flex-none -my-1 p-1 rounded-full text-text-muted cursor-pointer fine-hover:text-text focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
          onClick={() => {
            clearSearch();
            searchInputRef.current?.focus();
          }}
        >
          <CloseIcon size={13} />
        </button>
      ) : null}
      <span className="flex-none font-mono text-label text-text-muted border border-border rounded px-1.5 py-[3px] pointer-coarse:hidden">
        {modifierKeyLabel()}K
      </span>
    </label>
  );

  return (
    <div className="w-full max-w-full">
      <h1 className="sr-only">Tckr Market Watch</h1>
      <p className="sr-only" aria-live="polite">
        {isSplit ? `${selectedSymbol} details open beside the list` : ''}
      </p>
      <p className="sr-only" aria-live="polite" data-testid="search-result-count">
        {searching
          ? `${sorted.length} of ${universe.length} instruments match “${debouncedQuery.trim()}”`
          : ''}
      </p>

      {/* Sticks under the app header so a user scrolled deep into the board still
          sees the stream is down and can retry. Not in desktop split view: the pane
          sticks at the same offset and carries its own HELD line instead. */}
      <ConnectionBanner
        state={connState}
        remainingSecs={remainingSecs}
        className={isSplit ? CONN_BANNER_STICKY_PHONE : CONN_BANNER_STICKY}
      />
      {viewerStream === 'DELAYED' ? <DelayedStreamBanner /> : null}
      {recovery.shown && connState.kind === 'connected' ? (
        <MomentBanner
          icon={<CheckIcon />}
          title="Reconnected"
          detail="The feed is back and the prices below are current again."
          onDismiss={recovery.dismiss}
        />
      ) : null}
      {openingBell.shown && marketStatus.state === 'open' ? (
        <MomentBanner
          icon={<FormingCandle height={18} />}
          title="EGX is open"
          detail={`Continuous trading started at ${formatCairoTimeShort(marketStatus.sessionOpenAt)} Cairo time. The board is moving.`}
          onDismiss={openingBell.dismiss}
        />
      ) : null}
      {/* In split view on desktop the banner moves into the list column (below), so
          it describes the board it sits on instead of spanning the chart too. Phones
          keep it here: their split view hides the list column. */}
      <MarketClosedBanner status={marketStatus} className={isSplit ? 'min-[801px]:hidden' : ''} />

      {/* `data-greet-rise`: the panes the daily greeting raises into place as it hands
          the page over (`motion/Greeting.tsx`). */}
      <div data-greet-rise className={heroWrapClass(isSplit)}>
        <HeroCards
          universe={universe}
          priceDecimalsBySymbol={priceDecimalsBySymbol}
          onActivate={handleRowActivate}
          sessionTrends={sessionTrends}
          sessionDate={
            marketStatus.state === 'closed'
              ? formatCairoDateShort(marketStatus.sessionOpenAt)
              : undefined
          }
        />
      </div>

      {/* Full board: ordering and search sit in one row above it. Split view: they move
          into the list column (below), so the controls sit over the list they act on,
          not across the chart. Below 800px the split view hides the list column, so this
          row keeps only the back pill: the one way back to the list on a phone. */}
      {isSplit ? (
        // On a phone the list is hidden behind the detail, so stepping to the next
        // symbol in the board's current order happens here instead of with ↑/↓.
        <nav
          data-greet-rise
          className="mb-3 flex items-center gap-2 min-[801px]:hidden"
          aria-label="Instrument navigation"
        >
          <button
            type="button"
            className={`${PILL_BASE} ${PILL_INACTIVE} inline-flex items-center gap-1.5 mr-auto`}
            onClick={() => navigate('/')}
          >
            <ArrowLeftIcon size={13} />
            All instruments
          </button>
          {previousSymbol !== null ? (
            <button
              type="button"
              className={`${PILL_BASE} ${PILL_INACTIVE} inline-flex items-center gap-1 font-mono`}
              aria-label={`Previous: ${previousSymbol}`}
              onClick={() => navigate(symbolPath(previousSymbol))}
            >
              <ChevronLeftIcon size={13} />
              {previousSymbol}
            </button>
          ) : null}
          {nextSymbol !== null ? (
            <button
              type="button"
              className={`${PILL_BASE} ${PILL_INACTIVE} inline-flex items-center gap-1 font-mono`}
              aria-label={`Next: ${nextSymbol}`}
              onClick={() => navigate(symbolPath(nextSymbol))}
            >
              {nextSymbol}
              <ChevronRightIcon size={13} />
            </button>
          ) : null}
        </nav>
      ) : (
        <div data-greet-rise className="flex items-center gap-2.5 mb-3 flex-wrap">
          {presetPills}
          {searchField}
        </div>
      )}

      <div className={SHELL_CLASS}>
        <div data-greet-rise className={shellListColClass(isSplit)}>
          {isSplit ? (
            <div className="grid gap-2.5 mb-3">
              {searchField}
              {presetPills}
            </div>
          ) : null}
          {isSplit ? (
            <MarketClosedBanner status={marketStatus} className="max-[800px]:hidden" compact />
          ) : null}
          <div className="group/board">
            <div className={tableWrapClass(isStale)}>
              {/* A grid, not a plain table: its rows are focusable and open a symbol, and
                  a table row has no role that says so. Read-only, single-select: the open
                  symbol's row is the selected one. */}
              <table
                role="grid"
                aria-readonly="true"
                aria-label="Instruments"
                aria-describedby={BOARD_HELP_ID}
                className="w-full max-w-full border-collapse table-fixed"
              >
                <caption className="caption-top text-left px-3.5 pt-2.5 pb-1 text-caption text-text-muted">
                  {isStale && heldSince !== null ? (
                    <span
                      className="inline-flex items-center gap-2 mr-2 text-text"
                      data-testid="board-held"
                    >
                      <HeldTag />
                      <span className="font-mono">since {formatCairoClock(heldSince)}</span>
                      <span aria-hidden="true" className="text-text-muted">
                        ·
                      </span>
                    </span>
                  ) : null}
                  <span data-testid="board-order">
                    {searching ? `${sorted.length} of ${universe.length} · ` : ''}
                    {describeOrder(sortState)}
                  </span>
                  <span data-testid="board-change-basis"> · change vs previous close</span>
                  {/* A ranked board moves on its own; say how often, so a row changing
                      place isn't read as a glitch. Only while prices are moving. */}
                  {marketStatus.state === 'open' && !isStale ? (
                    <BoardUpdatedAt delayed={viewerStream === 'DELAYED'} />
                  ) : null}
                  {sortState !== null && marketStatus.state === 'open' && !isStale ? (
                    <span data-testid="board-rerank">
                      {' '}
                      · re-ranked every {DISPLAY_REFRESH_INTERVAL_MS / 1000}s
                    </span>
                  ) : null}
                </caption>
                <colgroup>
                  {columns.map((column) => (
                    <col
                      key={column.key}
                      style={{ width: `${columnWidthPercent(column, columns)}%` }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr onKeyDown={handleHeaderKeyDown}>
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        className={`${CELL_BASE} ${column.numeric ? 'text-right' : 'text-left'} font-mono text-label font-semibold tracking-[0.1em] text-text-muted uppercase bg-transparent${
                          !narrow && column.hideNarrow ? ' max-[640px]:hidden' : ''
                        }`}
                        title={column.title}
                        aria-sort={
                          column.sortable && sortState?.column === column.key
                            ? sortState.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        {column.sortable ? (
                          <button
                            type="button"
                            className={SORT_BUTTON_CLASS}
                            tabIndex={column.key === headerTabStop ? 0 : -1}
                            onClick={() => handleSort(column.key as SortColumn)}
                          >
                            {column.label}
                            {column.unit ? (
                              <>
                                {' '}
                                <span className="font-normal">{column.unit}</span>
                              </>
                            ) : null}
                            {sortState?.column === column.key
                              ? sortState.direction === 'asc'
                                ? ' ▲'
                                : ' ▼'
                              : ''}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- delegated arrow-key navigation between focusable row links */}
                <tbody id={BOARD_ID} ref={tbodyRef} onKeyDown={handleTableKeyDown}>
                  {sorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="text-center text-text-muted px-4 py-11 whitespace-normal animate-fade-in"
                      >
                        <div className="font-semibold text-title text-text">
                          {/* The query the list was filtered by, not the one still being
                              typed: the count and suggestions above use the same. */}
                          No instruments match &ldquo;{debouncedQuery.trim()}&rdquo;
                        </div>
                        {suggestions.length > 0 ? (
                          <>
                            <div className="mt-2 text-small">Did you mean</div>
                            <div className="mt-3 flex gap-2 justify-center flex-wrap">
                              {suggestions.map((def) => (
                                <button
                                  key={def.symbol}
                                  type="button"
                                  className={`${EMPTY_ACTION_BUTTON_BASE} border border-border bg-transparent text-text inline-flex items-baseline gap-2`}
                                  onClick={() => {
                                    setRawQuery('');
                                    handleRowActivate(def.symbol);
                                  }}
                                >
                                  <span className="font-mono font-semibold">{def.symbol}</span>
                                  <span className="font-normal text-text-muted">{def.name}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="mt-2 mx-auto max-w-[340px] text-small leading-[1.55]">
                            Search runs on symbol and name. Try a shorter query, or browse the full
                            board.
                          </div>
                        )}
                        <div className="mt-[18px] flex gap-2 justify-center flex-wrap">
                          <button
                            type="button"
                            className={`${EMPTY_ACTION_BUTTON_BASE} border-0 bg-text text-surface`}
                            onClick={clearSearch}
                          >
                            Show all {universe.length}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sorted.map((def, index) => (
                      <StockListRow
                        key={def.symbol}
                        boardIndex={index}
                        definition={def}
                        priceDecimals={priceDecimalsBySymbol.get(def.symbol) ?? 2}
                        alignDecimals={boardPriceDecimals}
                        onActivate={handleRowActivate}
                        selected={def.symbol === selectedSymbol}
                        columns={columnKeys}
                        tabStop={def.symbol === tabStopSymbol}
                        onRowFocus={setFocusedSymbol}
                        sessionTrend={sessionTrends.get(def.symbol)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <BoardKeyboardHelp detailOpen={isSplit} />
          </div>
        </div>
        <div data-greet-rise className={shellDetailPaneClass(isSplit)}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

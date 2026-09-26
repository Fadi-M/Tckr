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
 *  - Split-pane detail: `/symbols/:symbol` is now a *child* route of `/`
 *    (`App.tsx`), rendered into this component's own `<Outlet />` rather than
 *    replacing the whole page — the design's list-narrows/detail-slides-in-beside-it
 *    layout. `useMatch('/symbols/:symbol')` tells this component whether a detail
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
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router-dom';
import { compare, toDecimal, type DecimalString } from '../contracts/decimal.ts';
import type { SymbolDefinition } from '../contracts/rest.ts';
import { CloseCode } from '../contracts/closeCodes.ts';
import { getSharedSource, reconnectSharedSource } from '../data/config.ts';
import type { ConnectionState } from '../data/MarketDataSource.ts';
import { getSymbolSnapshot, subscribeSymbol } from '../data/store.ts';
import { formatNextOpen, type MarketStatus } from '../data/marketCalendar.ts';
import { PriceCell } from '../components/PriceCell.tsx';
import { useMarketStatus } from '../components/useMarketStatus.ts';
import { createThrottle, DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';
import { toPlotValue } from '../chart/ringBuffer.ts';
import { sparklineDirection, useBoundedSparkline } from './useBoundedSparkline.ts';

const ZERO_DECIMAL: DecimalString = toDecimal('0');

type SortColumn = 'symbol' | 'name' | 'price' | 'change' | 'changePercent' | 'volume' | 'lastUpdate';
type SortDirection = 'asc' | 'desc';

interface SortState {
  readonly column: SortColumn;
  readonly direction: SortDirection;
}

interface ColumnSpec {
  readonly key: SortColumn | 'trend';
  readonly label: string;
  readonly sortable: boolean;
  /** Hidden below the 640px breakpoint (task 03's convention) so the page stays
   * scroll-free at 400px — only Symbol, Price and Change % remain. */
  readonly hideNarrow?: boolean;
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

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'symbol', label: 'Symbol', sortable: true, widthPercent: 8 },
  { key: 'trend', label: 'Trend', sortable: false, hideNarrow: true, widthPercent: 10 },
  { key: 'name', label: 'Name', sortable: true, hideNarrow: true, widthPercent: 22 },
  { key: 'price', label: 'Price', sortable: true, widthPercent: 12 },
  { key: 'change', label: 'Change', sortable: true, hideNarrow: true, widthPercent: 10 },
  { key: 'changePercent', label: 'Change %', sortable: true, widthPercent: 10 },
  { key: 'volume', label: 'Volume', sortable: true, hideNarrow: true, widthPercent: 12 },
  { key: 'lastUpdate', label: 'Last update', sortable: true, hideNarrow: true, widthPercent: 16 },
];

/** Sum of the always-visible (`!hideNarrow`) columns' `widthPercent` — the
 * denominator `narrowColumnWidthPercent` rescales against. */
const NARROW_VISIBLE_WIDTH_TOTAL = COLUMNS.filter((column) => !column.hideNarrow).reduce(
  (sum, column) => sum + column.widthPercent,
  0,
);

/** `table-layout: fixed`'s `<colgroup>` widths are independent of which `<td>`s are
 * actually visible — hiding a cell via `display: none` does not return its column's
 * reserved width to the rest of the row (the browser does not auto-collapse a
 * fixed-layout column just because every cell in it is hidden). Split-pane mode
 * (`narrow`) hides the same columns the 640px breakpoint hides, but the list column
 * itself can be far narrower than a real 640px viewport (see `StockList`'s grid), so
 * the always-visible columns' original percentages (8/12/10, out of the *full*
 * 8-column layout) leave most of the row blank and squeeze Symbol/Price/Change % into
 * illegibly few pixels. Rescale them to fill 100% of the row instead; the 640px
 * media-query narrow-hide path (real narrow viewports, untouched by this) does not
 * call this — it keeps the original 8/12/10 of the full width, which is enough
 * absolute pixels on an actual phone-width viewport. */
function narrowColumnWidthPercent(column: ColumnSpec): number {
  if (column.hideNarrow) {
    return 0;
  }
  return (column.widthPercent / NARROW_VISIBLE_WIDTH_TOTAL) * 100;
}

type Preset = 'most-active' | 'gainers' | 'losers' | 'az';

const PRESETS: readonly { readonly id: Preset; readonly label: string; readonly sort: SortState }[] = [
  { id: 'most-active', label: 'Most active', sort: { column: 'volume', direction: 'desc' } },
  { id: 'gainers', label: 'Gainers', sort: { column: 'changePercent', direction: 'desc' } },
  { id: 'losers', label: 'Losers', sort: { column: 'changePercent', direction: 'asc' } },
  { id: 'az', label: 'A–Z', sort: { column: 'symbol', direction: 'asc' } },
];

function presetFor(sortState: SortState | null): Preset | null {
  if (!sortState) {
    return null;
  }
  const match = PRESETS.find(
    (preset) => preset.sort.column === sortState.column && preset.sort.direction === sortState.direction,
  );
  return match?.id ?? null;
}

function decimalPlacesOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

function compareBy(column: SortColumn, a: SymbolDefinition, b: SymbolDefinition): number {
  switch (column) {
    case 'symbol':
      return a.symbol.localeCompare(b.symbol);
    case 'name':
      return a.name.localeCompare(b.name);
    case 'price': {
      const pa = getSymbolSnapshot(a.symbol)?.price ?? a.referencePrice;
      const pb = getSymbolSnapshot(b.symbol)?.price ?? b.referencePrice;
      return compare(pa, pb);
    }
    case 'change': {
      const ca = getSymbolSnapshot(a.symbol)?.change ?? ZERO_DECIMAL;
      const cb = getSymbolSnapshot(b.symbol)?.change ?? ZERO_DECIMAL;
      return compare(ca, cb);
    }
    case 'changePercent': {
      const pa = getSymbolSnapshot(a.symbol)?.changePercent ?? 0;
      const pb = getSymbolSnapshot(b.symbol)?.changePercent ?? 0;
      return pa - pb;
    }
    case 'volume': {
      const va = getSymbolSnapshot(a.symbol)?.volume ?? 0;
      const vb = getSymbolSnapshot(b.symbol)?.volume ?? 0;
      return va - vb;
    }
    case 'lastUpdate': {
      const la = getSymbolSnapshot(a.symbol)?.lastUpdate ?? 0;
      const lb = getSymbolSnapshot(b.symbol)?.lastUpdate ?? 0;
      return la - lb;
    }
    default:
      return 0;
  }
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatRelativeTime(lastUpdate: number, now: number): string {
  const deltaSeconds = Math.max(0, Math.floor((now - lastUpdate) / 1000));
  if (deltaSeconds < 1) {
    return 'just now';
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const NARROW_VIEWPORT_QUERY = '(max-width: 640px)';

/** True below the 640px breakpoint (task 03's convention) — the *other* trigger,
 * besides the split-pane, for narrowing the table down to Symbol/Price/Change %
 * (see `StockListRow`'s `narrow` prop doc for why this needs to physically remove
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

function seedConnectionState(): ConnectionState {
  const source = getSharedSource();
  const current = source.connectionState?.();
  if (current) {
    return current;
  }
  return source.identity() !== null ? { kind: 'connected', since: Date.now() } : { kind: 'connecting', attempt: 1 };
}

function useConnectionBanner(): { state: ConnectionState; remainingSecs: number } {
  const [state, setState] = useState<ConnectionState>(seedConnectionState);
  const [eventReceivedAt, setEventReceivedAt] = useState<number>(() => Date.now());
  const [, forceTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const source = getSharedSource();
    return source.on.status((next) => {
      setEventReceivedAt(Date.now());
      setState(next);
    });
  }, []);

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

  return { state, remainingSecs };
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
const CONN_BANNER_INFO = 'bg-glass border border-glass-border reduced-transparency:bg-surface contrast-more:bg-surface';
const CONN_BANNER_ACTION =
  "[font-family:inherit] [font-style:inherit] [line-height:inherit] font-semibold text-[0.75rem] px-[13px] py-[7px] rounded-md border border-border bg-text text-surface cursor-pointer flex-none [transition:transform_120ms_ease-out,opacity_150ms_ease] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

function ConnectionBanner({ state, remainingSecs }: { state: ConnectionState; remainingSecs: number }) {
  if (state.kind === 'reconnecting') {
    return (
      <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_WARNING}`} role="alert">
        <span className="flex-none text-[15px] text-warning" aria-hidden="true">
          ◴
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[0.85rem]">The stream dropped — retrying in {remainingSecs}s</div>
          <div className="mt-[3px] text-[0.78rem] text-text-muted">
            Attempt {state.attempt}. Prices below are the last values received and are no longer moving.
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
      <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_DANGER}`} role="alert">
        <span className="flex-none text-[15px] text-down" aria-hidden="true">
          ⚠
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[0.85rem]">Disconnected</div>
          <div className="mt-[3px] text-[0.78rem] text-text-muted">{closeDetail(state.code)}</div>
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

function MarketClosedBanner({ status }: { status: MarketStatus }) {
  if (status.state !== 'closed') {
    return null;
  }
  return (
    <div className={`${CONN_BANNER_BASE} ${CONN_BANNER_INFO}`} role="status">
      <span className="flex-none text-[15px] text-text-muted" aria-hidden="true">
        ◷
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[0.85rem]">Market closed</div>
        <div className="mt-[3px] text-[0.78rem] text-text-muted">
          Showing the last completed session. Reopens {formatNextOpen(status)} Cairo time.
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
   * height:34px`. `'hero'` (`HeroCard`'s price row) instead sizes to the fixed
   * `96px x 30px` the design gives it there — this is a *different, non-overlapping*
   * className, not a base-then-override pair, so the two sizings never fight over
   * the same `width`/`height` utility (previously a `.tckr-hero__price-row
   * .tckr-sparkline` descendant-selector override). */
  variant?: 'row' | 'hero';
}) {
  const sizeClass = variant === 'hero' ? 'block w-24 h-[30px] flex-none' : 'block w-full h-[34px]';
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
    const view = getSymbolSnapshot(definition.symbol);
    return { definition, changePercent: view?.changePercent ?? 0, volume: view?.volume ?? 0 };
  });
  const gainer = [...metrics].sort((a, b) => b.changePercent - a.changePercent)[0]!;
  const loser = [...metrics].sort((a, b) => a.changePercent - b.changePercent)[0]!;
  const active = [...metrics].sort((a, b) => b.volume - a.volume)[0]!;
  const candidates: readonly HeroPick[] = [
    { kind: 'gainer', kicker: 'TOP GAINER', definition: gainer.definition },
    { kind: 'loser', kicker: 'TOP LOSER', definition: loser.definition },
    { kind: 'active', kicker: 'MOST ACTIVE', definition: active.definition },
  ];
  // A tiny universe (or a fixture in a test) can have the same symbol win more than
  // one slot — keep only the first (highest-priority) pick per symbol so a card never
  // renders twice.
  const seen = new Set<string>();
  return candidates.filter((pick) => {
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
  'appearance-none m-0 p-0 outline-none text-inherit text-left [font-family:inherit] [font-style:inherit] [line-height:inherit] box-border cursor-pointer w-full pt-4 px-[18px] pb-[15px] rounded-[20px] bg-glass border border-glass-border shadow-[0_18px_40px_-28px_rgba(0,0,0,0.4)] backdrop-blur-tckr backdrop-saturate-[1.6] [transition:transform_160ms_ease-out,border-color_160ms_ease] fine-hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';

function HeroCard({ kicker, kind, definition, priceDecimals, onActivate }: HeroCardProps) {
  const { symbol, name, referencePrice } = definition;

  // Same throttled-subscribe shape as `StockListRow` — see that component's doc for
  // why a hand-rolled interval/gate is the wrong tool here.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const throttledStoreChange = createThrottle(onStoreChange, DISPLAY_REFRESH_INTERVAL_MS);
      const unsubscribe = subscribeSymbol(symbol, throttledStoreChange);
      return () => {
        throttledStoreChange.cancel();
        unsubscribe();
      };
    },
    [symbol],
  );
  const view = useSyncExternalStore(subscribe, () => getSymbolSnapshot(symbol));

  const priceMuted = view === undefined;
  const price = view?.price ?? referencePrice;
  const changePercent = view?.changePercent;
  const volumeLabel = view ? view.volume.toLocaleString('en-US') : '—';

  // Bounded sparkline history — same shape/purpose as `StockListRow`'s (decorative
  // only; every price shown as *text* here still goes through `PriceCell`). Shared
  // ref/effect/read-back triplet lives in `useBoundedSparkline.ts`; this card keeps
  // its own 26-point cap.
  const currentPriceNum = toPlotValue(price);
  const sparklinePoints = useBoundedSparkline(currentPriceNum, 26);
  const direction = sparklineDirection(changePercent);

  const badgeText = kind === 'active' ? `${volumeLabel} QTY` : changePercent === undefined ? '—' : formatSignedPercent(changePercent);
  // Branches the badge's *entire* background/text-color set rather than layering a
  // base `bg-surface-raised` plus a conditional override — both would be plain,
  // equal-specificity utility classes targeting the same `background-color`, so
  // which one wins would depend on Tailwind's internal generation order rather than
  // anything in this file (previously a `.tckr-hero__badge.tckr-delta--up/--down`
  // compound-class selector, which doesn't have a Tailwind utility-class
  // equivalent — see module's migration notes).
  const badgeDeltaClass =
    kind === 'active' || changePercent === undefined
      ? 'bg-surface-raised'
      : changePercent > 0
        ? 'bg-[color-mix(in_oklab,var(--tckr-color-up)_20%,transparent)] text-chip-up'
        : changePercent < 0
          ? 'bg-[color-mix(in_oklab,var(--tckr-color-down)_20%,transparent)] text-chip-down'
          : 'bg-surface-raised';

  const directionWord = direction === 'flat' ? 'unchanged' : direction;
  const ariaLabel =
    kind === 'active'
      ? `${kicker}: ${symbol}, ${String(price)}, volume ${volumeLabel}`
      : changePercent === undefined
        ? `${kicker}: ${symbol}, ${String(price)}`
        : `${kicker}: ${symbol}, ${String(price)}, ${directionWord} ${Math.abs(changePercent).toFixed(1)}%`;

  return (
    <button type="button" className={HERO_CARD_CLASS} aria-label={ariaLabel} onClick={() => onActivate(symbol)}>
      <div className="flex items-center justify-between gap-2.5">
        <span className="font-mono text-[0.62rem] font-semibold tracking-[0.14em] text-text-muted" aria-hidden="true">
          {kicker}
        </span>
        <span
          className={`font-mono text-[0.68rem] font-semibold px-2.5 py-[3px] rounded-full whitespace-nowrap ${badgeDeltaClass}`}
          aria-hidden="true"
        >
          {badgeText}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-3 min-w-0" aria-hidden="true">
        <span className="font-mono font-bold text-[1.2rem]">{symbol}</span>
        <span className="text-[0.75rem] text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
      </div>
      <div className="flex items-end justify-between gap-2.5 mt-2.5" aria-hidden="true">
        <span className="font-mono font-semibold text-[1.55rem]">
          <PriceCell value={price} decimals={priceDecimals} muted={priceMuted} />
        </span>
        <Sparkline points={sparklinePoints} direction={direction} variant="hero" />
      </div>
    </button>
  );
}

function HeroCards({
  picks,
  priceDecimalsBySymbol,
  onActivate,
}: {
  picks: readonly HeroPick[];
  priceDecimalsBySymbol: Map<string, number>;
  onActivate: (symbol: string) => void;
}) {
  if (picks.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      {picks.map((pick) => (
        <HeroCard
          key={pick.kind}
          kicker={pick.kicker}
          kind={pick.kind}
          definition={pick.definition}
          priceDecimals={priceDecimalsBySymbol.get(pick.definition.symbol) ?? 2}
          onActivate={onActivate}
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
const CELL_BASE = 'p-3 border-b border-glass-border overflow-hidden text-ellipsis whitespace-nowrap';

interface StockListRowProps {
  readonly definition: SymbolDefinition;
  readonly priceDecimals: number;
  readonly onActivate: (symbol: string) => void;
  /** Whether this row's symbol is the one currently open in the split-pane detail
   * view (see `useMatch('/symbols/:symbol')` in `StockList`). Purely presentational
   * (a glass highlight + accent edge) — never affects subscription lifecycle. */
  readonly selected?: boolean;
  /** True when the split-pane detail view is open (narrows the list column well
   * below the 640px breakpoint's own narrow-hide threshold). Unlike the 640px
   * breakpoint — which hides the same cells purely via CSS (`display: none`,
   * `.tckr-stocklist__col--narrow-hide`) — this omits the hidden `<td>`s (and,
   * in `StockList`, the corresponding `<col>`/`<th>`) from the DOM entirely.
   * `table-layout: fixed`'s per-column width comes from each column's `<col>`
   * percentage, but Chromium (verified against this exact table) miscomputes it
   * when a visible column's `<col>` sits *after* a `display: none`-hidden one in
   * the same `<colgroup>` — the visible column collapses to ~0 width instead of
   * its specified percentage. Removing the hidden columns' `<col>`/cells outright
   * (rather than hiding them) sidesteps that entirely, at the cost of the two
   * paths (640px viewport vs. split-pane) using different mechanisms for what is
   * visually the same "narrow" state. */
  readonly narrow?: boolean;
}

function StockListRow({ definition, priceDecimals, onActivate, selected = false, narrow = false }: StockListRowProps) {
  const { symbol, name, referencePrice } = definition;

  // A hot symbol can tick dozens of times/sec even after `TickDispatcher`'s per-frame
  // coalescing (that cap is a data-correctness contract, not a readability one — see
  // `src/display/throttle.ts`). This row must repaint at most once per
  // `DISPLAY_REFRESH_INTERVAL_MS`, using the same leading+trailing `createThrottle`
  // `StockDetail.tsx` already uses for the equivalent problem (its `throttledApplyTick`)
  // — wrapping the store-subscription callback itself, rather than a hand-rolled gate
  // plus a second, independently scheduled fallback timer.
  //
  // An earlier version of this file used exactly that hand-rolled shape: a shared
  // `lastRenderAtRef` gate plus a `setInterval` anchored at component *mount* time, on
  // the theory that a fixed periodic tick would guarantee "a repaint at least once per
  // window" even during a continuous burst. In practice the mount-relative schedule is
  // essentially never aligned with the arbitrary moment a real tick lands and updates
  // the gate, so the interval's very next firing after an accepted render almost always
  // landed inside that same render's window and was itself suppressed by the gate —
  // catch-up only succeeded on the *second* interval firing, close to 2x
  // `DISPLAY_REFRESH_INTERVAL_MS` late, not the "within one window" the old comment here
  // claimed.
  //
  // `createThrottle` doesn't have that problem: its trailing-edge `setTimeout` is always
  // scheduled relative to the *leading call's own timestamp* (see `src/display/
  // throttle.ts`), not a fixed external schedule, so a burst of store notifications
  // inside one window reliably produces exactly one trailing catch-up repaint no later
  // than one window after the leading one. A fresh `Throttled` is created once per
  // subscription — i.e. once per mount, since a row's `symbol` never changes in place
  // (rows are keyed by symbol; a symbol swap unmounts/remounts rather than re-parenting)
  // — mirroring how `StockDetail.tsx` scopes its own throttle instance to one effect's
  // lifetime, and `.cancel()` runs in this same subscription's cleanup so no trailing
  // call can ever fire after this row (or its subscription) is gone.
  //
  // Exception: the `selected` row (its detail pane is open beside it in the split
  // view — see `StockList`'s `useMatch`) subscribes *unthrottled*. `StockDetail`
  // keeps its own independent ~30s-throttled display cadence (client-contract.md's
  // "human-trackable" pacing, unchanged, still covered by
  // `StockDetail.display-throttle.test.tsx`) — but its throttle window is anchored
  // to whenever *it* mounted, which is essentially never in phase with this row's own
  // (anchored to whenever this row's subscription last fired, likely long before the
  // symbol was even selected). Two independently-phased ~30s windows reading the same
  // tape can disagree for most of a 30s window at any given instant — visibly so,
  // with the row and the detail pane for the *same symbol* on screen simultaneously.
  // Since this now only affects one row at a time (not the whole table), the
  // performance concern the throttle exists for does not apply here: an unthrottled
  // single row always shows the same true current store value `StockDetail`'s own
  // fresh `getSnapshot()`/live tick will (very shortly) converge to, closing the gap
  // in the direction that was actually reported (the row lagging behind a freshly
  // opened, more current detail pane).
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (selected) {
        return subscribeSymbol(symbol, onStoreChange);
      }
      const throttledStoreChange = createThrottle(onStoreChange, DISPLAY_REFRESH_INTERVAL_MS);
      const unsubscribe = subscribeSymbol(symbol, throttledStoreChange);
      return () => {
        throttledStoreChange.cancel();
        unsubscribe();
      };
    },
    [symbol, selected],
  );
  const view = useSyncExternalStore(subscribe, () => getSymbolSnapshot(symbol));

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
  const lastUpdateLabel = view ? formatRelativeTime(view.lastUpdate, Date.now()) : '—';

  // Decorative sparkline history — bounded, committed post-render (see module doc for
  // why this mirrors PriceCell's flash-tracking shape rather than mutating during
  // render). Never read as text anywhere; text prices always go through PriceCell.
  // `toPlotValue` (`src/chart/ringBuffer.ts`) is the one sanctioned `DecimalString` ->
  // `number` conversion for exactly this "plotting/decoration, never re-displayed as
  // text" purpose — reused here rather than a second, duplicate inline conversion.
  // Shared ref/effect/read-back triplet lives in `useBoundedSparkline.ts`; this row
  // keeps its own 20-point cap (`HeroCard`'s is 26).
  const currentPriceNum = toPlotValue(price);
  const sparklinePoints = useBoundedSparkline(currentPriceNum, 20);
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
  const directionWord = direction === 'flat' ? 'unchanged' : direction;
  const rowAriaLabel =
    changePercent === undefined
      ? `${symbol}, ${String(price)}`
      : `${symbol}, ${String(price)}, ${directionWord} ${Math.abs(changePercent).toFixed(1)}%`;

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(symbol);
    }
  };

  // The changePercent chip's whole background/text-color set is branched together
  // (rather than a base `bg-surface-raised` plus a conditional up/down override) for
  // the same reason `HeroCard`'s badge is — see that component's `badgeDeltaClass`
  // comment. Previously a `.tckr-stocklist__changepct.tckr-delta--up/--down`
  // compound-class selector.
  const changeDeltaClass =
    changePercent === undefined || changePercent === 0
      ? 'bg-surface-raised'
      : changePercent > 0
        ? 'bg-[color-mix(in_oklab,var(--tckr-color-up)_14%,transparent)] text-chip-up'
        : 'bg-[color-mix(in_oklab,var(--tckr-color-down)_14%,transparent)] text-chip-down';

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
      className={`cursor-pointer [transition:background-color_120ms_ease,box-shadow_120ms_ease] fine-hover:bg-[color-mix(in_oklab,var(--tckr-color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2${
        selected ? ' bg-[color-mix(in_oklab,var(--tckr-color-up)_12%,transparent)] shadow-[inset_3px_0_0_var(--tckr-color-up)]' : ''
      }`}
      tabIndex={0}
      aria-label={rowAriaLabel}
      aria-current={selected ? 'true' : undefined}
      data-symbol={symbol}
      data-render-count={renderCountRef.current}
      onClick={() => onActivate(symbol)}
      onKeyDown={handleKeyDown}
    >
      <td className={`${CELL_BASE} text-left font-mono font-bold`}>{symbol}</td>
      {narrow ? null : (
        <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>
          <Sparkline points={sparklinePoints} direction={direction} />
        </td>
      )}
      {narrow ? null : <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>{name}</td>}
      <td className={`${CELL_BASE} text-right tabular-nums`}>
        <PriceCell
          value={price}
          decimals={priceDecimals}
          muted={priceMuted}
          flashDirectionOverride={
            changePercent === undefined ? undefined : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : null
          }
        />
      </td>
      {narrow ? null : (
        <td className={`${CELL_BASE} text-right tabular-nums max-[640px]:hidden`}>
          <PriceCell value={change} decimals={priceDecimals} sign muted={priceMuted} indicateSign />
        </td>
      )}
      <td className={`${CELL_BASE} text-right tabular-nums`}>
        {changePercent === undefined ? (
          <span className="font-mono tabular-nums text-text-muted italic">—</span>
        ) : (
          <span
            className={`font-mono tabular-nums inline-block px-2 py-1 rounded-[5px] [transition:background-color_200ms_ease] ${changeDeltaClass}`}
          >
            {formatSignedPercent(changePercent)}
          </span>
        )}
      </td>
      {narrow ? null : (
        <td className={`${CELL_BASE} text-right tabular-nums max-[640px]:hidden`}>{volumeLabel}</td>
      )}
      {narrow ? null : <td className={`${CELL_BASE} text-left max-[640px]:hidden`}>{lastUpdateLabel}</td>}
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

const SHELL_CLASS = 'flex items-start gap-4 max-[800px]:flex-col max-[800px]:items-stretch';

function shellListColClass(split: boolean): string {
  return `min-w-0 [transition:width_480ms_var(--tckr-ease-out)] motion-reduce:transition-none ${
    split ? 'flex-none w-[380px] max-[800px]:hidden' : 'w-full'
  }`;
}

function shellDetailPaneClass(split: boolean): string {
  return `flex-1 min-w-0 overflow-hidden [transition:opacity_300ms_ease,transform_420ms_var(--tckr-ease-out)] motion-reduce:transition-none max-[800px]:w-full ${
    split ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
  }`;
}

function heroWrapClass(split: boolean): string {
  return `overflow-hidden [transition:max-height_480ms_var(--tckr-ease-out),opacity_300ms_ease,margin-bottom_480ms_var(--tckr-ease-out)] motion-reduce:transition-none ${
    split ? 'max-h-0 opacity-0 mb-0' : 'max-h-[640px] opacity-100 mb-3.5'
  }`;
}

const PILL_BASE =
  '[font-family:inherit] [font-style:inherit] [line-height:inherit] text-[0.72rem] px-3 py-[7px] rounded-full border cursor-pointer [transition:background-color_150ms_ease,color_150ms_ease,border-color_150ms_ease,transform_120ms_ease-out] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const PILL_ACTIVE = 'bg-text text-surface border-text font-semibold';
const PILL_INACTIVE = 'bg-transparent text-text-muted border-border font-medium';

const SEARCH_WRAP_CLASS =
  'flex-[1_1_240px] min-w-[160px] flex items-center gap-2 py-2.5 px-3.5 border border-glass-border rounded-full bg-glass backdrop-blur-tckr backdrop-saturate-150 [transition:border-color_150ms_ease] focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2 reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';

function tableWrapClass(stale: boolean): string {
  const base =
    'w-full max-w-full border border-glass-border rounded-[18px] overflow-hidden bg-glass backdrop-blur-tckr backdrop-saturate-[1.6] shadow-[0_18px_40px_-30px_rgba(0,0,0,0.4)] [transition:opacity_250ms_ease] reduced-transparency:bg-surface reduced-transparency:backdrop-blur-none reduced-transparency:backdrop-saturate-100 contrast-more:bg-surface contrast-more:backdrop-blur-none contrast-more:backdrop-saturate-100';
  return stale ? `${base} opacity-[0.72]` : base;
}

const SORT_BUTTON_CLASS =
  'appearance-none bg-transparent border-none m-0 p-0 outline-none text-inherit [font-family:inherit] [font-style:inherit] [line-height:inherit] [letter-spacing:inherit] [text-transform:inherit] cursor-pointer font-semibold inline-flex items-center gap-0.5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

const EMPTY_ACTION_BUTTON_BASE =
  '[font-family:inherit] [font-style:inherit] [line-height:inherit] font-semibold text-[0.78rem] px-3.5 py-[9px] rounded-[7px] cursor-pointer [transition:transform_120ms_ease-out,opacity_150ms_ease] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export function StockList() {
  const navigate = useNavigate();
  const subscribedRef = useRef<readonly string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [universe, setUniverse] = useState<readonly SymbolDefinition[] | null>(null);
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortState, setSortState] = useState<SortState | null>(null);
  const { state: connState, remainingSecs } = useConnectionBanner();
  const marketStatus = useMarketStatus();

  // Whether a `/symbols/:symbol` child route is open, read straight from the URL —
  // see module doc "Split-pane detail". Purely presentational (grid columns, hero
  // visibility, row highlight); the detail pane's own data lifecycle is owned
  // entirely by `StockDetail` via the `<Outlet />` below, not by this value.
  const detailMatch = useMatch('/symbols/:symbol');
  const selectedSymbol = detailMatch?.params.symbol ?? null;
  const isNarrowViewport = useNarrowViewport();

  // Top Gainer / Top Loser / Most Active — same imperative-poll discipline as
  // `TickerTape`/the active-sort-preset resort below (see module doc). Only runs
  // once the universe is loaded; recomputes on the same cadence as everything else
  // on this page.
  const [heroTick, forceHeroRecompute] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!universe) {
      return;
    }
    const id = setInterval(() => forceHeroRecompute(), DISPLAY_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [universe]);
  // `heroTick` is intentionally in this array even though the body never reads it —
  // bumping it is exactly what forces this memo to recompute on the interval above.
  const heroPicks = useMemo(() => (universe ? pickHeroes(universe) : []), [universe, heroTick]);

  // `sorted` below reads live snapshot values *imperatively*, only when it recomputes
  // (see module doc: resorting on every tick would reintroduce the whole-table
  // re-render this page exists to avoid, and would make rows jump under the cursor).
  // Left alone, that means an active preset (e.g. "Most active") can show a stale,
  // increasingly-misleading ranking indefinitely between sort clicks/searches, even as
  // every individual row keeps visibly repainting. `resortTick` forces one extra
  // recompute per `DISPLAY_REFRESH_INTERVAL_MS` — the same cadence every other repaint
  // on this page already uses — so the ranking can go stale for at most one window,
  // never indefinitely, without resorting on every tick. Mirrors
  // `useConnectionBanner`'s reconnecting-interval: only runs while there is something
  // to keep fresh (`sortState !== null`), and is keyed off that boolean rather than the
  // `SortState` object itself so switching between sort columns doesn't restart the
  // 30s window.
  const [resortTick, forceResort] = useReducer((n: number) => n + 1, 0);
  const hasActiveSort = sortState !== null;
  useEffect(() => {
    if (!hasActiveSort) {
      return;
    }
    const id = setInterval(() => forceResort(), DISPLAY_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasActiveSort]);

  useEffect(() => {
    // `getSharedSource()` is the one app-wide `MarketDataSource` instance — it connects
    // itself, once, at first access (client-contract.md §3: one connection per client).
    // StockList must not call `.connect()`/`.disconnect()` on it: disconnecting here
    // would kill the connection StockDetail shares. Leaving the route only releases
    // this page's own subscriptions.
    const source = getSharedSource();
    let cancelled = false;

    source.getUniverse().then((response) => {
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
    });

    return () => {
      cancelled = true;
      if (subscribedRef.current.length > 0) {
        source.unsubscribe(subscribedRef.current);
        subscribedRef.current = [];
      }
    };
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  // ⌘K / Ctrl+K focuses the search box — additive convenience, no existing behaviour
  // touched.
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const priceDecimalsBySymbol = useMemo(() => {
    const map = new Map<string, number>();
    for (const def of universe ?? []) {
      map.set(def.symbol, Math.max(decimalPlacesOf(def.referencePrice), decimalPlacesOf(def.tickSize)));
    }
    return map;
  }, [universe]);

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
  }, [filtered, sortState, resortTick]);

  const handleSort = useCallback((column: SortColumn) => {
    setSortState((current) => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null;
    });
  }, []);

  const handleRowActivate = useCallback(
    (symbol: string) => {
      // Mirrors the design import's `toggle()`: activating the already-open symbol
      // closes the detail pane instead of re-navigating to the same route.
      navigate(selectedSymbol === symbol ? '/' : `/symbols/${symbol}`);
    },
    [navigate, selectedSymbol],
  );

  const clearSearch = useCallback(() => setRawQuery(''), []);

  if (universe === null) {
    const loadingSplit = selectedSymbol !== null;
    return (
      <>
        <h1 className="sr-only">Tckr Market Watch</h1>
        <div className={SHELL_CLASS}>
          <div className={shellListColClass(loadingSplit)}>
            <p className="text-text-muted">Loading instruments…</p>
          </div>
          <div className={shellDetailPaneClass(loadingSplit)}>
            <Outlet />
          </div>
        </div>
      </>
    );
  }

  const isStale = connState.kind === 'reconnecting' || connState.kind === 'closed';
  const activePreset = presetFor(sortState);
  const isSplit = selectedSymbol !== null;
  // The list column collapses to Symbol/Price/Change % whenever *either* the
  // split-pane detail is open or the real viewport is narrow — see
  // `useNarrowViewport`'s doc for why both paths share this one DOM-level
  // mechanism instead of the split-pane using it and the viewport case keeping
  // the old CSS-only `display: none` one.
  const narrow = isSplit || isNarrowViewport;

  return (
    <div className="w-full max-w-full">
      <h1 className="sr-only">Tckr Market Watch</h1>

      <ConnectionBanner state={connState} remainingSecs={remainingSecs} />
      <MarketClosedBanner status={marketStatus} />

      <div className={heroWrapClass(isSplit)}>
        <HeroCards picks={heroPicks} priceDecimalsBySymbol={priceDecimalsBySymbol} onActivate={handleRowActivate} />
      </div>

      <div className={`flex items-center gap-2.5 mb-3 flex-wrap${isSplit ? ' max-[800px]:hidden' : ''}`}>
        {isSplit ? (
          <button type="button" className={`${PILL_BASE} ${PILL_INACTIVE} flex-none`} onClick={() => navigate('/')}>
            ← All instruments
          </button>
        ) : null}
        <div className="flex gap-1.5 flex-wrap">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${PILL_BASE} ${activePreset === preset.id ? PILL_ACTIVE : PILL_INACTIVE}`}
              onClick={() => setSortState(preset.sort)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className={SEARCH_WRAP_CLASS} htmlFor="tckr-stocklist-search">
          <span className="text-text-muted text-[13px] flex-none" aria-hidden="true">
            ⌕
          </span>
          <input
            id="tckr-stocklist-search"
            ref={searchInputRef}
            type="search"
            className="appearance-none bg-transparent border-none m-0 p-0 outline-none [font-family:inherit] [font-style:inherit] [line-height:inherit] flex-[1_1_auto] min-w-0 text-text text-[0.85rem] placeholder:text-text-muted"
            aria-label="Search symbol or name"
            placeholder="Search symbol or name"
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
          />
          <span className="flex-none font-mono text-[0.65rem] text-text-muted border border-border rounded px-1.5 py-[3px]">
            ⌘K
          </span>
        </label>
      </div>

      <div className={SHELL_CLASS}>
        <div className={shellListColClass(isSplit)}>
          <div className={tableWrapClass(isStale)}>
            <table className="w-full max-w-full border-collapse table-fixed">
              <colgroup>
                {COLUMNS.filter((column) => !narrow || !column.hideNarrow).map((column) => (
                  <col
                    key={column.key}
                    style={{ width: `${narrow ? narrowColumnWidthPercent(column) : column.widthPercent}%` }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.filter((column) => !narrow || !column.hideNarrow).map((column) => (
                    <th
                      key={column.key}
                      className={`${CELL_BASE} text-left font-mono text-[0.62rem] font-semibold tracking-[0.1em] text-text-muted uppercase bg-transparent${
                        !narrow && column.hideNarrow ? ' max-[640px]:hidden' : ''
                      }`}
                      aria-sort={
                        column.sortable && sortState?.column === column.key
                          ? sortState.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {column.sortable ? (
                        <button type="button" className={SORT_BUTTON_CLASS} onClick={() => handleSort(column.key as SortColumn)}>
                          {column.label}
                          {sortState?.column === column.key ? (sortState.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={narrow ? COLUMNS.filter((column) => !column.hideNarrow).length : COLUMNS.length}
                      className="text-center text-text-muted px-4 py-11 whitespace-normal animate-fade-in"
                    >
                      <div className="font-mono text-[0.78rem] tracking-[0.04em]">0 of {universe.length}</div>
                      <div className="mt-3 font-bold text-[1.05rem] text-text">
                        No instruments match &ldquo;{rawQuery}&rdquo;
                      </div>
                      <div className="mt-2 mx-auto max-w-[340px] text-[0.82rem] leading-[1.55]">
                        Search runs on symbol and name. Try a shorter query, or browse the full board.
                      </div>
                      <div className="mt-[18px] flex gap-2 justify-center flex-wrap">
                        <button
                          type="button"
                          className={`${EMPTY_ACTION_BUTTON_BASE} border-0 bg-text text-surface`}
                          onClick={clearSearch}
                        >
                          Clear search
                        </button>
                        <button
                          type="button"
                          className={`${EMPTY_ACTION_BUTTON_BASE} border border-border bg-transparent text-text`}
                          onClick={clearSearch}
                        >
                          Browse all {universe.length}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sorted.map((def) => (
                    <StockListRow
                      key={def.symbol}
                      definition={def}
                      priceDecimals={priceDecimalsBySymbol.get(def.symbol) ?? 2}
                      onActivate={handleRowActivate}
                      selected={def.symbol === selectedSymbol}
                      narrow={narrow}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className={shellDetailPaneClass(isSplit)}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

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
 *    shared `MarketDataSource`, exactly like `ConnectionStatus`/`StreamBadge` already
 *    are (multiple independent subscribers to the same singleton is an established
 *    pattern, not a new one). Its "Retry now"/"Reconnect" buttons call
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
// (not sharing state with) ConnectionStatus/StreamBadge. See module doc.
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

function ConnectionBanner({ state, remainingSecs }: { state: ConnectionState; remainingSecs: number }) {
  if (state.kind === 'reconnecting') {
    return (
      <div className="tckr-conn-banner tckr-conn-banner--warning" role="alert">
        <span className="tckr-conn-banner__icon" aria-hidden="true">
          ◴
        </span>
        <div className="tckr-conn-banner__body">
          <div className="tckr-conn-banner__title">The stream dropped — retrying in {remainingSecs}s</div>
          <div className="tckr-conn-banner__detail">
            Attempt {state.attempt}. Prices below are the last values received and are no longer moving.
          </div>
        </div>
        <button
          type="button"
          className="tckr-conn-banner__action"
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
      <div className="tckr-conn-banner tckr-conn-banner--danger" role="alert">
        <span className="tckr-conn-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <div className="tckr-conn-banner__body">
          <div className="tckr-conn-banner__title">Disconnected</div>
          <div className="tckr-conn-banner__detail">{closeDetail(state.code)}</div>
        </div>
        <button
          type="button"
          className="tckr-conn-banner__action"
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
    <div className="tckr-conn-banner tckr-conn-banner--info" role="status">
      <span className="tckr-conn-banner__icon" aria-hidden="true">
        ◷
      </span>
      <div className="tckr-conn-banner__body">
        <div className="tckr-conn-banner__title">Market closed</div>
        <div className="tckr-conn-banner__detail">
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

function Sparkline({ points, direction }: { points: readonly number[]; direction: 'up' | 'down' | 'flat' }) {
  const lineClass = `tckr-sparkline__line tckr-sparkline__line--${direction}`;
  if (points.length < 2) {
    return (
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="tckr-sparkline" aria-hidden="true">
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
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="tckr-sparkline" aria-hidden="true">
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
  // only; every price shown as *text* here still goes through `PriceCell`).
  const historyRef = useRef<number[]>([]);
  const currentPriceNum = toPlotValue(price);
  useEffect(() => {
    const last = historyRef.current[historyRef.current.length - 1];
    if (last !== currentPriceNum) {
      historyRef.current = [...historyRef.current, currentPriceNum].slice(-26);
    }
  }, [currentPriceNum]);
  const sparklinePoints =
    historyRef.current[historyRef.current.length - 1] === currentPriceNum
      ? historyRef.current
      : [...historyRef.current, currentPriceNum];
  const direction: 'up' | 'down' | 'flat' =
    changePercent === undefined || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';

  const badgeText = kind === 'active' ? `${volumeLabel} QTY` : changePercent === undefined ? '—' : formatSignedPercent(changePercent);
  const badgeDeltaClass =
    kind === 'active' || changePercent === undefined
      ? ''
      : changePercent > 0
        ? ' tckr-delta--up'
        : changePercent < 0
          ? ' tckr-delta--down'
          : '';

  const directionWord = direction === 'flat' ? 'unchanged' : direction;
  const ariaLabel =
    kind === 'active'
      ? `${kicker}: ${symbol}, ${String(price)}, volume ${volumeLabel}`
      : changePercent === undefined
        ? `${kicker}: ${symbol}, ${String(price)}`
        : `${kicker}: ${symbol}, ${String(price)}, ${directionWord} ${Math.abs(changePercent).toFixed(1)}%`;

  return (
    <button type="button" className="tckr-hero__card" aria-label={ariaLabel} onClick={() => onActivate(symbol)}>
      <div className="tckr-hero__row">
        <span className="tckr-hero__kicker" aria-hidden="true">
          {kicker}
        </span>
        <span className={`tckr-hero__badge${badgeDeltaClass}`} aria-hidden="true">
          {badgeText}
        </span>
      </div>
      <div className="tckr-hero__identity" aria-hidden="true">
        <span className="tckr-hero__symbol">{symbol}</span>
        <span className="tckr-hero__name">{name}</span>
      </div>
      <div className="tckr-hero__price-row" aria-hidden="true">
        <span className="tckr-hero__price">
          <PriceCell value={price} decimals={priceDecimals} muted={priceMuted} />
        </span>
        <Sparkline points={sparklinePoints} direction={direction} />
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
    <div className="tckr-hero">
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

const STOCK_LIST_STYLES = `
.tckr-stocklist { width: 100%; max-width: 100%; }

/* Screen-reader-only page heading (Lighthouse: pages need a heading landmark for
   heading-based navigation) — visible to assistive tech, invisible on-screen so it
   doesn't disrupt the existing "no visible page title" design. Standard
   clip-rect visually-hidden pattern; scoped to this file since no shared
   visually-hidden utility exists yet in src/styles/. */
.tckr-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@keyframes tckr-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.tckr-conn-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 999px;
  margin-bottom: 14px;
  backdrop-filter: blur(var(--tckr-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--tckr-blur)) saturate(150%);
  animation: tckr-banner-in 220ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes tckr-banner-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.tckr-conn-banner--warning {
  background: color-mix(in oklab, var(--tckr-color-warning) 16%, var(--tckr-glass-bg));
  border: 1px solid color-mix(in oklab, var(--tckr-color-warning) 32%, transparent);
}
.tckr-conn-banner--danger {
  background: color-mix(in oklab, var(--tckr-color-down) 16%, var(--tckr-glass-bg));
  border: 1px solid color-mix(in oklab, var(--tckr-color-down) 32%, transparent);
}
/* Neutral, not warning/danger-colored: the market being closed overnight/on the
   weekend is expected, routine state, not a problem with the connection — using the
   same amber/red treatment as a dropped stream would wrongly suggest something is
   wrong. */
.tckr-conn-banner--info {
  background: var(--tckr-glass-bg);
  border: 1px solid var(--tckr-glass-border);
}
.tckr-conn-banner--info .tckr-conn-banner__icon { color: var(--tckr-color-text-muted); }
.tckr-conn-banner__icon { flex: none; font-size: 15px; color: var(--tckr-color-warning); }
.tckr-conn-banner--danger .tckr-conn-banner__icon { color: var(--tckr-color-down); }
.tckr-conn-banner__body { flex: 1 1 auto; min-width: 0; }
.tckr-conn-banner__title { font-weight: 600; font-size: 0.85rem; }
.tckr-conn-banner__detail { margin-top: 3px; font-size: 0.78rem; color: var(--tckr-color-text-muted); }
.tckr-conn-banner__action {
  flex: none;
  font: inherit;
  font-weight: 600;
  font-size: 0.75rem;
  padding: 7px 13px;
  border-radius: 6px;
  border: 1px solid var(--tckr-color-border);
  background: var(--tckr-color-text);
  color: var(--tckr-color-surface);
  cursor: pointer;
  transition: transform 120ms ease-out, opacity 150ms ease;
}
.tckr-conn-banner__action:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-conn-banner__action:active { transform: scale(0.96); }

.tckr-stocklist__toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.tckr-stocklist__pills { display: flex; gap: 6px; flex-wrap: wrap; }
.tckr-pill {
  font: inherit;
  font-size: 0.72rem;
  font-weight: 500;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--tckr-color-border);
  background: transparent;
  color: var(--tckr-color-text-muted);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease-out;
}
.tckr-pill--active { background: var(--tckr-color-text); color: var(--tckr-color-surface); border-color: var(--tckr-color-text); font-weight: 600; }
.tckr-pill:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-pill:active { transform: scale(0.96); }
.tckr-stocklist__search-wrap {
  flex: 1 1 240px;
  min-width: 160px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--tckr-glass-border);
  border-radius: 999px;
  background: var(--tckr-glass-bg);
  backdrop-filter: blur(var(--tckr-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--tckr-blur)) saturate(150%);
  transition: border-color 150ms ease;
}
.tckr-stocklist__search-wrap:focus-within { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-stocklist__search-icon { color: var(--tckr-color-text-muted); font-size: 13px; flex: none; }
.tckr-stocklist__search {
  all: unset;
  flex: 1 1 auto;
  min-width: 0;
  color: var(--tckr-color-text);
  font-size: 0.85rem;
}
.tckr-stocklist__search::placeholder { color: var(--tckr-color-text-muted); }
.tckr-stocklist__kbd {
  flex: none;
  font-family: var(--tckr-font-mono);
  font-size: 0.65rem;
  color: var(--tckr-color-text-muted);
  border: 1px solid var(--tckr-color-border);
  border-radius: 4px;
  padding: 3px 6px;
}
.tckr-stocklist__table-wrap {
  width: 100%;
  max-width: 100%;
  border: 1px solid var(--tckr-glass-border);
  border-radius: 18px;
  overflow: hidden;
  background: var(--tckr-glass-bg);
  backdrop-filter: blur(var(--tckr-blur)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--tckr-blur)) saturate(160%);
  box-shadow: 0 18px 40px -30px rgba(0, 0, 0, 0.4);
}
.tckr-stocklist__table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; }
.tckr-stocklist__table th,
.tckr-stocklist__table td {
  padding: 12px 12px;
  text-align: left;
  border-bottom: 1px solid var(--tckr-glass-border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tckr-stocklist__table thead th {
  font-family: var(--tckr-font-mono);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--tckr-color-text-muted);
  text-transform: uppercase;
  background: transparent;
}
.tckr-stocklist__cell--symbol { font-family: var(--tckr-font-mono); font-weight: 700; }
.tckr-stocklist__cell--numeric { text-align: right; font-variant-numeric: tabular-nums; }
.tckr-stocklist__sort-button {
  all: unset;
  cursor: pointer;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.tckr-stocklist__sort-button:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-stocklist__row { cursor: pointer; transition: background-color 120ms ease, box-shadow 120ms ease; }
@media (hover: hover) and (pointer: fine) {
  .tckr-stocklist__row:hover { background: color-mix(in oklab, var(--tckr-color-text) 6%, transparent); }
}
.tckr-stocklist__row:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: -2px; }
.tckr-stocklist__row--selected {
  background: color-mix(in oklab, var(--tckr-color-up) 12%, transparent);
  box-shadow: inset 3px 0 0 var(--tckr-color-up);
}
.tckr-stocklist--stale .tckr-stocklist__table-wrap { transition: opacity 250ms ease; opacity: 0.72; }
.tckr-stocklist__changepct {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--tckr-color-surface-raised);
}
.tckr-stocklist__changepct { transition: background-color 200ms ease; }
.tckr-stocklist__changepct.tckr-delta--up { background: color-mix(in oklab, var(--tckr-color-up) 14%, transparent); }
.tckr-stocklist__changepct.tckr-delta--down { background: color-mix(in oklab, var(--tckr-color-down) 14%, transparent); }
.tckr-sparkline { width: 100%; height: 34px; display: block; }
.tckr-sparkline__line { stroke-width: 1.6; transition: stroke 200ms ease; }
.tckr-sparkline__line--up { stroke: var(--tckr-color-up); }
.tckr-sparkline__line--down { stroke: var(--tckr-color-down); }
.tckr-sparkline__line--flat { stroke: var(--tckr-color-text-muted); }
.tckr-stocklist__empty { text-align: center; color: var(--tckr-color-text-muted); padding: 44px 16px; white-space: normal; animation: tckr-fade-in 200ms ease-out; }
.tckr-stocklist__empty-count { font-family: var(--tckr-font-mono); font-size: 0.78rem; letter-spacing: 0.04em; }
.tckr-stocklist__empty-title { margin-top: 12px; font-weight: 700; font-size: 1.05rem; color: var(--tckr-color-text); }
.tckr-stocklist__empty-detail { margin: 8px auto 0; max-width: 340px; font-size: 0.82rem; line-height: 1.55; }
.tckr-stocklist__empty-actions { margin-top: 18px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.tckr-stocklist__empty-actions button {
  font: inherit;
  font-weight: 600;
  font-size: 0.78rem;
  padding: 9px 14px;
  border-radius: 7px;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity 150ms ease;
}
.tckr-stocklist__empty-actions button:active { transform: scale(0.96); }
.tckr-stocklist__empty-actions button:first-child { border: none; background: var(--tckr-color-text); color: var(--tckr-color-surface); }
.tckr-stocklist__empty-actions button:last-child { border: 1px solid var(--tckr-color-border); background: transparent; color: var(--tckr-color-text); }
.tckr-stocklist__empty-actions button:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-stocklist__loading { color: var(--tckr-color-text-muted); }
@media (max-width: 640px) {
  .tckr-stocklist__col--narrow-hide { display: none; }
}

/* ---- Hero cards (Top Gainer / Top Loser / Most Active) ---------------------
 * .tckr-hero-wrap stays mounted at all times (rather than the hero row being
 * conditionally rendered) purely so it has something to animate: collapsing via
 * max-height — a plain length, reliably animatable — rather than the mock's own
 * grid-template-rows track-size transition (an fr-track transition, which has the
 * same cross-browser animation problem .tckr-stocklist__shell used to have, see
 * that rule's doc below). The max-height ceiling below is a deliberately generous
 * guess at the tallest this row ever renders (three cards can wrap to multiple
 * lines on a narrow split-pane list column) — see this technique's well-known
 * "expand finishes faster than the nominal duration once content is shorter than
 * the ceiling" trade-off, which is fine for a one-directional reveal like this.
 */
.tckr-hero-wrap {
  overflow: hidden;
  max-height: 640px;
  opacity: 1;
  margin-bottom: 14px;
  transition: max-height 480ms cubic-bezier(0.23, 1, 0.32, 1), opacity 300ms ease, margin-bottom 480ms cubic-bezier(0.23, 1, 0.32, 1);
}
.tckr-hero-wrap--collapsed {
  max-height: 0;
  opacity: 0;
  margin-bottom: 0;
}
@media (prefers-reduced-motion: reduce) {
  .tckr-hero-wrap {
    transition: none;
  }
}
.tckr-hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.tckr-hero__card {
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  width: 100%;
  padding: 16px 18px 15px;
  border-radius: 20px;
  background: var(--tckr-glass-bg);
  backdrop-filter: blur(var(--tckr-blur)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--tckr-blur)) saturate(160%);
  border: 1px solid var(--tckr-glass-border);
  box-shadow: 0 18px 40px -28px rgba(0, 0, 0, 0.4);
  transition: transform 160ms ease-out, border-color 160ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .tckr-hero__card:hover { transform: translateY(-2px); }
}
.tckr-hero__card:focus-visible { outline: 2px solid var(--tckr-color-accent); outline-offset: 2px; }
.tckr-hero__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tckr-hero__kicker { font-family: var(--tckr-font-mono); font-size: 0.62rem; font-weight: 600; letter-spacing: 0.14em; color: var(--tckr-color-text-muted); }
.tckr-hero__badge {
  font-family: var(--tckr-font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--tckr-color-surface-raised);
  white-space: nowrap;
}
.tckr-hero__badge.tckr-delta--up { background: color-mix(in oklab, var(--tckr-color-up) 20%, transparent); }
.tckr-hero__badge.tckr-delta--down { background: color-mix(in oklab, var(--tckr-color-down) 20%, transparent); }
.tckr-hero__identity { display: flex; align-items: baseline; gap: 8px; margin-top: 12px; min-width: 0; }
.tckr-hero__symbol { font-family: var(--tckr-font-mono); font-weight: 700; font-size: 1.2rem; }
.tckr-hero__name { font-size: 0.75rem; color: var(--tckr-color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tckr-hero__price-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin-top: 10px; }
.tckr-hero__price { font-family: var(--tckr-font-mono); font-weight: 600; font-size: 1.55rem; }
.tckr-hero__price-row .tckr-sparkline { width: 96px; height: 30px; flex: none; }

/* ---- Split-pane shell: list | detail (Frosted Glass Revamp) ----------------
 * Flexbox, not CSS Grid: an earlier version of this animated via
 * grid-template-columns between values using fr/minmax(...) tracks (e.g.
 * "minmax(0, 1fr) 0fr" -> "minmax(280px, 420px) minmax(0, 1fr)"), which does not
 * reliably animate in browsers — fr and minmax() track sizes are not smoothly
 * interpolable the way a plain length/percentage is, so the layout snapped instead
 * of sliding. width and opacity/transform, both plain animatable properties, do
 * not have that problem: .tckr-stocklist__list-col's width transitions between two
 * plain values (100% vs. a px width), and .tckr-stocklist__detail-pane — kept at
 * flex: 1 1 auto throughout — simply fills whatever space the list column's
 * shrinking width leaves behind, every frame, for free (the same technique any
 * animated resizable-sidebar layout uses).
 *
 * .tckr-stocklist__detail-pane always renders the Outlet — when no child route
 * matches, it renders nothing, so the pane is simply empty (zero visual width, since
 * nothing is there to give it a flex-basis) rather than conditionally mounted.
 */
.tckr-stocklist__shell {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.tckr-stocklist__list-col {
  min-width: 0;
  width: 100%;
  transition: width 480ms cubic-bezier(0.23, 1, 0.32, 1);
}
.tckr-stocklist__shell--split .tckr-stocklist__list-col {
  width: 380px;
  flex: none;
}
.tckr-stocklist__detail-pane {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateX(16px);
  transition: opacity 300ms ease, transform 420ms cubic-bezier(0.23, 1, 0.32, 1);
}
.tckr-stocklist__shell--split .tckr-stocklist__detail-pane {
  opacity: 1;
  transform: translateX(0);
}
@media (prefers-reduced-motion: reduce) {
  .tckr-stocklist__list-col,
  .tckr-stocklist__detail-pane {
    transition: none;
  }
}
/* StockDetail centers itself with a 760px max-width for its standalone-page use
   (its own unit tests render it that way) — inside the narrower split pane it should
   simply fill the column instead. */
.tckr-stocklist__detail-pane .tckr-detail { max-width: none; margin: 0; }
/* Force the same narrow-column-hiding the 640px breakpoint already uses whenever the
   detail pane is open, regardless of actual viewport width — the list column is
   narrow then even on a wide screen. */
.tckr-stocklist__shell--split .tckr-stocklist__col--narrow-hide { display: none; }
.tckr-stocklist__all-link { flex: none; }

/* ---- Mobile: the split pane stacks instead of squeezing side by side ------
 * The split pane's fixed 380px list column (above) simply does not fit next to a
 * usable detail pane under ~800px wide — before this rule it would overflow the
 * viewport horizontally with the detail pane pushed off-screen entirely
 * (.tckr-shell's overflow-x: hidden was silently clipping it, not just clipping
 * a decorative border). Below the breakpoint, opening a symbol instead hides the
 * list (still mounted — its search text, sort state, and subscriptions survive
 * exactly as on desktop, see the module doc) and gives the detail pane the full
 * width, matching a normal mobile "drill in" pattern. The toolbar (search/sort
 * pills) hides too: StockDetail's own topbar already has a "← All instruments"
 * link back, so the toolbar's copy of that pill is redundant once the list
 * itself isn't visible to search/sort.
 */
@media (max-width: 800px) {
  .tckr-stocklist__shell {
    flex-direction: column;
    align-items: stretch;
  }
  .tckr-stocklist__detail-pane {
    width: 100%;
  }
  .tckr-stocklist--split .tckr-stocklist__toolbar {
    display: none;
  }
  .tckr-stocklist__shell--split .tckr-stocklist__list-col {
    display: none;
  }
  .tckr-stocklist__shell--split .tckr-stocklist__detail-pane {
    transform: none;
  }
}
`;

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
  const historyRef = useRef<number[]>([]);
  const currentPriceNum = toPlotValue(price);
  useEffect(() => {
    const last = historyRef.current[historyRef.current.length - 1];
    if (last !== currentPriceNum) {
      historyRef.current = [...historyRef.current, currentPriceNum].slice(-20);
    }
  }, [currentPriceNum]);
  const sparklinePoints =
    historyRef.current[historyRef.current.length - 1] === currentPriceNum
      ? historyRef.current
      : [...historyRef.current, currentPriceNum];
  const sparklineDirection: 'up' | 'down' | 'flat' =
    changePercent === undefined || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';

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
  const directionWord = sparklineDirection === 'flat' ? 'unchanged' : sparklineDirection;
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

  return (
    <tr
      className={`tckr-stocklist__row${selected ? ' tckr-stocklist__row--selected' : ''}`}
      tabIndex={0}
      aria-label={rowAriaLabel}
      aria-current={selected ? 'true' : undefined}
      data-symbol={symbol}
      data-render-count={renderCountRef.current}
      onClick={() => onActivate(symbol)}
      onKeyDown={handleKeyDown}
    >
      <td className="tckr-stocklist__cell tckr-stocklist__cell--symbol">{symbol}</td>
      {narrow ? null : (
        <td className="tckr-stocklist__cell tckr-stocklist__col--narrow-hide">
          <Sparkline points={sparklinePoints} direction={sparklineDirection} />
        </td>
      )}
      {narrow ? null : <td className="tckr-stocklist__cell tckr-stocklist__col--narrow-hide">{name}</td>}
      <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric">
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
        <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric tckr-stocklist__col--narrow-hide">
          <PriceCell value={change} decimals={priceDecimals} sign muted={priceMuted} indicateSign />
        </td>
      )}
      <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric">
        {changePercent === undefined ? (
          <span className="tckr-price-cell tckr-price-cell--muted">—</span>
        ) : (
          <span
            className={`tckr-price-cell tckr-stocklist__changepct${
              changePercent > 0 ? ' tckr-delta--up' : changePercent < 0 ? ' tckr-delta--down' : ''
            }`}
          >
            {formatSignedPercent(changePercent)}
          </span>
        )}
      </td>
      {narrow ? null : (
        <td className="tckr-stocklist__cell tckr-stocklist__cell--numeric tckr-stocklist__col--narrow-hide">
          {volumeLabel}
        </td>
      )}
      {narrow ? null : <td className="tckr-stocklist__cell tckr-stocklist__col--narrow-hide">{lastUpdateLabel}</td>}
    </tr>
  );
}

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
    return (
      <>
        <style>{STOCK_LIST_STYLES}</style>
        <h1 className="tckr-visually-hidden">Tckr Market Watch</h1>
        <div className={`tckr-stocklist__shell${selectedSymbol ? ' tckr-stocklist__shell--split' : ''}`}>
          <div className="tckr-stocklist__list-col">
            <p className="tckr-stocklist__loading">Loading instruments…</p>
          </div>
          <div className="tckr-stocklist__detail-pane">
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
    <div
      className={`tckr-stocklist${isStale ? ' tckr-stocklist--stale' : ''}${isSplit ? ' tckr-stocklist--split' : ''}`}
    >
      <style>{STOCK_LIST_STYLES}</style>

      <h1 className="tckr-visually-hidden">Tckr Market Watch</h1>

      <ConnectionBanner state={connState} remainingSecs={remainingSecs} />
      <MarketClosedBanner status={marketStatus} />

      <div className={`tckr-hero-wrap${isSplit ? ' tckr-hero-wrap--collapsed' : ''}`}>
        <HeroCards picks={heroPicks} priceDecimalsBySymbol={priceDecimalsBySymbol} onActivate={handleRowActivate} />
      </div>

      <div className="tckr-stocklist__toolbar">
        {isSplit ? (
          <button type="button" className="tckr-pill tckr-stocklist__all-link" onClick={() => navigate('/')}>
            ← All instruments
          </button>
        ) : null}
        <div className="tckr-stocklist__pills">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`tckr-pill${activePreset === preset.id ? ' tckr-pill--active' : ''}`}
              onClick={() => setSortState(preset.sort)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="tckr-stocklist__search-wrap" htmlFor="tckr-stocklist-search">
          <span className="tckr-stocklist__search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            id="tckr-stocklist-search"
            ref={searchInputRef}
            type="search"
            className="tckr-stocklist__search"
            aria-label="Search symbol or name"
            placeholder="Search symbol or name"
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
          />
          <span className="tckr-stocklist__kbd">⌘K</span>
        </label>
      </div>

      <div className={`tckr-stocklist__shell${isSplit ? ' tckr-stocklist__shell--split' : ''}`}>
        <div className="tckr-stocklist__list-col">
          <div className="tckr-stocklist__table-wrap">
            <table className="tckr-stocklist__table">
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
                      className={!narrow && column.hideNarrow ? 'tckr-stocklist__col--narrow-hide' : undefined}
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
                          className="tckr-stocklist__sort-button"
                          onClick={() => handleSort(column.key as SortColumn)}
                        >
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
                      className="tckr-stocklist__empty"
                    >
                      <div className="tckr-stocklist__empty-count">0 of {universe.length}</div>
                      <div className="tckr-stocklist__empty-title">No instruments match &ldquo;{rawQuery}&rdquo;</div>
                      <div className="tckr-stocklist__empty-detail">
                        Search runs on symbol and name. Try a shorter query, or browse the full board.
                      </div>
                      <div className="tckr-stocklist__empty-actions">
                        <button type="button" onClick={clearSearch}>
                          Clear search
                        </button>
                        <button type="button" onClick={clearSearch}>
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
        <div className="tckr-stocklist__detail-pane">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

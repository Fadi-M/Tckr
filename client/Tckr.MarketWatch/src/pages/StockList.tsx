/**
 * StockList — task 04 (docs/phase-3-web-client/04-stock-list.md), route `/`.
 *
 * Renders the 34-instrument universe as a searchable, sortable table where a tick for
 * one symbol re-renders that row and nothing else (README.md design decision #9). The
 * page itself never subscribes to price data — it owns the symbol list (from
 * `getUniverse()`), the search text and the sort state; each `StockListRow` below
 * subscribes to its own symbol via `useSyncExternalStore`.
 *
 * Where the board's pieces live (this file composes them):
 * - `boardColumns.tsx`: column specs, sort comparators, order presets, percent helpers.
 * - `useBoardUniverse.ts`: fetching the universe, subscriptions, sparkline history, retry.
 * - `useBoardSearch.ts` / `useBoardSort.ts`: the search box and sort state.
 * - `useRowReorderGlide.ts`: the re-rank motion.
 * - `useBoardKeyboard.ts`: page shortcuts (⌘K, /, Escape) and focus restore on open/close.
 * - `BoardBanners.tsx`: delayed, connection, market-closed and moment banners.
 * - `HeroCards.tsx`: the highlight cards and their sparkline.
 * - `StockListRow.tsx`: one row (the per-symbol subscription).
 * - `boardChrome.tsx`: layout class fragments and the keyboard-help popover.
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
 * Two presentational/decorative additions live with this page (now in `BoardBanners.tsx`
 * and `HeroCards.tsx`) rather than in
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
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { decimalPlaces } from '../contracts/decimal.ts';
import { BOARD_ID } from './pageAnchors.ts';
import { SYMBOL_ROUTE_PATTERN, symbolPath } from './routes.ts';
import {
  formatCairoClock,
  formatCairoDateShort,
  formatCairoTimeShort,
} from '../data/marketCalendar.ts';
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
} from '../components/icons.tsx';
import { FormingCandle } from '../motion/FormingCandle.tsx';
import { modifierKeyLabel } from '../components/keyboard.ts';
import { useMarketStatus } from '../components/useMarketStatus.ts';
import { isHeld } from '../components/useConnectionState.ts';
import { HeldTag } from '../components/HeldTag.tsx';
import { useViewTransitionNavigate } from '../components/useViewTransitionNavigate.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../display/throttle.ts';
import type { ColumnKey, SortColumn } from './boardColumns.tsx';
import {
  COLUMNS,
  presetFor,
  visibleColumns,
  PRESETS,
  describeOrder,
  BoardUpdatedAt,
  columnWidthPercent,
} from './boardColumns.tsx';
import {
  useConnectionBanner,
  useRecoveryMoment,
  useViewerStream,
  useOpeningBell,
  CONN_BANNER_BASE,
  CONN_BANNER_DANGER,
  CONN_BANNER_ACTION,
  ConnectionBanner,
  CONN_BANNER_STICKY_PHONE,
  CONN_BANNER_STICKY,
  DelayedStreamBanner,
  MomentBanner,
  MarketClosedBanner,
} from './BoardBanners.tsx';
import { HeroCards } from './HeroCards.tsx';

import { CELL_BASE, StockListRow } from './StockListRow.tsx';
import { useBoardUniverse } from './useBoardUniverse.ts';
import { useRowReorderGlide } from './useRowReorderGlide.ts';
import { useBoardShortcuts, useDetailFocusRestore } from './useBoardKeyboard.ts';
import { useBoardSearch } from './useBoardSearch.ts';
import { useBoardSort } from './useBoardSort.ts';
import {
  SHELL_CLASS,
  shellListColClass,
  shellDetailPaneClass,
  heroWrapClass,
  PILL_BASE,
  PILL_ACTIVE,
  PILL_INACTIVE,
  SEARCH_WRAP_CLASS,
  tableWrapClass,
  SORT_BUTTON_CLASS,
  BOARD_HELP_ID,
  BoardKeyboardHelp,
  EMPTY_ACTION_BUTTON_BASE,
} from './boardChrome.tsx';

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

export function StockList() {
  // Every navigation from this page opens or closes the split pane, so every one goes
  // through the view-transition wrapper (see `useViewTransitionNavigate`).
  const navigate = useViewTransitionNavigate();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const { universe, universeFailed, retryUniverse, sessionTrends } = useBoardUniverse();
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
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
  const { rawQuery, setRawQuery, debouncedQuery, filtered, suggestions, clearSearch } =
    useBoardSearch(universe);
  const { sortState, setSortState, sorted, handleSort } = useBoardSort(filtered);

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

  const handleRowActivate = useCallback(
    (symbol: string) => {
      // Mirrors the design import's `toggle()`: activating the already-open symbol
      // closes the detail pane instead of re-navigating to the same route.
      navigate(selectedSymbol === symbol ? '/' : symbolPath(symbol));
    },
    [navigate, selectedSymbol],
  );

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

  // ⌘K / "/" focus search, Escape closes the detail; focus follows the pane open/close.
  useBoardShortcuts(searchInputRef, selectedSymbol, navigate);
  useDetailFocusRestore(tbodyRef, selectedSymbol);
  // Re-rank motion: rows that changed rank glide to their new place.
  useRowReorderGlide(tbodyRef, sorted.map((def) => def.symbol).join(','));

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
                <button type="button" className={CONN_BANNER_ACTION} onClick={retryUniverse}>
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

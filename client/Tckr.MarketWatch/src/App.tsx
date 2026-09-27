/**
 * The application frame — task 03 (docs/phase-3-web-client/03-app-shell.md).
 *
 * Layout (top to bottom, always in this order in the DOM):
 *   1. Decorative background blobs (`.tckr-blob`, styles in global.css) — the
 *      "Frosted Glass Revamp" design import's blurred colour blobs, fixed behind
 *      every route so the glass panels have something to blur. Purely decorative
 *      markup (`aria-hidden`), no data.
 *   2. Header — the Tckr logo lockup (`TckrLogo`, links home), then two named slots
 *      `main.tsx` fills without editing this file: `badgeSlot` (`StreamBadge`, the
 *      LIVE/DELAYED entitlement) and `statusSlot` (`ConnectionStatus`). One row at
 *      every width. `ThemeToggle` (light/dark, `src/theme/useTheme.ts`) is rendered
 *      directly rather than through a slot: it needs no data-layer wiring, so it does
 *      not need main.tsx's composition-root treatment the way the data-driven slots do.
 *   3. `<Routes>` — rendered inside `.tckr-page`.
 *
 * This file does not import anything from `src/data/**` directly — see
 * `shell.no-data-import.test.ts`. It does render `StockList` (task 04) and
 * `StockDetail` (task 06), which own their own data-layer wiring.
 *
 * Route targets — nested, not sibling, routes (Frosted Glass Revamp split-pane
 * layout): `/` renders task 04's `StockList` as a persistent *layout* route, and
 * `/EGX/symbols/:symbol` is a *child* route rendered into `StockList`'s own `<Outlet />`
 * (via `StockDetailRoute`, which reads the `symbol` route param with `useParams` and
 * passes it straight through). Nesting them this way — rather than two sibling
 * `<Route>`s, which is what this file had before the revamp — means React Router
 * does not unmount/remount `StockList` when a symbol is opened or closed: the list's
 * search text, sort state, and subscriptions all survive, and only the detail pane
 * (behind `StockDetail`'s own lazy import, still code-split from `uplot`) slides in
 * or out beside it. `StockList` reads `useMatch(SYMBOL_ROUTE_PATTERN)` itself to know
 * whether a detail pane is open, for the split grid layout — see that file.
 *
 * ---------------------------------------------------------------------------------
 * "Frosted Glass Revamp" — the permanent simulated-data marker is gone
 * ---------------------------------------------------------------------------------
 * This file used to also render a permanent, non-dismissible `SimulatedBanner`
 * (task 03's FR-7.4 disclosure) above the header, and the header itself used to
 * show a "◆ SIMULATED TAPE" tag when `simulated` was true. Both are removed — a
 * deliberate product decision to match the design import exactly (it has neither),
 * not an oversight — along with `SimulatedBanner.tsx`, its tests
 * (`shell.banner-everywhere.test.tsx`, `shell.banner-delay-label.test.tsx`), and the
 * "header simulated-tape tag" tests in `shell.slots.test.tsx`. `git log` has all of
 * it verbatim if a future requirement needs it restored.
 */
import { lazy, Suspense, useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { TckrLogo } from './components/TckrLogo';
import { SkipLink } from './components/SkipLink';
import { TransitionScopeContext } from './components/transitionScope';
import { useViewTransitionNavigate } from './components/useViewTransitionNavigate';
import { ThemeToggle } from './components/ThemeToggle';
import { StockList } from './pages/StockList';
import { BOARD_ID } from './pages/pageAnchors';
import { LEGACY_SYMBOL_ROUTE_PATTERN, SYMBOL_ROUTE, symbolPath } from './pages/routes';

// Lazy-loaded so the chart library (`uplot`), only needed on the per-symbol
// detail page, is not fetched by users who only ever visit the list page at
// `/`. This keeps `StockDetail` (and everything it statically imports, i.e.
// `PriceChart`/`uplot`) in its own chunk, split out of the initial bundle.
//
// The chunk is still warmed once the browser is idle after first paint (see `App`),
// and once loaded the component is rendered directly rather than through `lazy`.
// Opening a symbol runs a view transition that snapshots the first commit after
// navigation; `lazy` suspends on its first render even when the chunk is already
// cached, so that commit would be the Suspense "Loading…" fallback instead of the
// detail pane. The chunk stays out of the initial bundle either way.
type StockDetailModule = typeof import('./pages/StockDetail');
let loadedStockDetail: StockDetailModule['StockDetail'] | null = null;
const loadStockDetail = () =>
  import('./pages/StockDetail').then((module) => {
    loadedStockDetail = module.StockDetail;
    return module;
  });
const LazyStockDetail = lazy(() => loadStockDetail().then((module) => ({ default: module.StockDetail })));

function usePrefetchStockDetail(): void {
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => void loadStockDetail());
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => void loadStockDetail(), 2000);
    return () => window.clearTimeout(id);
  }, []);
}

export interface AppHeaderProps {
  /** Rendered by task 07's `ConnectionStatus`. */
  statusSlot?: ReactNode | undefined;
  /** Rendered by `StreamBadge` (the LIVE/DELAYED entitlement pill). Placed before
   * `statusSlot`: which stream you are on matters more than socket uptime. */
  badgeSlot?: ReactNode | undefined;
}

function AppHeader({ statusSlot, badgeSlot }: AppHeaderProps) {
  const navigateWithTransition = useViewTransitionNavigate();
  // Going home from a symbol closes the split pane, so the logo uses the same view
  // transition as the list's own navigation. Only a plain left-click is intercepted;
  // modifier-clicks keep the link's normal new-tab/new-window behaviour.
  const handleLogoClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigateWithTransition('/');
  };

  return (
    <header
      className="sticky top-0 z-[5] flex items-center justify-between gap-3 w-full px-5 py-3.5 bg-glass backdrop-blur-tckr backdrop-saturate-[160%] border-b border-glass-border reduced-transparency:bg-surface contrast-more:bg-surface reduced-transparency:backdrop-blur-none contrast-more:backdrop-blur-none max-[640px]:px-4 max-[640px]:gap-2"
    >
      <Link
        to="/"
        onClick={handleLogoClick}
        aria-label="Tckr"
        className="flex items-center rounded-md no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent flex-none"
      >
        <TckrLogo size={24} />
      </Link>
      <div className="flex items-center gap-2.5 flex-wrap justify-end min-w-0 font-mono max-[640px]:gap-1.5">
        {badgeSlot}
        {statusSlot}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** `/symbols/COMI` (before routes were market-scoped) → `/EGX/symbols/COMI`. */
function LegacySymbolRedirect() {
  const { symbol } = useParams<{ symbol: string }>();
  return <Navigate to={symbol ? symbolPath(symbol) : '/'} replace />;
}

function StockDetailRoute() {
  const { symbol } = useParams<{ symbol: string }>();
  const StockDetail = loadedStockDetail ?? LazyStockDetail;
  return (
    <Suspense fallback={<p className="text-text-muted">Loading…</p>}>
      <StockDetail symbol={symbol ?? ''} />
    </Suspense>
  );
}

export interface AppProps {
  /** See `AppHeaderProps.statusSlot`. */
  statusSlot?: ReactNode | undefined;
  /** See `AppHeaderProps.badgeSlot`. */
  badgeSlot?: ReactNode | undefined;
}

export function App({ statusSlot, badgeSlot }: AppProps) {
  usePrefetchStockDetail();
  // Opening, switching and closing a symbol only changes what's inside <main>, so
  // those view transitions are scoped to it (see `transitionScope.ts`). The header
  // sits outside the scope: it stays live and on top, never snapshotted.
  const mainRef = useRef<HTMLElement | null>(null);
  return (
    <TransitionScopeContext.Provider value={mainRef}>
      {/* `overflow-x-clip`, not `-hidden`: both keep the off-canvas glow blobs from
          adding a horizontal scrollbar, but `hidden` also turns this div into a scroll
          container, which silently disables `position: sticky` for the header and the
          detail pane. */}
      <div className="relative flex flex-col min-h-full w-full max-w-[100vw] overflow-x-clip">
        <span
          className="fixed -z-1 rounded-full blur-[70px] pointer-events-none max-[640px]:hidden top-[-180px] right-[-80px] w-[720px] h-[560px] bg-[radial-gradient(circle_at_60%_40%,var(--tckr-blob-a),transparent_68%)]"
          aria-hidden="true"
        />
        <span
          className="fixed -z-1 rounded-full blur-[70px] pointer-events-none max-[640px]:hidden top-[90px] right-[280px] w-[480px] h-[440px] bg-[radial-gradient(circle_at_50%_50%,var(--tckr-blob-b),transparent_70%)]"
          aria-hidden="true"
        />
        <span
          className="fixed -z-1 rounded-full blur-[70px] pointer-events-none max-[640px]:hidden bottom-[-220px] left-[-140px] w-[720px] h-[600px] bg-[radial-gradient(circle_at_40%_60%,var(--tckr-blob-c),transparent_70%)]"
          aria-hidden="true"
        />
        {/* First in the Tab order, ahead of the logo: past the header, the banners, the
            highlight cards, the presets, the search box and seven sort headers. */}
        <SkipLink targetId={BOARD_ID}>Skip to instruments</SkipLink>
        <AppHeader statusSlot={statusSlot} badgeSlot={badgeSlot} />
        {/* `view-transition-scope: all` keeps the view-transition names inside <main>
            (list, detail, hero cards) local to it: its own scoped transitions use them,
            while a document-wide transition (the theme switch) captures <main> as part
            of the page instead of lifting those layers above the header. */}
        <main ref={mainRef} className="flex-1 w-full p-4 max-[640px]:p-3 [view-transition-scope:all]">
          <Routes>
            <Route path="/" element={<StockList />}>
              <Route path={SYMBOL_ROUTE} element={<StockDetailRoute />} />
            </Route>
            <Route path={LEGACY_SYMBOL_ROUTE_PATTERN} element={<LegacySymbolRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </TransitionScopeContext.Provider>
  );
}

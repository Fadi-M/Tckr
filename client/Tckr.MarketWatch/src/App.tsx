/**
 * The application frame — task 03 (docs/phase-3-web-client/03-app-shell.md).
 *
 * Layout (top to bottom, always in this order in the DOM):
 *   1. Decorative background blobs (`.tckr-blob`, styles in global.css) — the
 *      "Frosted Glass Revamp" design import's blurred colour blobs, fixed behind
 *      every route so the glass panels have something to blur. Purely decorative
 *      markup (`aria-hidden`), no data.
 *   2. Header — the Tckr logo lockup (`TckrLogo`, links home), plus a named
 *      `statusSlot` that task 07 renders `ConnectionStatus` into, without editing
 *      this file. `ThemeToggle` (light/dark, `src/theme/useTheme.ts`) is rendered directly rather than
 *      through a slot: it needs no data-layer wiring, so it does not need
 *      main.tsx's composition-root treatment the way the data-driven slot does.
 *   3. `<Routes>` — rendered inside `.tckr-page`.
 *
 * This file does not import anything from `src/data/**` directly — see
 * `shell.no-data-import.test.ts`. It does render `StockList` (task 04) and
 * `StockDetail` (task 06), which own their own data-layer wiring.
 *
 * Route targets — nested, not sibling, routes (Frosted Glass Revamp split-pane
 * layout): `/` renders task 04's `StockList` as a persistent *layout* route, and
 * `/symbols/:symbol` is a *child* route rendered into `StockList`'s own `<Outlet />`
 * (via `StockDetailRoute`, which reads the `symbol` route param with `useParams` and
 * passes it straight through). Nesting them this way — rather than two sibling
 * `<Route>`s, which is what this file had before the revamp — means React Router
 * does not unmount/remount `StockList` when a symbol is opened or closed: the list's
 * search text, sort state, and subscriptions all survive, and only the detail pane
 * (behind `StockDetail`'s own lazy import, still code-split from `uplot`) slides in
 * or out beside it. `StockList` reads `useMatch('/symbols/:symbol')` itself to know
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
import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { TckrLogo } from './components/TckrLogo';
import { ThemeToggle } from './components/ThemeToggle';
import { StockList } from './pages/StockList';

// Lazy-loaded so the chart library (`uplot`), only needed on the per-symbol
// detail page, is not fetched by users who only ever visit the list page at
// `/`. This keeps `StockDetail` (and everything it statically imports, i.e.
// `PriceChart`/`uplot`) in its own chunk, split out of the initial bundle.
const StockDetail = lazy(() =>
  import('./pages/StockDetail').then((module) => ({ default: module.StockDetail })),
);

export interface AppHeaderProps {
  /** Rendered by task 07's `ConnectionStatus`. */
  statusSlot?: ReactNode | undefined;
  /** Generic second header slot — no longer populated by `main.tsx` (`StreamBadge`,
   * the component that used to be its candidate occupant, has since been deleted as
   * dead code — see `main.tsx`'s doc comment), but the slot mechanism itself is
   * still exercised directly by `shell.slots.test.tsx` and stays available for
   * whatever a future header addition needs. */
  badgeSlot?: ReactNode | undefined;
}

function AppHeader({ statusSlot, badgeSlot }: AppHeaderProps) {
  return (
    <header
      className="sticky top-0 z-[5] flex items-center justify-between gap-3 w-full px-5 py-3.5 bg-glass backdrop-blur-tckr backdrop-saturate-[160%] border-b border-glass-border reduced-transparency:bg-surface contrast-more:bg-surface reduced-transparency:backdrop-blur-none contrast-more:backdrop-blur-none max-[640px]:flex-col max-[640px]:items-stretch"
    >
      <Link
        to="/"
        aria-label="Tckr"
        className="flex items-center rounded-md no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent max-[640px]:self-start"
      >
        <TckrLogo size={24} />
      </Link>
      <div className="flex items-center gap-3.5 flex-wrap justify-end font-mono max-[640px]:justify-start">
        {statusSlot}
        {badgeSlot}
        <ThemeToggle />
      </div>
    </header>
  );
}

function StockDetailRoute() {
  const { symbol } = useParams<{ symbol: string }>();
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
  return (
    <div className="relative flex flex-col min-h-full w-full max-w-[100vw] overflow-x-hidden">
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
      <AppHeader statusSlot={statusSlot} badgeSlot={badgeSlot} />
      <main className="flex-1 w-full p-4 max-[640px]:p-3">
        <Routes>
          <Route path="/" element={<StockList />}>
            <Route path="symbols/:symbol" element={<StockDetailRoute />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/**
 * The application frame — task 03 (docs/phase-3-web-client/03-app-shell.md).
 *
 * Layout (top to bottom, always in this order in the DOM):
 *   1. `SimulatedBanner` — permanent, present on every route.
 *   2. Header — brand, plus two named slots (`statusSlot`, `badgeSlot`) that
 *      task 07 renders `ConnectionStatus` / `StreamBadge` into, without editing
 *      this file. The "◆ SIMULATED TAPE" tag only renders when the `simulated`
 *      prop is true — this file must not decide that itself (see below), so the
 *      composition root passes it in already resolved.
 *   3. `<Routes>` — `/` and `/symbols/:symbol`, rendered inside `.tckr-page`.
 *
 * This file does not import anything from `src/data/**` directly — see
 * `shell.no-data-import.test.ts`. It does render `StockList` (task 04) and
 * `StockDetail` (task 06), which own their own data-layer wiring.
 *
 * Route targets: `/` renders task 04's `StockList` (no props); `/symbols/:symbol`
 * renders task 06's `StockDetail` via `StockDetailRoute`, which reads the `symbol`
 * route param with `useParams` and passes it straight through.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { SimulatedBanner } from './components/SimulatedBanner';
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
  /** Rendered by task 07's `StreamBadge`. */
  badgeSlot?: ReactNode | undefined;
  /**
   * Whether the active `MarketDataSource` is the simulator. This file must stay
   * data-source-agnostic (see the module doc comment / `shell.no-data-import.test.ts`),
   * so it cannot import `src/data/config.ts` to check `resolveClientConfig().source`
   * itself — the composition root (`main.tsx`) resolves that and passes the boolean
   * down, the same pattern `SimulatedBanner`'s `delayedOffsetMs` prop already uses.
   * Defaults to `false` (tag hidden) so a caller that forgets to pass it never falsely
   * claims a real gateway deployment is simulated.
   */
  simulated?: boolean | undefined;
}

function AppHeader({ statusSlot, badgeSlot, simulated }: AppHeaderProps) {
  return (
    <header className="tckr-header">
      <div className="tckr-header__brand">
        <span className="tckr-header__brand-mark" aria-hidden="true" />
        <span>Tckr</span>
      </div>
      <div className="tckr-header__slots">
        {simulated ? <span className="tckr-header__tape-tag">◆ SIMULATED TAPE</span> : null}
        {statusSlot}
        {badgeSlot}
      </div>
    </header>
  );
}

function StockDetailRoute() {
  const { symbol } = useParams<{ symbol: string }>();
  return (
    <Suspense fallback={<p className="tckr-detail__loading">Loading…</p>}>
      <StockDetail symbol={symbol ?? ''} />
    </Suspense>
  );
}

export interface AppProps {
  /** See `AppHeaderProps.statusSlot`. */
  statusSlot?: ReactNode | undefined;
  /** See `AppHeaderProps.badgeSlot`. */
  badgeSlot?: ReactNode | undefined;
  /** Forwarded to `SimulatedBanner` — see its doc comment. */
  delayedOffsetMs?: number | undefined;
  /** See `AppHeaderProps.simulated`. */
  simulated?: boolean | undefined;
}

export function App({ statusSlot, badgeSlot, delayedOffsetMs, simulated }: AppProps) {
  return (
    <div className="tckr-shell">
      <SimulatedBanner delayedOffsetMs={delayedOffsetMs} />
      <AppHeader statusSlot={statusSlot} badgeSlot={badgeSlot} simulated={simulated} />
      <main className="tckr-page">
        <Routes>
          <Route path="/" element={<StockList />} />
          <Route path="/symbols/:symbol" element={<StockDetailRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

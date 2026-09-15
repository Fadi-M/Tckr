/**
 * The application frame — task 03 (docs/phase-3-web-client/03-app-shell.md).
 *
 * Layout (top to bottom, always in this order in the DOM):
 *   1. `SimulatedBanner` — permanent, present on every route.
 *   2. Header — brand, plus two named slots (`statusSlot`, `badgeSlot`) that
 *      task 07 renders `ConnectionStatus` / `StreamBadge` into, without editing
 *      this file.
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
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { SimulatedBanner } from './components/SimulatedBanner';
import { StockList } from './pages/StockList';
import { StockDetail } from './pages/StockDetail';

export interface AppHeaderProps {
  /** Rendered by task 07's `ConnectionStatus`. */
  statusSlot?: ReactNode | undefined;
  /** Rendered by task 07's `StreamBadge`. */
  badgeSlot?: ReactNode | undefined;
}

function AppHeader({ statusSlot, badgeSlot }: AppHeaderProps) {
  return (
    <header className="tckr-header">
      <div className="tckr-header__brand">
        <span className="tckr-header__brand-mark" aria-hidden="true" />
        <span>Tckr</span>
      </div>
      <div className="tckr-header__slots">
        <span className="tckr-header__tape-tag">◆ SIMULATED TAPE</span>
        {statusSlot}
        {badgeSlot}
      </div>
    </header>
  );
}

function StockDetailRoute() {
  const { symbol } = useParams<{ symbol: string }>();
  return <StockDetail symbol={symbol ?? ''} />;
}

export interface AppProps {
  /** See `AppHeaderProps.statusSlot`. */
  statusSlot?: ReactNode | undefined;
  /** See `AppHeaderProps.badgeSlot`. */
  badgeSlot?: ReactNode | undefined;
  /** Forwarded to `SimulatedBanner` — see its doc comment. */
  delayedOffsetMs?: number | undefined;
}

export function App({ statusSlot, badgeSlot, delayedOffsetMs }: AppProps) {
  return (
    <div className="tckr-shell">
      <SimulatedBanner delayedOffsetMs={delayedOffsetMs} />
      <AppHeader statusSlot={statusSlot} badgeSlot={badgeSlot} />
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

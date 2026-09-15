/**
 * Application entry point — task 03 (docs/phase-3-web-client/03-app-shell.md).
 * Replaces task 01's placeholder in full.
 *
 * This is the composition root, not the shell itself: `App.tsx` and
 * `SimulatedBanner.tsx` stay source-agnostic (no `src/data/**` import — see
 * `shell.no-data-import.test.ts`, which covers those two files), but this file is
 * where the real header content and the real simulated-offset value are wired in,
 * since that requires naming task 02's config and task 07's components. This is the
 * one place in this task's ownership that intentionally imports `src/data/**`.
 *
 * `ConnectionStatus`/`StreamBadge` take no props — they read the shared
 * `MarketDataSource` singleton themselves — so they are simply instantiated as the
 * two header slots. `delayedOffsetMs` comes from `resolveClientConfig()`, the same
 * config task 02's `SimulatedSource` is built from, so the banner's label always
 * matches whatever offset the simulator is actually using.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ConnectionStatus } from './components/ConnectionStatus';
import { StreamBadge } from './components/StreamBadge';
import { resolveClientConfig } from './data/config';
import './styles/tokens.css';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <App
          statusSlot={<ConnectionStatus />}
          badgeSlot={<StreamBadge />}
          delayedOffsetMs={resolveClientConfig().simulated.delayedOffsetMs}
        />
      </BrowserRouter>
    </StrictMode>,
  );
}

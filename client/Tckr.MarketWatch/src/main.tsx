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
 *
 * `simulated` (the header's "◆ SIMULATED TAPE" tag) is likewise derived from
 * `resolveClientConfig().source === 'simulated'` — the same resolved config value
 * `createMarketDataSource()` itself branches on to decide which concrete
 * `MarketDataSource` to build. That keeps a single source of truth: the header tag
 * can never disagree with which source is actually wired up, and a real gateway
 * deployment (`VITE_TCKR_SOURCE=gateway`) no longer falsely labels its tape as
 * simulated.
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
  // `resolveClientConfig()` throws synchronously if a genuine production build would
  // silently fall back to the simulated data source (see that function's module doc —
  // this guard is intentional and must not be removed/weakened here). Left uncaught,
  // that throw happens before `createRoot(...).render(...)` ever runs, so the page ends
  // up blank with nothing but an uncaught exception in the console — no on-page signal
  // that anything is wrong at all. This try/catch exists solely to turn that specific
  // bootstrap failure into a visible, on-page message instead of a blank page; it is
  // deliberately narrow (just this synchronous config/source-resolution step, not a
  // general app-wide error boundary for render-time errors) and it still rethrows after
  // rendering the message, so the failure continues to surface to the console/any error
  // tracking exactly as before.
  try {
    const config = resolveClientConfig();
    createRoot(rootElement).render(
      <StrictMode>
        <BrowserRouter>
          <App
            statusSlot={<ConnectionStatus />}
            badgeSlot={<StreamBadge />}
            delayedOffsetMs={config.simulated.delayedOffsetMs}
            simulated={config.source === 'simulated'}
          />
        </BrowserRouter>
      </StrictMode>,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'font-family: monospace; white-space: pre-wrap; padding: 24px; max-width: 640px; ' +
      'margin: 48px auto; border: 1px solid #c0392b; border-radius: 4px; color: #c0392b; ' +
      'background: #fff5f5;';
    const heading = document.createElement('strong');
    heading.textContent = 'Configuration error';
    const body = document.createElement('div');
    body.style.marginTop = '12px';
    body.textContent = message;
    wrapper.append(heading, body);
    rootElement.replaceChildren(wrapper);
    throw err;
  }
}

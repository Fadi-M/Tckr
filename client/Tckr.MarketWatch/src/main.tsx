/**
 * Application entry point — task 03 (docs/phase-3-web-client/03-app-shell.md).
 * Replaces task 01's placeholder in full.
 *
 * This is the composition root, not the shell itself: `App.tsx` stays source-agnostic
 * (no `src/data/**` import — see `shell.no-data-import.test.ts`), but this file is
 * where the real header content is wired in, since that requires naming task 02's
 * config and task 07's components. This is the one place in this task's ownership
 * that intentionally imports `src/data/**`.
 *
 * `ConnectionStatus` takes no props — it reads the shared `MarketDataSource`
 * singleton itself — so it is simply instantiated as the header's `statusSlot`.
 *
 * `badgeSlot` carries `StreamBadge`, the always-visible LIVE/DELAYED entitlement pill.
 * Like `ConnectionStatus` it takes no props and reads `identity()` from the shared
 * singleton itself. It was briefly deleted as dead code when nothing mounted it; it is
 * back because PRODUCT.md requires the live/delayed distinction to be visible on every
 * screen, not only on the detail view's per-symbol note (the 2026-09-26 critique's P0).
 *
 * ---------------------------------------------------------------------------------
 * "Frosted Glass Revamp" — the permanent simulated-data marker is gone
 * ---------------------------------------------------------------------------------
 * The header's "◆ SIMULATED TAPE" tag and the permanent top `SimulatedBanner` (task
 * 03's FR-7.4 non-dismissible disclosure) have both been removed, along with
 * `SimulatedBanner.tsx` itself and its dedicated tests
 * (`shell.banner-everywhere.test.tsx`, `shell.banner-delay-label.test.tsx`, and the
 * "header simulated-tape tag" describe block in `shell.slots.test.tsx`) — a
 * deliberate product decision to match the design import exactly, not an oversight.
 * The design has no such marker anywhere. If a future requirement needs it back,
 * `git log` has the removed component/tests to restore verbatim.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ConnectionStatus } from './components/ConnectionStatus';
import { StreamBadge } from './components/StreamBadge';
import { resolveClientConfig } from './data/config';
import './styles/tailwind.css';

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
  // tracking exactly as before. The resolved config's fields are no longer otherwise
  // needed here (see "the permanent simulated-data marker is gone" above), so the
  // return value is intentionally discarded — only the validating side effect matters.
  try {
    resolveClientConfig();
    createRoot(rootElement).render(
      <StrictMode>
        <BrowserRouter>
          <App statusSlot={<ConnectionStatus />} badgeSlot={<StreamBadge />} />
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

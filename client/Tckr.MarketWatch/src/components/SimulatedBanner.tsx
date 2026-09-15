/**
 * The permanent "this is not real market data" marker (FR-7.4,
 * client-contract.md §5). Rendered by `App` outside `<Outlet />` so it is present
 * on every route, and it is never dismissible: no close button, no
 * `localStorage` "don't show again" — see 03-app-shell.md.
 *
 * `role="status"`, not `role="alert"`: this is permanent context, not an
 * interruption, and must not steal focus or interrupt a screen reader.
 *
 * This component does not import `src/data/**` (task 02's seam). The
 * simulated DELAYED offset, when the active data source fakes one, is passed
 * in as a plain prop by whatever composes `<App />`.
 */

export interface SimulatedBannerProps {
  /**
   * Milliseconds the active source holds a DELAYED tick back by, when it is
   * simulating the delayed stream. `client-contract.md` §5 is explicit that a
   * real 15-minute delay cannot be demonstrated in a browser session, so the
   * simulated source fakes it with a short offset (default 15s) — this prop
   * exists so that offset is *always* labelled as a simulation artifact
   * wherever it is shown, never presented as the real 15-minute delay.
   */
  delayedOffsetMs?: number | undefined;
}

function formatOffset(ms: number): string {
  if (ms > 0 && ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

export function SimulatedBanner({ delayedOffsetMs }: SimulatedBannerProps) {
  return (
    <div className="tckr-banner" role="status">
      <span className="tckr-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <span className="tckr-banner__text">
        Simulated market data — these are fictional instruments, not real EGX prices.
        {typeof delayedOffsetMs === 'number' ? (
          <>
            {' '}
            DELAYED stream simulated with a {formatOffset(delayedOffsetMs)} offset; the
            real delay is 15 minutes.
          </>
        ) : null}
      </span>
    </div>
  );
}

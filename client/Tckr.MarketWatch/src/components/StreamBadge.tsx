/**
 * StreamBadge — task 07 (docs/phase-3-web-client/07-connection-lifecycle.md).
 *
 * The one place the UI asserts "this data is live". `identity()` — populated only from
 * the server's `connected` message, and updated only by a genuine `entitlementChanged`
 * — is the *only* input. There is no prop, no client-side default, no toggle: this
 * component takes no arguments at all (`StreamBadge()`, zero parameters), so there is
 * nothing for a caller to pass that could set the stream from the client side. See
 * `badge.no-client-source.test.tsx`, which asserts this both at the type level
 * (`@ts-expect-error` on any prop) and at runtime (renders nothing while `identity()`
 * is `null` — never `LIVE` as a loading default).
 *
 * Mounted into `App`'s `badgeSlot` (task 03) — see this task's report for the exact
 * `main.tsx` wiring lines.
 *
 * ---------------------------------------------------------------------------------
 * The entitlement-change discard — now guaranteed by the data layer, not this badge
 * ---------------------------------------------------------------------------------
 * client-contract.md §3.3: on `entitlementChanged` the client must discard any
 * buffered ticks from the old stream before any new-stream tick renders — mixing LIVE
 * and DELAYED data in one view is the failure the whole system exists to prevent.
 * `store.ts` owns the mechanism end to end (`resetStream()` clears every symbol's live
 * view back to "no tick yet", re-anchors each baseline on the pristine static
 * `referencePrice`, and — as its last step — fans the discard out to every listener
 * registered via `store.onStreamDiscard`, e.g. the chart clearing its ring buffer).
 *
 * This component used to be the one thing that *called* `resetStream()`, on its own
 * `source.on.entitlement` handler — which meant the entire mixed-stream guarantee only
 * held because `StreamBadge` happened to be mounted in the app shell. That call has
 * moved into the data layer itself: `SimulatedSource.simulateEntitlementChange` and
 * `TckrGatewaySource`'s own entitlement handling both call `resetStream()` directly, on
 * every real stream transition, independent of any UI. See
 * `src/data/__tests__/simulated.entitlement-discard.test.ts` and
 * `src/data/__tests__/gateway.entitlement-discard.test.ts`, which prove this with no
 * `StreamBadge` (or any component) mounted at all.
 *
 * `StreamBadge` is back to being purely decorative/informational, as its name implies:
 * on `entitlementChanged` it only re-reads `identity()` to flip which label it renders.
 * It does not need to, and no longer does, discard anything itself.
 */
import { useEffect, useState } from 'react';
import { getSharedSource, resolveClientConfig } from '../data/config.ts';
import type { Identity } from '../data/MarketDataSource.ts';

function formatOffset(ms: number): string {
  if (ms > 0 && ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

export function StreamBadge() {
  const [identity, setIdentity] = useState<Identity | null>(() => getSharedSource().identity());

  useEffect(() => {
    const source = getSharedSource();
    // `connected` (via on.status) is what first populates identity(); re-read it on
    // every status transition so a late `connected` (e.g. a real gateway's asynchronous
    // handshake) is picked up even though the initial render may have seen `null`.
    const unsubStatus = source.on.status(() => {
      setIdentity(source.identity());
    });
    const unsubEntitlement = source.on.entitlement(() => {
      // The data layer (SimulatedSource / TckrGatewaySource) has already called
      // resetStream() before this handler ever runs — this component just re-renders
      // to whatever the new identity() says.
      setIdentity(source.identity());
    });
    return () => {
      unsubStatus();
      unsubEntitlement();
    };
  }, []);

  if (identity === null) {
    return null;
  }

  if (identity.stream === 'LIVE') {
    return (
      <span className="tckr-badge tckr-badge--live" data-testid="stream-badge">
        ● LIVE
      </span>
    );
  }

  const offsetMs = resolveClientConfig().simulated.delayedOffsetMs;
  return (
    <span className="tckr-badge tckr-badge--delayed" data-testid="stream-badge">
      ● DELAYED — {formatOffset(offsetMs)} simulated delay (real delay is 15 min)
    </span>
  );
}

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
 * The entitlement-change discard
 * ---------------------------------------------------------------------------------
 * client-contract.md §3.3: on `entitlementChanged` the client must discard any
 * buffered ticks from the old stream before any new-stream tick renders — mixing LIVE
 * and DELAYED data in one view is the failure the whole system exists to prevent.
 * `store.ts` now owns this end to end: `resetStream()` clears every symbol's live view
 * back to "no tick yet", re-anchors each baseline on the pristine static
 * `referencePrice`, and — as its last step, strictly after all of that — fans the
 * discard out to every listener registered via `store.onStreamDiscard` (task 05's chart
 * clears its ring buffer through that same hook). This file therefore does the minimum
 * on `entitlementChanged`: call `resetStream()`, then re-render to the new stream. The
 * "old stream visible from inside a discard listener, new stream only after" ordering
 * is now guaranteed by the store, not by this component's call sequence — proved by
 * `badge.entitlement-change.test.tsx`, which registers a `store.onStreamDiscard`
 * listener and reads both the store and the live badge DOM from inside it.
 */
import { useEffect, useState } from 'react';
import { getSharedSource, resolveClientConfig } from '../data/config.ts';
import type { Identity } from '../data/MarketDataSource.ts';
import { resetStream } from '../data/store.ts';

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
      resetStream(); // clears + re-anchors state and fans the discard out itself
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

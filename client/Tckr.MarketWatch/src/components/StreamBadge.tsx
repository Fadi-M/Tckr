/**
 * StreamBadge — the header's always-visible LIVE / DELAYED entitlement indicator.
 *
 * PRODUCT.md makes the live/delayed distinction a security property that must be
 * always visible and server-sourced. `identity()` — populated only from the server's
 * `connected` message and changed only by a genuine `entitlementChanged` — is this
 * component's *only* input: no props, no client-side default. While `identity()` is
 * still `null` it renders nothing rather than guessing LIVE.
 *
 * Mounted into `App`'s `badgeSlot` by `main.tsx`, ahead of `ConnectionStatus`: which
 * stream you are on matters more than how long the socket has been up.
 *
 * (An earlier `StreamBadge` was deleted as dead code once nothing mounted it; this is
 * its replacement, restyled for the frosted-glass header. The mixed-stream discard it
 * once triggered now lives in the data layer — see `store.resetStream()`.)
 */
import { useEffect, useState } from 'react';
import { getSharedSource } from '../data/config.ts';
import type { Identity } from '../data/MarketDataSource.ts';
import { ClockIcon } from './icons.tsx';
import { streamDelay } from './streamDelay.ts';
import { useMarketStatus } from './useMarketStatus.ts';

const PILL_BASE =
  'inline-flex items-center gap-1.5 font-mono text-label font-semibold tracking-[0.08em] px-[11px] py-[7px] rounded-full border whitespace-nowrap max-[640px]:px-2 max-[640px]:tracking-[0.03em]';
const CHANGED_CLASS = 'animate-stream-change motion-reduce:animate-none';

export function StreamBadge() {
  const [identity, setIdentity] = useState<Identity | null>(() => getSharedSource().identity());
  // Counts real entitlement changes since mount. Keying the pill on it remounts the
  // element on each change, which replays the one-shot ring pulse; zero (first paint)
  // gets no pulse.
  const [changeCount, setChangeCount] = useState(0);
  const marketStatus = useMarketStatus();

  useEffect(() => {
    const source = getSharedSource();
    // `connected` (via on.status) is what first populates identity(); re-read it on
    // every status transition so a late handshake is picked up, and on every
    // entitlement change so the badge flips with the stream.
    const unsubStatus = source.on.status(() => setIdentity(source.identity()));
    const unsubEntitlement = source.on.entitlement(() => {
      setIdentity(source.identity());
      setChangeCount((count) => count + 1);
    });
    return () => {
      unsubStatus();
      unsubEntitlement();
    };
  }, []);

  if (identity === null) {
    return null;
  }

  // The wrapper is the live region: it persists across stream changes (only the pill
  // inside is re-keyed), so a screen reader hears the new stream when it flips.
  if (identity.stream === 'LIVE') {
    // The entitlement is still LIVE while EGX is closed, and the word stays. Only the
    // green tint and dot step down, as the connection pill's do: a green dot reads as
    // "trades are moving", which on a closed market is not true.
    const idle = marketStatus.state !== 'open';
    return (
      <span role="status" className="inline-flex">
        <span
          key={changeCount}
          className={`${PILL_BASE} ${changeCount > 0 ? CHANGED_CLASS : ''} ${
            idle
              ? 'text-text-muted bg-glass border-glass-border'
              : 'text-chip-up bg-[color-mix(in_oklab,var(--tckr-color-up)_16%,var(--tckr-glass-bg))] border-[color-mix(in_oklab,var(--tckr-color-up)_32%,transparent)]'
          }`}
          data-testid="stream-badge"
          data-stream="LIVE"
          data-idle={idle || undefined}
          title={
            idle
              ? 'Live stream: prices arrive as they trade. EGX is not trading right now, so nothing is moving.'
              : 'Live stream: prices arrive as they trade'
          }
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${idle ? 'bg-text-muted' : 'bg-up'}`} aria-hidden="true" />
          LIVE
        </span>
      </span>
    );
  }

  const delay = streamDelay();
  const behind = delay.simulated
    ? `Delayed stream: prices are ${delay.short} behind the exchange (simulated; a real delayed entitlement is 15 min)`
    : `Delayed stream: prices are ${delay.short} behind the exchange`;
  return (
    <span role="status" className="inline-flex">
      <span
        key={changeCount}
        className={`${PILL_BASE} ${changeCount > 0 ? CHANGED_CLASS : ''} text-warning bg-[color-mix(in_oklab,var(--tckr-color-warning)_16%,var(--tckr-glass-bg))] border-[color-mix(in_oklab,var(--tckr-color-warning)_32%,transparent)]`}
        data-testid="stream-badge"
        data-stream="DELAYED"
        title={behind}
      >
        <ClockIcon size={12} />
        <span aria-hidden="true">
          {/* The duration stays on phones (it is the fact that matters); only the
              separator goes, so the header still fits on one row at 390px. */}
          DELAYED<span className="max-[640px]:hidden"> ·</span> {delay.short}
        </span>
        <span className="sr-only">{behind}</span>
      </span>
    </span>
  );
}

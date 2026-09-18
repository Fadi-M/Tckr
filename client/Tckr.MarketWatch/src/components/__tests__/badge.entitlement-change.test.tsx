/**
 * `StreamBadge`'s own responsibility on `entitlementChanged`: nothing more than
 * re-reading `identity()` and flipping which label it renders. It used to also call
 * `store.resetStream()` from this same handler — that call has moved into the data
 * layer (`SimulatedSource.simulateEntitlementChange` / `TckrGatewaySource`'s own
 * entitlement handling), so this badge no longer discards anything itself and this
 * suite no longer asserts anything about `resetStream`/`onStreamDiscard` ordering.
 * That regression coverage now lives in `src/data/__tests__/
 * simulated.entitlement-discard.test.ts` and `src/data/__tests__/
 * gateway.entitlement-discard.test.ts`, which prove the discard fires from the source
 * implementations directly, with no `StreamBadge` (or any UI) mounted at all.
 *
 * `FakeSource` here (see `testSupport.ts`) is a plain `MarketDataSource` stub — it does
 * not call `resetStream()` on `emitEntitlement`, exactly as a real source's caller-side
 * contract now requires (the badge must not depend on it doing so).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createFakeSource, fakeIdentity } from './testSupport.ts';
import type { EntitlementChanged, IsoUtc } from '../../contracts/messages.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource } from '../../data/config.ts';
import { StreamBadge } from '../StreamBadge.tsx';
import { resetStore } from '../../data/store.ts';

afterEach(() => {
  cleanup();
  resetStore();
});

function entitlementChanged(stream: 'LIVE' | 'DELAYED'): EntitlementChanged {
  return {
    v: 1,
    type: 'entitlementChanged',
    stream,
    resubscribeRequired: true,
    effectiveFrom: '2026-09-12T10:35:00.000Z' as IsoUtc,
  };
}

describe('StreamBadge — entitlement change render', () => {
  it('flips LIVE -> DELAYED on entitlementChanged', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');

    source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
    act(() => {
      source.emitEntitlement(entitlementChanged('DELAYED'));
    });

    expect(screen.getByTestId('stream-badge').textContent).toContain('DELAYED');
  });

  it('flips DELAYED -> LIVE on entitlementChanged', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'DELAYED' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').textContent).toContain('DELAYED');

    source.setIdentity(fakeIdentity({ stream: 'LIVE' }));
    act(() => {
      source.emitEntitlement(entitlementChanged('LIVE'));
    });

    expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');
    expect(screen.getByTestId('stream-badge').textContent).not.toContain('DELAYED');
  });

  it('re-renders on every entitlementChanged even when the resolved stream is unchanged', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');

    act(() => {
      source.emitEntitlement(entitlementChanged('LIVE'));
    });

    expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');
  });
});

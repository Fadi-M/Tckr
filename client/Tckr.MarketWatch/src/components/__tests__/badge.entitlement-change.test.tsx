import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createFakeSource, fakeIdentity } from './testSupport.ts';
import type { EntitlementChanged, IsoUtc, Tick } from '../../contracts/messages.ts';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Snapshot } from '../../contracts/rest.ts';

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
import {
  applySnapshot,
  applyTick,
  getSymbolSnapshot,
  onStreamDiscard,
  primeUniverse,
  resetStore,
} from '../../data/store.ts';

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

function snapshotFixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    symbol: 'COMI',
    stream: 'LIVE',
    price: toDecimal('91.00'),
    change: toDecimal('5.90'),
    changePercent: '+6.93',
    // Deliberately different from the symbol's static referencePrice (85.10) below, so
    // a baseline still anchored on this snapshot's `open` (rather than reset to
    // referencePrice) is distinguishable from one that has been.
    open: toDecimal('90.00'),
    high: toDecimal('91.50'),
    low: toDecimal('89.80'),
    volume: 1000,
    lastEventId: 'evt-000000000001',
    exchangeTimestamp: '2026-09-12T10:00:00.000Z' as IsoUtc,
    snapshotAge: 0,
    simulated: true,
    ...overrides,
  };
}

function tickFixture(overrides: Partial<Tick> = {}): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal('86.00'),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:36:00.000Z' as IsoUtc,
    id: 'evt-000000000002',
    st: 'DELAYED',
    ...overrides,
  };
}

describe('StreamBadge — entitlement change discard ordering', () => {
  it('flips LIVE -> DELAYED on entitlementChanged, after running discard listeners first', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');

    const order: string[] = [];
    const unregister = onStreamDiscard(() => {
      // Captured *while the discard listener runs* — must still show the old stream:
      // the badge has not yet re-rendered to DELAYED at this point.
      order.push(`discard-sees:${screen.getByTestId('stream-badge').textContent}`);
    });

    try {
      // The fake source's identity() must reflect the new stream by the time the
      // entitlementChanged handler re-reads it, exactly as SimulatedSource does.
      source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
      act(() => {
        source.emitEntitlement(entitlementChanged('DELAYED'));
      });
      order.push(`after:${screen.getByTestId('stream-badge').textContent}`);

      expect(order).toHaveLength(2);
      expect(order[0]).toMatch(/^discard-sees:.*LIVE/);
      expect(order[0]).not.toMatch(/DELAYED/);
      expect(order[1]).toMatch(/^after:.*DELAYED/);
    } finally {
      unregister();
    }
  });

  it('discards from DELAYED -> LIVE as well, and multiple listeners all run before the flip', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'DELAYED' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').textContent).toContain('DELAYED');

    const calls: string[] = [];
    const unregisterA = onStreamDiscard(() => calls.push('a'));
    const unregisterB = onStreamDiscard(() => calls.push('b'));

    try {
      source.setIdentity(fakeIdentity({ stream: 'LIVE' }));
      act(() => {
        source.emitEntitlement(entitlementChanged('LIVE'));
      });

      expect(calls).toEqual(['a', 'b']);
      expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');
      expect(screen.getByTestId('stream-badge').textContent).not.toContain('DELAYED');
    } finally {
      unregisterA();
      unregisterB();
    }
  });

  it('an unregistered listener is not called on a later entitlement change', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    vi.mocked(getSharedSource).mockReturnValue(source);
    render(<StreamBadge />);

    const spy = vi.fn();
    const unregister = onStreamDiscard(spy);
    unregister();

    source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
    act(() => {
      source.emitEntitlement(entitlementChanged('DELAYED'));
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("clears the store's per-symbol view before the first new-stream tick can render, and re-anchors the baseline to the pristine referencePrice", () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applySnapshot(snapshotFixture());
    expect(getSymbolSnapshot('COMI')?.stream).toBe('LIVE');
    expect(getSymbolSnapshot('COMI')?.price).toBe(toDecimal('91.00'));

    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    vi.mocked(getSharedSource).mockReturnValue(source);
    render(<StreamBadge />);

    const order: string[] = [];
    const unregister = onStreamDiscard(() => {
      // Read from inside the discard listener: `store.resetStream()` fans this signal
      // out only as its last step, strictly after clearing COMI's view — so it must
      // already be gone by this point.
      order.push(`discard-sees:${JSON.stringify(getSymbolSnapshot('COMI'))}`);
    });

    try {
      source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
      act(() => {
        source.emitEntitlement(entitlementChanged('DELAYED'));
      });

      expect(order).toEqual(['discard-sees:undefined']);
      expect(getSymbolSnapshot('COMI')).toBeUndefined();

      // The "first new-stream tick" arrives only now, strictly after the discard.
      applyTick(tickFixture());
      const view = getSymbolSnapshot('COMI');
      expect(view?.stream).toBe('DELAYED');
      expect(view?.price).toBe(toDecimal('86.00'));
      // 86.00 - 85.10 (referencePrice) = 0.90. Had the stale LIVE snapshot's open
      // (90.00) survived the discard, this would instead be -4.00.
      expect(view?.change).toBe(toDecimal('0.90'));
    } finally {
      unregister();
    }
  });
});

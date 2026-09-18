/**
 * Regression coverage for the bug this task fixes: client-contract.md §3.3's
 * LIVE/DELAYED discard ("the client must discard any buffered ticks from the old
 * stream rather than mixing the two on one chart") must hold at the data layer,
 * independent of which UI components happen to be mounted. Before this fix,
 * `resetStream()` was only ever called from `StreamBadge`'s own `on.entitlement`
 * handler — remove that component and the guarantee silently disappeared.
 *
 * This suite renders nothing and mounts no component at all: it drives
 * `SimulatedSource.simulateEntitlementChange` directly and asserts the store itself
 * gets cleared, proving the discard is the source's own responsibility now.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Stream, Tick } from '../../contracts/messages.ts';
import { SimulatedSource } from '../SimulatedSource.ts';
import { getSymbolSnapshot, onStreamDiscard, primeUniverse, applyTick, resetStore } from '../store.ts';
import { baseConfig } from './testSupport.ts';

function tick(symbol: string, price: string, id: string, stream: Stream = 'LIVE'): Tick {
  return {
    v: 1,
    type: 'tick',
    s: symbol,
    p: toDecimal(price),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id,
    st: stream,
  };
}

describe('SimulatedSource — entitlement-change discard', () => {
  beforeEach(() => {
    resetStore();
  });

  it('calls resetStream() when simulateEntitlementChange actually flips the resolved stream', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));
    expect(getSymbolSnapshot('COMI')).toBeDefined();

    const discardListener = vi.fn();
    const unregister = onStreamDiscard(discardListener);

    const source = new SimulatedSource(baseConfig({ demoUser: 'user-001' })); // LIVE
    await source.connect();

    try {
      // user-002 resolves to DELAYED (see SimulatedSource's resolveStream) — a real
      // transition, so the discard must fire.
      source.simulateEntitlementChange('user-002');

      expect(discardListener).toHaveBeenCalledTimes(1);
      expect(getSymbolSnapshot('COMI')).toBeUndefined();
    } finally {
      unregister();
      source.disconnect();
    }
  });

  it('discards before notifying entitlementHandlers, so a synchronous listener already sees cleared state', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));

    const source = new SimulatedSource(baseConfig({ demoUser: 'user-001' }));
    await source.connect();

    let sawDuringEntitlementHandler: ReturnType<typeof getSymbolSnapshot>;
    source.on.entitlement(() => {
      sawDuringEntitlementHandler = getSymbolSnapshot('COMI');
    });

    source.simulateEntitlementChange('user-002');

    expect(sawDuringEntitlementHandler).toBeUndefined();
    source.disconnect();
  });

  it('does not call resetStream() when the resolved stream does not actually change', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));

    const discardListener = vi.fn();
    const unregister = onStreamDiscard(discardListener);

    // user-001 and any user other than user-002 both resolve to LIVE — no real
    // transition, so entitlementChanged never fires (existing behavior) and neither
    // should resetStream().
    const source = new SimulatedSource(baseConfig({ demoUser: 'user-001' }));
    await source.connect();

    try {
      source.simulateEntitlementChange('user-003'); // still resolves to LIVE

      expect(discardListener).not.toHaveBeenCalled();
      expect(getSymbolSnapshot('COMI')).toBeDefined();
    } finally {
      unregister();
      source.disconnect();
    }
  });

  it('re-anchors the baseline to the pristine referencePrice, discarding the old stream tick', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));

    const source = new SimulatedSource(baseConfig({ demoUser: 'user-001' }));
    await source.connect();
    source.simulateEntitlementChange('user-002');

    applyTick(tick('COMI', '86.00', 'evt-2', 'DELAYED'));
    const view = getSymbolSnapshot('COMI');
    expect(view?.stream).toBe('DELAYED');
    // 86.00 - 85.10 (referencePrice), not 86.00 - 90.00 (the discarded stream's open).
    expect(view?.change).toBe(toDecimal('0.90'));

    source.disconnect();
  });
});

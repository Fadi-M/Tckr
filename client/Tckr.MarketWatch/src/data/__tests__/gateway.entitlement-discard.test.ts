/**
 * Regression coverage for the bug this task fixes (see
 * `simulated.entitlement-discard.test.ts` for the full background): client-contract.md
 * §3.3's LIVE/DELAYED discard must hold at the data layer, independent of which UI
 * components happen to be mounted. This suite drives `TckrGatewaySource`'s own
 * `entitlementChanged` handling directly, through the same `FakeWebSocket` harness the
 * rest of the conformance suite uses, and mounts no component at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Stream, Tick } from '../../contracts/messages.ts';
import { FIXTURES } from '../../contracts/fixtures/index.ts';
import { getSymbolSnapshot, onStreamDiscard, primeUniverse, applyTick, resetStore } from '../store.ts';
import { connectAndAuthenticate, createHarness } from './conformance/gatewayHarness.ts';

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

describe('TckrGatewaySource — entitlement-change discard', () => {
  beforeEach(() => {
    resetStore();
  });

  it('calls resetStream() when an entitlementChanged frame actually flips the stream', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));
    expect(getSymbolSnapshot('COMI')).toBeDefined();

    const discardListener = vi.fn();
    const unregister = onStreamDiscard(discardListener);

    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness, FIXTURES['connected-live']);
    expect(harness.source.identity()?.stream).toBe('LIVE');

    try {
      socket.emit(FIXTURES['entitlement-downgraded']); // -> DELAYED, a real transition

      expect(discardListener).toHaveBeenCalledTimes(1);
      expect(getSymbolSnapshot('COMI')).toBeUndefined();
      expect(harness.source.identity()?.stream).toBe('DELAYED');
    } finally {
      unregister();
    }
  });

  it('discards before notifying entitlement subscribers, so a synchronous listener already sees cleared state', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));

    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness, FIXTURES['connected-live']);

    let sawDuringEntitlementHandler: ReturnType<typeof getSymbolSnapshot>;
    harness.source.on.entitlement(() => {
      sawDuringEntitlementHandler = getSymbolSnapshot('COMI');
    });

    socket.emit(FIXTURES['entitlement-downgraded']);

    expect(sawDuringEntitlementHandler).toBeUndefined();
  });

  it('does not call resetStream() for a redundant entitlementChanged that restates the same stream', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));

    const discardListener = vi.fn();
    const unregister = onStreamDiscard(discardListener);

    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness, FIXTURES['connected-live']); // LIVE

    try {
      // `entitlement-upgraded`'s own stream is "LIVE" — restating the stream the
      // connection is already on, i.e. no actual transition.
      expect(FIXTURES['entitlement-upgraded']).toMatchObject({ stream: 'LIVE' });
      socket.emit(FIXTURES['entitlement-upgraded']);

      expect(discardListener).not.toHaveBeenCalled();
      expect(getSymbolSnapshot('COMI')).toBeDefined();
    } finally {
      unregister();
    }
  });

  it('re-anchors the baseline to the pristine referencePrice, discarding the old stream tick', async () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));

    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness, FIXTURES['connected-live']);
    socket.emit(FIXTURES['entitlement-downgraded']);

    applyTick(tick('COMI', '86.00', 'evt-2', 'DELAYED'));
    const view = getSymbolSnapshot('COMI');
    expect(view?.stream).toBe('DELAYED');
    // 86.00 - 85.10 (referencePrice), not 86.00 - 90.00 (the discarded stream's open).
    expect(view?.change).toBe(toDecimal('0.90'));
  });
});

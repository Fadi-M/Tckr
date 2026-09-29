/**
 * client-contract.md §3.3: on a LIVE↔DELAYED switch the client discards the old stream's
 * buffered data rather than mixing the two. Both sources own this at the data layer,
 * whatever components are mounted: the store is cleared before any entitlement
 * listener runs, and a switch that restates the current stream discards nothing.
 * (What the store looks like after a discard is `store.reset-stream.test.ts`'s concern.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import type { MarketDataSource } from '../../MarketDataSource.ts';
import { SimulatedSource } from '../../SimulatedSource.ts';
import { applyTick, getSymbolSnapshot, onStreamDiscard, resetStore } from '../../store.ts';
import { baseConfig, primeSymbols, tick } from '../testSupport.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

interface Rig {
  readonly source: MarketDataSource;
  /** A switch to the other stream (LIVE → DELAYED). */
  flip(): void;
  /** An entitlement change that resolves to the stream already in force. */
  restate(): void;
}

async function simulatedRig(): Promise<Rig> {
  const source = new SimulatedSource(baseConfig({ demoUser: 'user-001' })); // LIVE
  await source.connect();
  return {
    source,
    flip: () => source.simulateEntitlementChange('user-002'), // resolves to DELAYED
    restate: () => source.simulateEntitlementChange('user-003'), // still LIVE
  };
}

async function gatewayRig(): Promise<Rig> {
  const harness = createHarness();
  const socket = await connectAndAuthenticate(harness, FIXTURES['connected-live']);
  return {
    source: harness.source,
    flip: () => socket.emit(FIXTURES['entitlement-downgraded']),
    restate: () => socket.emit(FIXTURES['entitlement-upgraded']), // restates LIVE
  };
}

describe.each([
  ['simulated', simulatedRig],
  ['gateway', gatewayRig],
])('%s source — entitlement-change discard', (_name, buildRig) => {
  beforeEach(() => {
    resetStore();
    primeSymbols();
    applyTick(tick('COMI', '90.00', 'evt-1'));
  });

  it('discards the old stream before any entitlement listener runs', async () => {
    const rig = await buildRig();
    const discard = vi.fn();
    const unregister = onStreamDiscard(discard);
    let seenByListener: ReturnType<typeof getSymbolSnapshot> | 'not called' = 'not called';
    rig.source.on.entitlement(() => {
      seenByListener = getSymbolSnapshot('COMI');
    });

    rig.flip();

    expect(discard).toHaveBeenCalledTimes(1);
    expect(seenByListener).toBeUndefined();
    expect(rig.source.identity()?.stream).toBe('DELAYED');
    unregister();
    rig.source.disconnect();
  });

  it('discards nothing when the change restates the current stream', async () => {
    const rig = await buildRig();
    const discard = vi.fn();
    const unregister = onStreamDiscard(discard);

    rig.restate();

    expect(discard).not.toHaveBeenCalled();
    expect(getSymbolSnapshot('COMI')).toBeDefined();
    unregister();
    rig.source.disconnect();
  });
});

/**
 * REST `GET /symbols/{symbol}/snapshot` and an unprompted WS `snapshot` push
 * (client-contract.md §3.3) reach the UI through the same handler with the same shape.
 * `TckrGatewaySource.#ingestSnapshot` is the shared handler (true `#`-private, so it
 * cannot be spied on directly — by design, see `conformance.surface.test.ts`); this
 * proves the claim through its externally observable effects instead:
 *   - both paths write the identical resulting view into the shared store
 *     (`src/data/store.ts`), which only `#ingestSnapshot` ever calls `applySnapshot`
 *     from within this source.
 *   - only the WS push additionally notifies `on.snapshot` — matching
 *     `SimulatedSource.getSnapshot()`, which does not fire `on.snapshot` either (see
 *     `TckrGatewaySource.ts`'s `#ingestSnapshot` doc).
 */
import { describe, expect, it } from 'vitest';
import { toDecimal } from '../../../contracts/decimal.ts';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import type { Snapshot } from '../../../contracts/rest.ts';
import { getSymbolSnapshot, primeUniverse, resetStore } from '../../store.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

// applySnapshot now drops a snapshot for any symbol not in the primed universe
// (security fix: an unrecognized `snapshot.symbol` — server-controlled and only
// shape-validated — must not be able to grow the store) — every case here primes
// COMI first, matching how the real sources always prime the universe before a
// snapshot for a real symbol can arrive.
function primeComi(): void {
  primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
}

describe('gateway snapshot-path conformance', () => {
  it('REST getSnapshot() writes into the shared store and resolves with the parsed snapshot, without calling on.snapshot', async () => {
    resetStore();
    primeComi();
    const restBody = { ...FIXTURES['snapshot-live'].snapshot, symbol: 'COMI' };
    const harness = createHarness({ '/symbols/COMI/snapshot': restBody });
    await connectAndAuthenticate(harness);

    const pushed: Snapshot[] = [];
    harness.source.on.snapshot((s) => pushed.push(s));

    const resolved = await harness.source.getSnapshot('COMI');

    expect(resolved).toMatchObject({ symbol: 'COMI', price: '85.42', stream: 'LIVE' });
    expect(pushed).toHaveLength(0);
    expect(getSymbolSnapshot('COMI')).toMatchObject({ symbol: 'COMI', price: '85.42' });
  });

  it('an unprompted WS snapshot push writes the same shape into the store and also notifies on.snapshot', async () => {
    resetStore();
    primeComi();
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);

    const pushed: Snapshot[] = [];
    harness.source.on.snapshot((s) => pushed.push(s));

    socket.emit(FIXTURES['snapshot-live']);

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ symbol: 'COMI', price: '85.42', stream: 'LIVE' });
    expect(getSymbolSnapshot('COMI')).toMatchObject({ symbol: 'COMI', price: '85.42' });
  });

  it('the store ends up in the identical state whichever path delivered an otherwise-identical snapshot', async () => {
    resetStore();
    primeComi();
    const restBody = { ...FIXTURES['snapshot-live'].snapshot, symbol: 'COMI' };
    const restHarness = createHarness({ '/symbols/COMI/snapshot': restBody });
    await connectAndAuthenticate(restHarness);
    await restHarness.source.getSnapshot('COMI');
    const viaRest = getSymbolSnapshot('COMI');

    resetStore();
    primeComi();
    const pushHarness = createHarness();
    const pushSocket = await connectAndAuthenticate(pushHarness);
    pushSocket.emit(FIXTURES['snapshot-live']);
    const viaPush = getSymbolSnapshot('COMI');

    expect(viaRest).toBeDefined();
    expect(viaPush).toBeDefined();
    // `lastUpdate` is a wall-clock timestamp (`Date.now()`), not part of the wire shape
    // — excluded from this equality on purpose.
    const { lastUpdate: _restLastUpdate, ...restRest } = viaRest ?? {};
    const { lastUpdate: _pushLastUpdate, ...pushRest } = viaPush ?? {};
    expect(restRest).toEqual(pushRest);
  });
});

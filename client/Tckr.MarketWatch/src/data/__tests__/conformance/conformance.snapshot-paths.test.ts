/**
 * REST `GET /{market}/symbols/{symbol}/snapshot` and an unprompted WS `snapshot` push
 * (client-contract.md §3.3) reach the UI through one handler with one shape: both leave
 * the shared store in the same state. Only the push notifies `on.snapshot`, matching
 * `SimulatedSource.getSnapshot()`, which doesn't either.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import type { Snapshot } from '../../../contracts/rest.ts';
import { getSymbolSnapshot, resetStore } from '../../store.ts';
import { primeSymbols } from '../testSupport.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

/** The store's view of COMI, minus its wall-clock receipt time. */
function storedComi() {
  const { lastUpdate: _receivedAt, ...view } = getSymbolSnapshot('COMI') ?? {};
  return view;
}

describe('gateway snapshot-path conformance', () => {
  it('REST and WS push write the identical view, and only the push notifies on.snapshot', async () => {
    resetStore();
    primeSymbols();
    const restBody = { ...FIXTURES['snapshot-live'].snapshot, symbol: 'COMI' };
    const rest = createHarness({ '/EGX/symbols/COMI/snapshot': restBody });
    await connectAndAuthenticate(rest);
    const restPushed: Snapshot[] = [];
    rest.source.on.snapshot((s) => restPushed.push(s));

    const resolved = await rest.source.getSnapshot('COMI');

    expect(resolved).toMatchObject({ symbol: 'COMI', price: '85.42', stream: 'LIVE' });
    expect(restPushed).toHaveLength(0);
    const viaRest = storedComi();
    expect(viaRest).toMatchObject({ symbol: 'COMI', price: '85.42' });

    resetStore();
    primeSymbols();
    const push = createHarness();
    const socket = await connectAndAuthenticate(push);
    const pushed: Snapshot[] = [];
    push.source.on.snapshot((s) => pushed.push(s));

    socket.emit(FIXTURES['snapshot-live']);

    expect(pushed).toHaveLength(1);
    expect(storedComi()).toEqual(viaRest);
  });
});

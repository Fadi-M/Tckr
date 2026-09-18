/**
 * Security regression: `applyTick`/`applySnapshot` must not create a permanent
 * `records`/`meta` entry for a symbol that was never primed into the universe.
 *
 * `tick.s`/`snapshot.symbol` are server-controlled and only shape-validated (a string)
 * by `parseServerMessage` — nothing upstream checks them against the real
 * subscribed/universe symbol set. Without this guard, a compromised or misbehaving
 * gateway could send `tick`/`snapshot` frames for an unbounded number of distinct,
 * arbitrary symbols, each one growing the store's `Map`s without limit (unbounded heap
 * growth, eventual tab crash). `primeUniverse` is this module's only trustworthy
 * definition of "a real symbol" (it is populated only from the actual tradeable
 * universe — see `SimulatedSource`'s constructor and
 * `TckrGatewaySource#fetchUniverse`), so a tick/snapshot for anything else is dropped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Snapshot } from '../../contracts/rest.ts';
import type { Tick } from '../../contracts/messages.ts';
import { applySnapshot, applyTick, getSymbolList, getSymbolSnapshot, primeUniverse, resetStore, subscribeSymbol } from '../store.ts';

function tick(symbol: string, price: string, id: string): Tick {
  return {
    v: 1,
    type: 'tick',
    s: symbol,
    p: toDecimal(price),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id,
    st: 'LIVE',
  };
}

function snapshot(symbol: string, price: string): Snapshot {
  return {
    v: 1,
    symbol,
    stream: 'LIVE',
    price: toDecimal(price),
    change: toDecimal('0.00'),
    changePercent: '0.00%',
    open: toDecimal(price),
    high: toDecimal(price),
    low: toDecimal(price),
    volume: 1000,
    lastEventId: 'evt-000000000000001',
    exchangeTimestamp: '2026-09-12T10:31:04.881Z' as Snapshot['exchangeTimestamp'],
    snapshotAge: 0,
    simulated: false,
  };
}

describe('store drops ticks/snapshots for a symbol outside the primed universe', () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('applyTick does not create a records entry for an unprimed symbol', () => {
    expect(getSymbolSnapshot('BOGUS')).toBeUndefined();

    applyTick(tick('BOGUS', '10.00', 'evt-1'));

    expect(getSymbolSnapshot('BOGUS')).toBeUndefined();
  });

  it('applyTick does not notify a subscriber for an unprimed symbol', () => {
    const listener = vi.fn();
    subscribeSymbol('BOGUS', listener);

    applyTick(tick('BOGUS', '10.00', 'evt-1'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('applyTick still works normally for a symbol that IS in the primed universe', () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);

    applyTick(tick('COMI', '86.00', 'evt-1'));

    expect(getSymbolSnapshot('COMI')).toMatchObject({ symbol: 'COMI', price: '86.00' });
  });

  it('applyTick for an unprimed symbol does not affect a later prime + tick for the same symbol', () => {
    applyTick(tick('COMI', '86.00', 'evt-1')); // dropped: not primed yet
    expect(getSymbolSnapshot('COMI')).toBeUndefined();

    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '86.00', 'evt-2'));

    expect(getSymbolSnapshot('COMI')).toMatchObject({ symbol: 'COMI', price: '86.00' });
  });

  it('a flood of ticks for distinct unprimed symbols never grows the store', () => {
    for (let i = 0; i < 500; i += 1) {
      applyTick(tick(`FAKE${i}`, '1.00', `evt-${i}`));
    }
    // getSymbolList() reflects only the primed universe (empty here), and none of the
    // flooded symbols ever became observable via the store's read API.
    expect(getSymbolList()).toEqual([]);
    expect(getSymbolSnapshot('FAKE0')).toBeUndefined();
    expect(getSymbolSnapshot('FAKE499')).toBeUndefined();
  });

  it('applySnapshot does not create a records entry for an unprimed symbol', () => {
    applySnapshot(snapshot('BOGUS', '10.00'));

    expect(getSymbolSnapshot('BOGUS')).toBeUndefined();
  });

  it('applySnapshot still works normally for a symbol that IS in the primed universe', () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);

    applySnapshot(snapshot('COMI', '86.00'));

    expect(getSymbolSnapshot('COMI')).toMatchObject({ symbol: 'COMI', price: '86.00' });
  });

  it('warns via console.warn when dropping an unrecognized tick or snapshot, for observability', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    applyTick(tick('BOGUS', '10.00', 'evt-1'));
    applySnapshot(snapshot('BOGUS', '10.00'));

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

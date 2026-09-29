/**
 * Security regression: `tick.s` / `snapshot.symbol` are server-controlled and only
 * shape-validated, so a misbehaving gateway could name any number of made-up symbols.
 * The store only accepts symbols primed from the real universe (`primeUniverse`); for
 * anything else it drops the frame, notifies nobody and warns, so the store's maps can't
 * grow without bound.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Snapshot } from '../../contracts/rest.ts';
import {
  applySnapshot,
  applyTick,
  getSymbolList,
  getSymbolSnapshot,
  resetStore,
  subscribeSymbol,
} from '../store.ts';
import { primeSymbols, tick } from './testSupport.ts';

function snapshot(symbol: string, price: string): Snapshot {
  return {
    v: 1,
    symbol,
    stream: 'LIVE',
    price: toDecimal(price),
    change: toDecimal('0.00'),
    changePercent: '0.00',
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

describe('store drops frames for a symbol outside the primed universe', () => {
  beforeEach(() => {
    resetStore();
  });

  it('never grows, notifies or exposes a flood of made-up symbols, and warns for each', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listener = vi.fn();
    subscribeSymbol('FAKE0', listener);

    for (let i = 0; i < 500; i += 1) {
      applyTick(tick(`FAKE${i}`, '1.00', `evt-${i}`));
    }
    applySnapshot(snapshot('FAKE0', '1.00'));

    expect(getSymbolList()).toEqual([]);
    expect(getSymbolSnapshot('FAKE0')).toBeUndefined();
    expect(getSymbolSnapshot('FAKE499')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(501);
  });

  it('accepts the same symbol normally once it is primed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyTick(tick('COMI', '86.00', 'evt-1')); // dropped: not primed yet

    primeSymbols();
    applyTick(tick('COMI', '86.00', 'evt-2'));
    expect(getSymbolSnapshot('COMI')).toMatchObject({ symbol: 'COMI', price: '86.00' });

    applySnapshot(snapshot('COMI', '87.00'));
    expect(getSymbolSnapshot('COMI')).toMatchObject({ price: '87.00' });
  });
});

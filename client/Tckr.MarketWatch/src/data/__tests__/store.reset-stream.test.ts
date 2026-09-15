import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import {
  applyTick,
  getSymbolList,
  getSymbolSnapshot,
  primeUniverse,
  resetStore,
  resetStream,
  subscribeSymbol,
} from '../store.ts';

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

describe('store.resetStream', () => {
  beforeEach(() => {
    resetStore();
  });

  it('clears price/quote views but preserves the primed symbol list and names', () => {
    primeUniverse([
      { symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') },
      { symbol: 'CIB', name: 'Cairo Investment Bank', referencePrice: toDecimal('62.75') },
    ]);
    const listBefore = getSymbolList();
    applyTick(tick('COMI', '86.00', 'evt-1'));
    expect(getSymbolSnapshot('COMI')).toBeDefined();

    resetStream();

    expect(getSymbolSnapshot('COMI')).toBeUndefined();
    expect(getSymbolSnapshot('CIB')).toBeUndefined();
    expect(getSymbolList()).toBe(listBefore); // same reference — universe untouched
    expect(getSymbolList()).toEqual(['COMI', 'CIB']);

    // The name is preserved: a fresh tick immediately after reset resolves it correctly.
    applyTick(tick('COMI', '85.10', 'evt-2'));
    expect(getSymbolSnapshot('COMI')?.name).toBe('Commercial International Holding');
  });

  it("resets the change baseline back to the static reference price, discarding the old stream's open", () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));
    expect(getSymbolSnapshot('COMI')?.change).toBe('4.90'); // 90.00 - 85.10

    resetStream();
    applyTick(tick('COMI', '85.10', 'evt-2'));

    expect(getSymbolSnapshot('COMI')?.change).toBe('0.00'); // baseline restored, not 90.00
  });

  it('notifies a subscriber only for a symbol it actually clears', () => {
    primeUniverse([
      { symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') },
      { symbol: 'CIB', name: 'Cairo Investment Bank', referencePrice: toDecimal('62.75') },
    ]);
    applyTick(tick('COMI', '86.00', 'evt-1')); // CIB never ticked

    const comiListener = vi.fn();
    const cibListener = vi.fn();
    subscribeSymbol('COMI', comiListener);
    subscribeSymbol('CIB', cibListener);

    resetStream();

    expect(comiListener).toHaveBeenCalledTimes(1);
    expect(cibListener).not.toHaveBeenCalled(); // had nothing to clear
  });

  it('restarts volume accumulation from zero after a reset', () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '85.10', 'evt-1')); // q=100
    applyTick(tick('COMI', '85.15', 'evt-2')); // q=100, running volume=200
    expect(getSymbolSnapshot('COMI')?.volume).toBe(200);

    resetStream();
    applyTick(tick('COMI', '85.10', 'evt-3'));

    expect(getSymbolSnapshot('COMI')?.volume).toBe(100); // restarted, not 300
  });

  it('is safe to call with no primed universe and no ticks at all', () => {
    expect(() => resetStream()).not.toThrow();
    expect(getSymbolList()).toEqual([]);
  });
});

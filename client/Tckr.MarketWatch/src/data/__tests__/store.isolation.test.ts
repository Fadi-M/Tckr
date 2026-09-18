import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { applyTick, primeUniverse, resetStore, subscribeSymbol } from '../store.ts';

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

describe('store per-symbol subscription isolation', () => {
  beforeEach(() => {
    resetStore();
    // applyTick now drops a tick for any symbol not in the primed universe (security
    // fix: an unrecognized `tick.s` must not be able to grow the store) — prime COMI
    // and CIB so this file's ticks are accepted, matching how the real sources always
    // prime before a tick can arrive.
    primeUniverse([
      { symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') },
      { symbol: 'CIB', name: 'Cairo Investment Bank', referencePrice: toDecimal('62.75') },
    ]);
  });

  it('notifies only the ticked symbol’s subscriber, not other symbols’', () => {
    const comiListener = vi.fn();
    const cibListener = vi.fn();
    const unsubComi = subscribeSymbol('COMI', comiListener);
    const unsubCib = subscribeSymbol('CIB', cibListener);

    applyTick(tick('COMI', '85.42', 'evt-1'));

    expect(comiListener).toHaveBeenCalledTimes(1);
    expect(cibListener).not.toHaveBeenCalled();

    unsubComi();
    unsubCib();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSymbol('COMI', listener);
    applyTick(tick('COMI', '85.42', 'evt-1'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    applyTick(tick('COMI', '85.47', 'evt-2'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports multiple independent listeners on the same symbol', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeSymbol('COMI', a);
    subscribeSymbol('COMI', b);
    applyTick(tick('COMI', '85.42', 'evt-1'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

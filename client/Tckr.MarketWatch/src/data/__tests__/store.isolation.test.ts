/** One tick notifies only its own symbol's subscribers: the store half of "one tick,
 * one row". */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTick, resetStore, subscribeSymbol } from '../store.ts';
import { primeSymbols, tick } from './testSupport.ts';

describe('store per-symbol subscription isolation', () => {
  beforeEach(() => {
    resetStore();
    primeSymbols(true);
  });

  it('notifies every subscriber of the ticked symbol, and no other symbol’s', () => {
    const comiA = vi.fn();
    const comiB = vi.fn();
    const cib = vi.fn();
    subscribeSymbol('COMI', comiA);
    subscribeSymbol('COMI', comiB);
    subscribeSymbol('CIB', cib);

    applyTick(tick('COMI', '85.42', 'evt-1'));

    expect(comiA).toHaveBeenCalledTimes(1);
    expect(comiB).toHaveBeenCalledTimes(1);
    expect(cib).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSymbol('COMI', listener);
    applyTick(tick('COMI', '85.42', 'evt-1'));
    unsubscribe();
    applyTick(tick('COMI', '85.47', 'evt-2'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

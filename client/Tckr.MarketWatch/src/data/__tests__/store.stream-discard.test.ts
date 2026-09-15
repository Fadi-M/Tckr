import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import {
  applyTick,
  getSymbolSnapshot,
  onStreamDiscard,
  primeUniverse,
  resetStore,
  resetStream,
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

describe('store.onStreamDiscard', () => {
  beforeEach(() => {
    resetStore();
  });

  it('fires when resetStream() runs', () => {
    const listener = vi.fn();
    onStreamDiscard(listener);

    resetStream();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires once per resetStream() call, for every registered listener', () => {
    const a = vi.fn();
    const b = vi.fn();
    onStreamDiscard(a);
    onStreamDiscard(b);

    resetStream();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    resetStream();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops further notifications', () => {
    const listener = vi.fn();
    const unsubscribe = onStreamDiscard(listener);

    resetStream();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    resetStream();
    expect(listener).toHaveBeenCalledTimes(1); // no further calls
  });

  it('a listener observes state that is already cleared and re-anchored', () => {
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
    applyTick(tick('COMI', '90.00', 'evt-1'));
    expect(getSymbolSnapshot('COMI')).toBeDefined();

    let sawInsideListener: ReturnType<typeof getSymbolSnapshot>;
    let calledWithSideEffect = false;
    onStreamDiscard(() => {
      calledWithSideEffect = true;
      sawInsideListener = getSymbolSnapshot('COMI');
    });

    resetStream();

    expect(calledWithSideEffect).toBe(true);
    expect(sawInsideListener).toBeUndefined(); // the view was already cleared

    // The baseline is already re-anchored too, by the time the listener runs: a tick at
    // the pristine reference price shows zero change, not a stale one computed against
    // the discarded stream's open.
    applyTick(tick('COMI', '85.10', 'evt-2'));
    expect(getSymbolSnapshot('COMI')?.change).toBe('0.00');
  });

  it('does not fire on resetStore() (a distinct, test-only wipe)', () => {
    const listener = vi.fn();
    onStreamDiscard(listener);
    resetStore();
    expect(listener).not.toHaveBeenCalled();
  });
});

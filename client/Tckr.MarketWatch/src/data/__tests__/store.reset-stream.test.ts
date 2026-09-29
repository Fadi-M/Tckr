/**
 * `resetStream()` — the stream discard behind a LIVE↔DELAYED switch. Prices, change
 * baselines and volumes of the old stream go; the universe stays; `onStreamDiscard`
 * listeners run once the store is already cleared and re-anchored. `resetStore()` (a
 * test-only wipe) is not a discard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTick,
  getSymbolList,
  getSymbolSnapshot,
  onStreamDiscard,
  resetStore,
  resetStream,
  subscribeSymbol,
} from '../store.ts';
import { primeSymbols, tick } from './testSupport.ts';

describe('store.resetStream', () => {
  beforeEach(() => {
    resetStore();
  });

  it('clears price views but keeps the universe and its names', () => {
    primeSymbols(true);
    const listBefore = getSymbolList();
    applyTick(tick('COMI', '86.00', 'evt-1'));

    resetStream();

    expect(getSymbolSnapshot('COMI')).toBeUndefined();
    expect(getSymbolList()).toBe(listBefore);
    applyTick(tick('COMI', '85.10', 'evt-2'));
    expect(getSymbolSnapshot('COMI')?.name).toBe('Commercial International Holding');
  });

  it('re-anchors change to the reference price and restarts volume from zero', () => {
    primeSymbols();
    applyTick(tick('COMI', '90.00', 'evt-1'));
    applyTick(tick('COMI', '90.05', 'evt-2'));
    expect(getSymbolSnapshot('COMI')).toMatchObject({ change: '4.95', volume: 200 });

    resetStream();
    applyTick(tick('COMI', '85.10', 'evt-3'));

    expect(getSymbolSnapshot('COMI')).toMatchObject({ change: '0.00', volume: 100 });
  });

  it('notifies a symbol subscriber only if it had something to clear', () => {
    primeSymbols(true);
    applyTick(tick('COMI', '86.00', 'evt-1')); // CIB never ticked
    const comi = vi.fn();
    const cib = vi.fn();
    subscribeSymbol('COMI', comi);
    subscribeSymbol('CIB', cib);

    resetStream();

    expect(comi).toHaveBeenCalledTimes(1);
    expect(cib).not.toHaveBeenCalled();
  });

  it('runs every discard listener once per reset, after the store is cleared, until unsubscribed', () => {
    primeSymbols();
    applyTick(tick('COMI', '90.00', 'evt-1'));
    const seen: unknown[] = [];
    const other = vi.fn();
    const unsubscribe = onStreamDiscard(() => seen.push(getSymbolSnapshot('COMI')));
    onStreamDiscard(other);

    resetStream();
    unsubscribe();
    resetStream();

    expect(seen).toEqual([undefined]);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('is not triggered by resetStore(), and is safe on an empty store', () => {
    const listener = vi.fn();
    onStreamDiscard(listener);
    resetStore();
    expect(listener).not.toHaveBeenCalled();
    expect(() => resetStream()).not.toThrow();
  });
});

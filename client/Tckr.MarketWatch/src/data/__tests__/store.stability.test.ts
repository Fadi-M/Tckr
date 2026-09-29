/** `getSymbolSnapshot` keeps one reference until the symbol changes, so a
 * `useSyncExternalStore` row re-renders only on its own ticks. */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTick, getSymbolSnapshot, resetStore } from '../store.ts';
import { primeSymbols, tick } from './testSupport.ts';

describe('store.getSymbolSnapshot reference stability', () => {
  beforeEach(() => {
    resetStore();
    primeSymbols();
  });

  it('is undefined before any data, then one stable reference until the next tick', () => {
    expect(getSymbolSnapshot('COMI')).toBeUndefined();

    applyTick(tick('COMI', '85.42', 'evt-1'));
    const first = getSymbolSnapshot('COMI');
    expect(first).toBeDefined();
    expect(getSymbolSnapshot('COMI')).toBe(first);

    applyTick(tick('COMI', '85.47', 'evt-2'));
    const after = getSymbolSnapshot('COMI');
    expect(after).not.toBe(first);
    expect(after?.price).toBe('85.47');
  });
});

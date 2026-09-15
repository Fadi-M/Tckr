import { beforeEach, describe, expect, it } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { applyTick, getSymbolSnapshot, resetStore } from '../store.ts';

function tick(overrides: Partial<Tick> = {}): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal('85.42'),
    q: 500,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id: 'evt-000000000000001',
    st: 'LIVE',
    ...overrides,
  };
}

describe('store.getSymbolSnapshot reference stability', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns undefined for a symbol that has never received a snapshot or tick', () => {
    expect(getSymbolSnapshot('COMI')).toBeUndefined();
  });

  it('returns an identical object reference across calls with no intervening tick', () => {
    applyTick(tick());
    const first = getSymbolSnapshot('COMI');
    const second = getSymbolSnapshot('COMI');
    expect(first).toBeDefined();
    expect(second).toBe(first); // same reference, not merely deep-equal
  });

  it('returns a new reference after a tick changes the symbol', () => {
    applyTick(tick());
    const before = getSymbolSnapshot('COMI');
    applyTick(tick({ p: toDecimal('85.47'), id: 'evt-000000000000002' }));
    const after = getSymbolSnapshot('COMI');
    expect(after).not.toBe(before);
    expect(after?.price).toBe('85.47');
  });
});

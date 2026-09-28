/**
 * The store quotes Change from the previous close (EGX convention) when a snapshot
 * carries one, and from the session open when it doesn't (a v1 gateway that predates the
 * additive `previousClose` field). Ticks after the snapshot use the same baseline.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc, Tick } from '../../contracts/messages.ts';
import type { Snapshot } from '../../contracts/rest.ts';
import {
  applySnapshot,
  applyTick,
  getSymbolSnapshot,
  primeUniverse,
  resetStore,
} from '../store.ts';

function snapshot(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    symbol: 'COMI',
    stream: 'LIVE',
    price: toDecimal('86.00'),
    change: toDecimal('+1.00'),
    changePercent: '+1.18',
    open: toDecimal('85.00'),
    high: toDecimal('86.20'),
    low: toDecimal('84.90'),
    volume: 1000,
    lastEventId: 'evt-1',
    exchangeTimestamp: '2026-09-12T10:31:04.881Z' as IsoUtc,
    snapshotAge: 0,
    simulated: true,
    ...extra,
  };
}

const tick: Tick = {
  v: 1,
  type: 'tick',
  s: 'COMI',
  p: toDecimal('87.00'),
  q: 10,
  k: 'TRADE',
  t: '2026-09-12T10:31:05.000Z' as IsoUtc,
  id: 'evt-2',
  st: 'LIVE',
};

describe('store change baseline', () => {
  beforeEach(() => {
    resetStore();
    primeUniverse([
      {
        symbol: 'COMI',
        name: 'Commercial International Holding',
        referencePrice: toDecimal('80.00'),
      },
    ]);
  });

  it('measures change from the previous close when the snapshot carries it', () => {
    applySnapshot(snapshot({ previousClose: toDecimal('85.50') }));
    expect(getSymbolSnapshot('COMI')?.change).toBe(toDecimal('0.50'));
    applyTick(tick);
    expect(getSymbolSnapshot('COMI')?.change).toBe(toDecimal('1.50'));
  });

  it('falls back to the session open without one', () => {
    applySnapshot(snapshot());
    expect(getSymbolSnapshot('COMI')?.change).toBe(toDecimal('1.00'));
    applyTick(tick);
    expect(getSymbolSnapshot('COMI')?.change).toBe(toDecimal('2.00'));
  });
});

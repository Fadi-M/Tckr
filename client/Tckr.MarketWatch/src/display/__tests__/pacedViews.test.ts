/**
 * `pacedViews.test.ts` — the painted view of a symbol only advances on the page's one
 * wall-clock beat, and the beat's listeners (re-rank, hero picks, detail header) see the
 * views already moved. A read between beats (any re-render: a click, a sort) shows what the last beat
 * painted, never the newest unpainted price. A stream discard is never paced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import type { Tick } from '../../contracts/messages.ts';
import { applyTick, getSymbolSnapshot, primeUniverse, resetStore, resetStream } from '../../data/store.ts';
import { getPacedSymbolSnapshot, subscribeBeat, subscribePacedSymbol } from '../pacedViews.ts';
import { DISPLAY_REFRESH_INTERVAL_MS } from '../throttle.ts';

function tick(price: string, id: string): Tick {
  return {
    v: 1,
    type: 'tick',
    s: 'COMI',
    p: toDecimal(price),
    q: 100,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as Tick['t'],
    id,
    st: 'LIVE',
  };
}

describe('paced symbol views', () => {
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T08:00:01.000Z'));
    resetStore();
    primeUniverse([{ symbol: 'COMI', name: 'Commercial International Holding', referencePrice: toDecimal('85.10') }]);
  });

  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
  });

  it('holds the painted view until the next wall-clock beat while the store moves on', () => {
    const cb = vi.fn();
    unsubscribe = subscribePacedSymbol('COMI', cb);

    applyTick(tick('85.20', 'evt-1'));
    applyTick(tick('85.40', 'evt-2'));
    expect(getSymbolSnapshot('COMI')?.price).toBe('85.40');
    expect(getPacedSymbolSnapshot('COMI')).toBeUndefined(); // nothing painted yet

    vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS - 1001); // 1ms short of the slot
    expect(getPacedSymbolSnapshot('COMI')).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(getPacedSymbolSnapshot('COMI')?.price).toBe('85.40');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('runs beat listeners after every paced view has moved, in the same task', () => {
    unsubscribe = subscribePacedSymbol('COMI', () => {});
    const seen: (string | undefined)[] = [];
    const stopBeat = subscribeBeat(() => seen.push(getPacedSymbolSnapshot('COMI')?.price));
    applyTick(tick('85.20', 'evt-1'));
    vi.advanceTimersByTime(DISPLAY_REFRESH_INTERVAL_MS);
    stopBeat();
    expect(seen).toEqual(['85.20']);
  });

  it('drops the old stream immediately on a discard, not on the next beat', () => {
    unsubscribe = subscribePacedSymbol('COMI', () => {});
    applyTick(tick('85.20', 'evt-1'));
    applyTick(tick('85.40', 'evt-2'));

    resetStream();

    expect(getPacedSymbolSnapshot('COMI')).toBeUndefined();
  });

  it('reads through to the store for a symbol nothing is pacing', () => {
    applyTick(tick('85.20', 'evt-1'));
    applyTick(tick('85.40', 'evt-2'));
    expect(getPacedSymbolSnapshot('COMI')?.price).toBe('85.40');
  });
});

/**
 * `StockList.render-isolation.test.tsx` — task 04. Asserts the whole point of the
 * page's design: a tick for one symbol re-renders that row and nothing else
 * (README.md design decision #9). Each row exposes a `data-render-count` attribute for
 * exactly this purpose — see the doc comment on `StockListRow` in `../StockList.tsx`.
 *
 * Measured counts (pasted into "Notes for other tasks" in the final report): before the
 * tick every one of the 34 rows is at render count 1; after one `applyTick('COMI', ...)`,
 * COMI is at 2 and the other 33 remain at 1 — asserted generically below via a
 * before/after diff so the test does not depend on the exact baseline count.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc, Tick } from '../../contracts/messages.ts';
import type { SymbolDefinition, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { MarketDataSource } from '../../data/MarketDataSource.ts';
import { applyTick, resetStore } from '../../data/store.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

const here = dirname(fileURLToPath(import.meta.url));

interface RawSymbol {
  readonly symbol: string;
  readonly name: string;
  readonly referencePrice: number;
  readonly tickSize: number;
  readonly lotSize: number;
}

function loadUniverseFixture(): readonly SymbolDefinition[] {
  const raw = readFileSync(resolve(here, '../../../public/symbols.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { symbols: readonly RawSymbol[] };
  return parsed.symbols.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    currency: 'EGP',
    tickSize: toDecimal(s.tickSize.toString()),
    lotSize: s.lotSize,
    referencePrice: toDecimal(s.referencePrice.toString()),
  }));
}

function makeFakeSource(symbols: readonly SymbolDefinition[]): MarketDataSource {
  return {
    connect: () => Promise.resolve(),
    disconnect: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    getUniverse: () =>
      Promise.resolve<SymbolUniverseResponse>({
        v: 1,
        asOf: new Date().toISOString() as IsoUtc,
        simulated: true,
        symbols,
      }),
    getSnapshot: () => Promise.reject(new Error('not used')),
    on: {
      tick: () => () => {},
      snapshot: () => () => {},
      status: () => () => {},
      error: () => () => {},
      entitlement: () => () => {},
    },
    identity: () => null,
  };
}

function makeTick(symbol: string, price: string): Tick {
  return {
    v: 1,
    type: 'tick',
    s: symbol,
    p: toDecimal(price),
    q: 500,
    k: 'TRADE',
    t: '2026-09-12T10:31:04.881Z' as IsoUtc,
    id: 'evt-000000000000001',
    st: 'LIVE',
  };
}

describe('StockList render isolation', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
    // Each row also runs a 1s `setInterval` to recompute its relative "last update"
    // label (independent of ticks — see `StockList.tsx`). Freezing time keeps that
    // timer from firing mid-test and adding an incidental render under CI load.
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a tick for COMI increments exactly COMI’s render count by 1, leaving the other 33 rows unchanged', async () => {
    const universeSymbols = loadUniverseFixture();
    mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols));

    render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    // Flush the `getUniverse()` microtask without relying on `findBy*`'s real-timer
    // polling, which does not advance under `vi.useFakeTimers()`.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rowsBefore = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
    expect(rowsBefore).toHaveLength(34);
    const before = new Map<string, number>(
      rowsBefore.map((row) => [
        row.getAttribute('data-symbol') as string,
        Number(row.getAttribute('data-render-count')),
      ]),
    );

    act(() => {
      applyTick(makeTick('COMI', '85.42'));
    });

    const rowsAfter = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-symbol'));
    const after = new Map<string, number>(
      rowsAfter.map((row) => [
        row.getAttribute('data-symbol') as string,
        Number(row.getAttribute('data-render-count')),
      ]),
    );

    let comiDelta = -1;
    let othersUnchanged = true;
    for (const [symbol, beforeCount] of before) {
      const afterCount = after.get(symbol) ?? -1;
      if (symbol === 'COMI') {
        comiDelta = afterCount - beforeCount;
      } else if (afterCount !== beforeCount) {
        othersUnchanged = false;
      }
    }

    expect(comiDelta).toBe(1);
    expect(othersUnchanged).toBe(true);
  });
});

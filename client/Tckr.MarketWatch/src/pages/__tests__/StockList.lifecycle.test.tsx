/**
 * `StockList.lifecycle.test.tsx` — task 04. Asserts: `subscribe` is called once with
 * all 34 symbols on mount; `unsubscribe` is called with the same set on unmount.
 *
 * Also asserts the shared-source contract (config.ts's `getSharedSource`, per the
 * integration note from task 02's owner): StockList must NEVER call `.connect()` or
 * `.disconnect()` on the source it gets back — `getSharedSource()` connects itself
 * once, and disconnecting from a page would kill the connection StockDetail shares
 * (client-contract.md §3, "one connection per client").
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import type { SymbolDefinition, SymbolUniverseResponse } from '../../contracts/rest.ts';
import type { MarketDataSource } from '../../data/MarketDataSource.ts';
import { resetStore } from '../../data/store.ts';

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

interface RecordingSource extends MarketDataSource {
  readonly subscribeCalls: (readonly string[])[];
  readonly unsubscribeCalls: (readonly string[])[];
  readonly connectCalls: number;
  readonly disconnectCalls: number;
}

function makeRecordingSource(symbols: readonly SymbolDefinition[]): RecordingSource {
  const subscribeCalls: (readonly string[])[] = [];
  const unsubscribeCalls: (readonly string[])[] = [];
  let connectCalls = 0;
  let disconnectCalls = 0;
  return {
    get connectCalls() {
      return connectCalls;
    },
    get disconnectCalls() {
      return disconnectCalls;
    },
    subscribeCalls,
    unsubscribeCalls,
    connect: () => {
      connectCalls += 1;
      return Promise.resolve();
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
    subscribe: (syms) => {
      subscribeCalls.push(syms);
    },
    unsubscribe: (syms) => {
      unsubscribeCalls.push(syms);
    },
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

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StockList subscription lifecycle', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('subscribes to all 34 symbols once on mount and unsubscribes the same set on unmount', async () => {
    const universeSymbols = loadUniverseFixture();
    const expectedSymbols = universeSymbols.map((def) => def.symbol);
    const source = makeRecordingSource(universeSymbols);
    mockGetSharedSource.mockReturnValue(source);

    const { unmount } = render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    await flushMicrotasks();

    // Connection ownership belongs to `getSharedSource()` itself, not to StockList.
    expect(source.connectCalls).toBe(0);
    expect(source.subscribeCalls).toHaveLength(1);
    expect(source.subscribeCalls[0]).toHaveLength(34);
    expect([...(source.subscribeCalls[0] ?? [])].sort()).toEqual([...expectedSymbols].sort());
    expect(source.unsubscribeCalls).toHaveLength(0);

    unmount();

    expect(source.unsubscribeCalls).toHaveLength(1);
    expect([...(source.unsubscribeCalls[0] ?? [])].sort()).toEqual([...expectedSymbols].sort());
    // StockList must never disconnect the shared source — only unsubscribe its own
    // symbols. Disconnecting here would tear down StockDetail's connection too.
    expect(source.disconnectCalls).toBe(0);
  });
});

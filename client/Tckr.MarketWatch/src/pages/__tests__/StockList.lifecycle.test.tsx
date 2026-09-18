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
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

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
    const { source, connect, disconnect, subscribe, unsubscribe } = makeFakeSource(universeSymbols);
    mockGetSharedSource.mockReturnValue(source);

    const { unmount } = render(
      <MemoryRouter>
        <StockList />
      </MemoryRouter>,
    );

    await flushMicrotasks();

    // Connection ownership belongs to `getSharedSource()` itself, not to StockList.
    expect(connect).not.toHaveBeenCalled();
    expect(subscribe.mock.calls).toHaveLength(1);
    expect(subscribe.mock.calls[0]?.[0]).toHaveLength(34);
    expect([...(subscribe.mock.calls[0]?.[0] ?? [])].sort()).toEqual([...expectedSymbols].sort());
    expect(unsubscribe.mock.calls).toHaveLength(0);

    unmount();

    expect(unsubscribe.mock.calls).toHaveLength(1);
    expect([...(unsubscribe.mock.calls[0]?.[0] ?? [])].sort()).toEqual([...expectedSymbols].sort());
    // StockList must never disconnect the shared source — only unsubscribe its own
    // symbols. Disconnecting here would tear down StockDetail's connection too.
    expect(disconnect).not.toHaveBeenCalled();
  });
});

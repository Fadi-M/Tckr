/**
 * `StockList` table precision (2026-09-26 critique, P2): numeric headers sit over their
 * right-aligned figures; a change that rounds to 0.0% reads as unchanged (neutral chip,
 * no sign, "unchanged" to a screen reader) rather than a coloured "-0.0%"; and the
 * Session sparkline is seeded from each symbol's history instead of starting flat.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import type { IsoUtc } from '../../contracts/messages.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

async function renderList(options: Parameters<typeof makeFakeSource>[1] = {}) {
  const universeSymbols = loadUniverseFixture();
  primeUniverse(universeSymbols);
  mockGetSharedSource.mockReturnValue(makeFakeSource(universeSymbols, options).source);
  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StockList table precision', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('right-aligns numeric column headers and left-aligns text ones', async () => {
    await renderList();
    const header = (label: string) => screen.getByRole('columnheader', { name: new RegExp(`^${label}$`) });
    for (const label of ['Price', 'Change', 'Change %', 'Volume']) {
      expect(header(label).className).toContain('text-right');
    }
    for (const label of ['Symbol', 'Name', 'Last update']) {
      expect(header(label).className).toContain('text-left');
    }
  });

  it('shows a change that rounds to 0.0% as a neutral, unsigned, "unchanged" chip', async () => {
    await renderList();
    // COMI's reference price is 85.10; 85.12 is +0.02%, which rounds to 0.0%.
    act(() => {
      applyTick(tickFixture({ s: 'COMI', p: toDecimal('85.12') }));
    });
    const row = screen.getByRole('row', { name: /^COMI, 85\.12, unchanged 0\.0%$/ });
    const chip = Array.from(row.querySelectorAll('span')).find((el) => el.textContent === '0.0%');
    expect(chip).toBeDefined();
    expect(chip?.className).toContain('bg-surface-raised');
    expect(chip?.className).not.toContain('text-chip-up');
  });

  it('seeds the Session sparkline from the symbol history instead of starting flat', async () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      t: new Date(Date.UTC(2026, 8, 24, 8, i)).toISOString() as IsoUtc,
      p: toDecimal((80 + i * 0.25).toFixed(2)),
    }));
    await renderList({
      getHistoryImpl: (symbol) => Promise.resolve({ v: 1, symbol, points }),
    });

    const row = screen.getByRole('row', { name: /^COMI,/ });
    await waitFor(() => {
      const coords = row.querySelector('polyline')?.getAttribute('points')?.trim().split(/\s+/) ?? [];
      expect(coords).toHaveLength(20);
    });
    const ys = new Set(
      (row.querySelector('polyline')?.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',')[1]),
    );
    expect(ys.size).toBeGreaterThan(2);
  });
});

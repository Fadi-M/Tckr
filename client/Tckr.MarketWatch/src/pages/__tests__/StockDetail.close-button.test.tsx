/**
 * `StockDetail` has its own way out (critique 2026-09-26): a close button beside the
 * range pills, named for the symbol, that returns to the list — the same as Escape or
 * the list's "All instruments" pill.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { createFakeSource } from './testSupport.ts';

vi.mock('uplot', async () => {
  const mod = await import('../../chart/__tests__/uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resetSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetStore();
});

describe('StockDetail close button', () => {
  it('is named for the symbol and returns to the list', async () => {
    vi.mocked(getSharedSource).mockReturnValue(createFakeSource().source);
    render(
      <MemoryRouter initialEntries={['/EGX/symbols/COMI']}>
        <Routes>
          <Route path="/" element={<div data-testid="list-route" />} />
          <Route path="/EGX/symbols/:symbol" element={<StockDetail symbol="COMI" />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close COMI details' }));

    expect(await screen.findByTestId('list-route')).toBeDefined();
  });

  it('range pills lead their accessible name with the visible label (WCAG 2.5.3)', async () => {
    vi.mocked(getSharedSource).mockReturnValue(createFakeSource().source);
    render(
      <MemoryRouter initialEntries={['/EGX/symbols/COMI']}>
        <Routes>
          <Route path="/EGX/symbols/:symbol" element={<StockDetail symbol="COMI" />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    for (const key of ['60S', '5M', 'SESSION']) {
      const pill = screen.getByRole('button', { name: new RegExp(`^${key},`) });
      expect(pill.textContent).toBe(key);
    }
  });
});

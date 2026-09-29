/**
 * `StockDetail` has its own way out (critique 2026-09-26): a close button named for the
 * symbol that returns to the list, and range pills whose accessible names lead with their
 * visible label (WCAG 2.5.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

beforeEach(resetStore);
afterEach(cleanup);

describe('StockDetail close button and range pills', () => {
  it('closes with a button named for the symbol, and names each range pill by its label first', async () => {
    await renderDetail(
      <Routes>
        <Route path="/" element={<div data-testid="list-route" />} />
        <Route path="/EGX/symbols/:symbol" element={<StockDetail symbol="COMI" />} />
      </Routes>,
      createFakeSource().source,
      { path: '/EGX/symbols/COMI' },
    );

    for (const key of ['60S', '5M', 'SESSION']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${key},`) }).textContent).toBe(key);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Close COMI details' }));
    expect(await screen.findByTestId('list-route')).toBeDefined();
  });
});

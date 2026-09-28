/**
 * `StockList.search-keys.test.tsx` — the search-first keyboard path (critique
 * 2026-09-27): Enter in search opens the typed ticker (or the first match), ↓ from
 * search lands on the first row, the sortable headers are one Tab stop moved along with
 * ←/→, and arrowing through rows with a symbol open replaces the history entry instead
 * of adding one per row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

let goBack: () => void = () => {};

function DetailStub() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  goBack = () => navigate(-1);
  return <div data-testid="detail-route">{symbol}</div>;
}

function renderAt(path: string) {
  mockGetSharedSource.mockReturnValue(makeFakeSource(loadUniverseFixture()).source);
  return render(
    <MemoryRouter initialEntries={['/', path]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<StockList />}>
          <Route path="EGX/symbols/:symbol" element={<DetailStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockList search-first keyboard path', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('Enter in search opens the ticker typed', async () => {
    renderAt('/');
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'swdy' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('detail-route').textContent).toBe('SWDY'));
  });

  it('ArrowDown in search moves focus to the first row', async () => {
    renderAt('/');
    const rows = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('the sortable headers are a single Tab stop, moved along with the arrow keys', async () => {
    renderAt('/');
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const headerButtons = screen
      .getAllByRole('columnheader')
      .flatMap((th) => Array.from(th.querySelectorAll('button')));
    expect(headerButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const first = headerButtons.find((button) => button.tabIndex === 0)!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(first);
    expect(headerButtons).toContain(document.activeElement);
  });

  it('arrowing through rows with a symbol open does not add a history entry per row', async () => {
    renderAt('/EGX/symbols/COMI');
    await screen.findByTestId('detail-route');
    const rows = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const comi = rows.findIndex((row) => row.getAttribute('data-symbol') === 'COMI');
    rows[comi]!.focus();
    fireEvent.keyDown(rows[comi]!, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByTestId('detail-route').textContent).toBe(
        rows[comi + 1]!.getAttribute('data-symbol'),
      ),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByTestId('detail-route').textContent).toBe(
        rows[comi + 2]!.getAttribute('data-symbol'),
      ),
    );

    // One Back leaves the pane, rather than stepping back through each row passed.
    goBack();
    await waitFor(() => expect(screen.queryByTestId('detail-route')).toBeNull());
  });
});

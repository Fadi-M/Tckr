/**
 * `StockList.keyboard-detail.test.tsx` — keyboard paths in and out of the split detail
 * (critique 2026-09-26): Escape closes the open detail and returns focus to its row,
 * ↑/↓ with the detail open steps the detail to the next instrument, "/" focuses search,
 * and the keyboard model is described to screen readers. (The skip link lives in the
 * app shell — see SkipLink.test.tsx and shell.skip-link.test.tsx.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

function DetailStub() {
  const { symbol } = useParams();
  return <div data-testid="detail-route">{symbol}</div>;
}

function renderAt(path: string) {
  mockGetSharedSource.mockReturnValue(makeFakeSource(loadUniverseFixture()).source);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<StockList />}>
          <Route path="EGX/symbols/:symbol" element={<DetailStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockList keyboard paths around the detail pane', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  it('Escape closes the open detail and puts focus back on its row', async () => {
    renderAt('/EGX/symbols/CIB');
    await screen.findByTestId('detail-route');
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('detail-route')).toBeNull());
    await waitFor(() => expect(document.activeElement?.getAttribute('data-symbol')).toBe('CIB'));
  });

  it('Escape inside the search box leaves the detail open', async () => {
    renderAt('/EGX/symbols/CIB');
    await screen.findByTestId('detail-route');

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });

    expect(screen.getByTestId('detail-route').textContent).toBe('CIB');
  });

  it('with the detail open, ArrowDown moves focus and the detail to the next row', async () => {
    renderAt('/EGX/symbols/COMI');
    await screen.findByTestId('detail-route');
    const rows = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const comiIndex = rows.findIndex((row) => row.getAttribute('data-symbol') === 'COMI');
    const nextSymbol = rows[comiIndex + 1]!.getAttribute('data-symbol');

    rows[comiIndex]!.focus();
    fireEvent.keyDown(rows[comiIndex]!, { key: 'ArrowDown' });

    expect(document.activeElement?.getAttribute('data-symbol')).toBe(nextSymbol);
    await waitFor(() => expect(screen.getByTestId('detail-route').textContent).toBe(nextSymbol));
  });

  it('the phone previous/next buttons step the detail through the board order', async () => {
    renderAt('/EGX/symbols/COMI');
    await screen.findByTestId('detail-route');
    const rows = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const symbols = rows.map((row) => row.getAttribute('data-symbol'));
    const comiIndex = symbols.indexOf('COMI');

    fireEvent.click(screen.getByRole('button', { name: `Next: ${symbols[comiIndex + 1]}` }));
    await waitFor(() => expect(screen.getByTestId('detail-route').textContent).toBe(symbols[comiIndex + 1]));

    fireEvent.click(screen.getByRole('button', { name: 'Previous: COMI' }));
    await waitFor(() => expect(screen.getByTestId('detail-route').textContent).toBe('COMI'));
  });

  it('with no detail open, ArrowDown only moves focus', async () => {
    renderAt('/');
    const rows = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(rows[1]);
    expect(screen.queryByTestId('detail-route')).toBeNull();
  });

  it('"/" focuses the search box from the board, but is typed normally inside a field', async () => {
    renderAt('/');
    const rows = await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    const search = screen.getByRole('searchbox');

    rows[0]!.focus();
    const fromRow = fireEvent.keyDown(rows[0]!, { key: '/' });
    expect(document.activeElement).toBe(search);
    expect(fromRow).toBe(false); // default prevented: the "/" is not typed anywhere

    const inField = fireEvent.keyDown(search, { key: '/' });
    expect(inField).toBe(true); // left alone, so the character reaches the input
  });

  it('describes the keyboard model to screen readers, including Escape once the detail is open', async () => {
    renderAt('/EGX/symbols/COMI');
    await screen.findByTestId('detail-route');
    const table = screen.getByRole('grid', { name: 'Instruments' });
    const help = document.getElementById(table.getAttribute('aria-describedby')!);
    expect(help?.textContent).toMatch(/Arrow keys move between instruments/);
    expect(help?.textContent).toMatch(/Escape closes them/);
  });
});

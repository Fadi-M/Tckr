/**
 * A rejected `getUniverse()` must not leave the board on "Loading instruments…" forever:
 * it becomes an alert with a retry, and the retry fetches again and renders the board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

function renderWithFailingUniverse() {
  const { source } = makeFakeSource(loadUniverseFixture());
  const realGetUniverse = source.getUniverse.bind(source);
  const getUniverse = vi
    .fn<typeof source.getUniverse>()
    .mockRejectedValueOnce(new Error('network down'))
    .mockImplementation(realGetUniverse);
  mockGetSharedSource.mockReturnValue({ ...source, getUniverse });
  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );
  return { getUniverse, subscribe: source.subscribe };
}

describe('StockList universe fetch failure', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('replaces the loading line with an alert and subscribes to nothing', async () => {
    const { subscribe } = renderWithFailingUniverse();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load the instrument list');
    expect(screen.queryByText('Loading instruments…')).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('fetches again on "Try again" and renders the board', async () => {
    const { getUniverse } = renderWithFailingUniverse();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    const rows = (await screen.findAllByRole('row')).filter((row) =>
      row.hasAttribute('data-symbol'),
    );
    expect(rows).toHaveLength(34);
    expect(getUniverse).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

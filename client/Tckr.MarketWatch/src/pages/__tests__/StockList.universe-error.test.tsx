/**
 * A rejected `getUniverse()` must not leave the board on "Loading instruments…" forever:
 * it becomes an alert with a retry, and the retry fetches again and renders the board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { boardRows, loadUniverseFixture, makeFakeSource, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

async function renderWithFailingUniverse() {
  const { source } = makeFakeSource(loadUniverseFixture());
  const realGetUniverse = source.getUniverse.bind(source);
  const getUniverse = vi
    .fn<typeof source.getUniverse>()
    .mockRejectedValueOnce(new Error('network down'))
    .mockImplementation(realGetUniverse);
  await renderBoard({ source: { ...source, getUniverse } });
  return { getUniverse, subscribe: source.subscribe };
}

describe('StockList universe fetch failure', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('replaces the loading line with an alert and subscribes to nothing', async () => {
    const { subscribe } = await renderWithFailingUniverse();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load the instrument list');
    expect(screen.queryByText('Loading instruments…')).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('fetches again on "Try again" and renders the board', async () => {
    const { getUniverse } = await renderWithFailingUniverse();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });
    expect(boardRows()).toHaveLength(34);
    expect(getUniverse).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

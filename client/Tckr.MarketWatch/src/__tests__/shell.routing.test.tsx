/**
 * The app's routes: the board at `/`, the lazily loaded detail pane at
 * `/EGX/symbols/:symbol` (also reached from the pre-market-scoped `/symbols/:symbol`), and
 * anything else back to the board.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// `App` reaches uPlot through the lazy StockDetail; jsdom can't construct it.
vi.mock('uplot', async () => ({
  default: (await import('../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));

/** The lazy StockDetail chunk is imported on first use, which is slow on a loaded runner. */
const LAZY_CHUNK = { timeout: 4000 };

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('routing', () => {
  it.each(['/', '/nonsense'])('shows the board, and no detail, at %s', async (path) => {
    renderAt(path);
    await screen.findByPlaceholderText('Search symbol or name');
    expect(screen.queryByTestId('stock-detail-symbol')).toBeNull();
  });

  it.each(['/EGX/symbols/COMI', '/symbols/COMI'])('opens the COMI detail at %s', async (path) => {
    renderAt(path);
    // The board stays mounted beside the pane, so "COMI" also appears in its row and
    // a hero card: query the detail heading itself.
    const symbol = await screen.findByTestId('stock-detail-symbol', undefined, LAZY_CHUNK);
    expect(symbol.textContent).toBe('COMI');
  });
});

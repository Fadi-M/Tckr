/**
 * The app shell's skip link (critique 2026-09-26): the first Tab stop on every page,
 * ahead of the logo, landing on the board's current row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// `App` reaches uPlot through the lazy StockDetail; jsdom can't construct it.
vi.mock('uplot', async () => ({
  default: (await import('../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));

afterEach(cleanup);

describe('shell skip link', () => {
  it('is the first focusable element on the page and lands on a board row', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findAllByRole('row', { name: /^[A-Z]+,/ });

    const firstFocusable = document.querySelector<HTMLElement>(
      'a[href], button, input, [tabindex="0"]',
    );
    expect(firstFocusable?.textContent).toBe('Skip to instruments');

    fireEvent.click(firstFocusable!);
    expect(document.activeElement?.getAttribute('data-symbol')).not.toBeNull();
  });
});

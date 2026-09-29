import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';

// `App` reaches uPlot through the lazy StockDetail; jsdom can't construct it.
vi.mock('uplot', async () => ({
  default: (await import('../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));

afterEach(cleanup);

describe('header slots', () => {
  it('renders nodes passed as statusSlot and badgeSlot inside the header', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App
          statusSlot={<span data-testid="status-slot-content">connected</span>}
          badgeSlot={<span data-testid="badge-slot-content">LIVE</span>}
        />
      </MemoryRouter>,
    );

    const header = document.querySelector('header');
    expect(header).not.toBeNull();

    const statusNode = screen.getByTestId('status-slot-content');
    const badgeNode = screen.getByTestId('badge-slot-content');
    expect(header?.contains(statusNode)).toBe(true);
    expect(header?.contains(badgeNode)).toBe(true);
  });
});

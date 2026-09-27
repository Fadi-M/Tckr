/**
 * `RollingText.landing.test.tsx` — a changed figure rolls only the characters that
 * changed, the outgoing ones never reach the text a reader or a copy sees, and a landing
 * is not cut short by a re-render that doesn't change the value — but is dropped once it
 * has played, so moving the row (a re-sort) can't replay it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { PriceCell } from '../PriceCell.tsx';
import { changedFrom, LANDING_WINDOW_MS, SETTLE_MS, TickingText } from '../RollingText.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RollingText landing', () => {
  it('rolls from the first changed character, or the whole figure when its length changes', () => {
    expect(changedFrom('85.60', '85.64')).toBe(4);
    expect(changedFrom('+0.12%', '-0.03%')).toBe(0);
    expect(changedFrom('9.99', '10.01')).toBe(0);
  });

  it('keeps the outgoing digits out of the text content', () => {
    const { container, rerender } = render(<PriceCell value={toDecimal('85.60')} />);
    vi.advanceTimersByTime(SETTLE_MS);
    rerender(<PriceCell value={toDecimal('85.64')} />);
    const rolling = container.querySelector<HTMLElement>('[data-prev]');
    expect(rolling?.textContent).toBe('4');
    expect(rolling?.dataset.prev).toBe('0');
    expect(container.textContent).toBe('85.64');
  });

  it('keeps the landing through a re-render with the same value', () => {
    const { container, rerender } = render(<TickingText text="+0.12%" />);
    vi.advanceTimersByTime(SETTLE_MS);
    rerender(<TickingText text="+0.18%" />);
    rerender(<TickingText text="+0.18%" />);
    expect(container.querySelector('[data-prev]')?.getAttribute('data-prev')).toBe('2%');
  });

  it('drops a finished landing, so a later re-render or row move cannot replay it', () => {
    const { container, rerender } = render(<PriceCell value={toDecimal('85.60')} />);
    vi.advanceTimersByTime(SETTLE_MS);
    rerender(<PriceCell value={toDecimal('85.64')} />);
    vi.advanceTimersByTime(LANDING_WINDOW_MS + 1);
    rerender(<PriceCell value={toDecimal('85.64')} />);
    expect(container.querySelector('[data-prev]')).toBeNull();
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
  });

  it('does not animate replacing a figure nobody has had time to read', () => {
    // Opening a symbol paints its snapshot, then a tick queued while it loaded.
    const { container, rerender } = render(<PriceCell value={toDecimal('85.60')} />);
    rerender(<PriceCell value={toDecimal('85.64')} />);
    expect(container.querySelector('[data-prev]')).toBeNull();
    expect(container.textContent).toBe('85.64');
  });
});

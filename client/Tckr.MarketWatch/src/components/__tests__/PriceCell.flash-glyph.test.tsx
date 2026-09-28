/**
 * `PriceCell.flash-glyph.test.tsx` — a value change flashes the cell. By default the
 * flash also pulses a ▲/▼ glyph; `flashGlyph={false}` (the detail pane, whose change
 * pills already carry the direction) keeps the flash to its background tint only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';
import { PriceCell } from '../PriceCell.tsx';
import { SETTLE_MS } from '../RollingText.tsx';

// A figure has to have been on screen for `SETTLE_MS` before its replacement flashes.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function flashSpan(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[class*="animate-price-flash"]');
}

describe('PriceCell flash glyph', () => {
  it('pulses a ▲ with the flash by default', () => {
    const { container, rerender } = render(<PriceCell value={toDecimal('12.64')} />);
    vi.advanceTimersByTime(SETTLE_MS);
    rerender(<PriceCell value={toDecimal('12.70')} />);
    expect(flashSpan(container)?.className).toContain("before:content-['▲_']");
  });

  it('flashes the tint only with flashGlyph={false}', () => {
    const { container, rerender } = render(
      <PriceCell value={toDecimal('12.64')} flashGlyph={false} />,
    );
    vi.advanceTimersByTime(SETTLE_MS);
    rerender(<PriceCell value={toDecimal('12.58')} flashGlyph={false} />);
    const flash = flashSpan(container);
    expect(flash?.className).toContain('animate-price-flash-down');
    expect(flash?.className).not.toContain('before:content-');
  });
});

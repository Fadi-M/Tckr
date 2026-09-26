/**
 * Regression test for the `prefers-reduced-motion` guard on the card / stats
 * entrance animation.
 *
 * Post-Tailwind-migration, this is no longer an injected `<style>` tag with an
 * `@media (prefers-reduced-motion: reduce)` rule this test could grep for — the card
 * and stats containers instead carry Tailwind's `motion-reduce:animate-none` utility
 * class alongside their `animate-detail-reveal`/arbitrary-animation class, and the
 * actual media-query evaluation (whether that utility's declaration wins) happens in
 * the real browser's CSS engine, not in this component's code.
 *
 * jsdom does not implement `window.matchMedia` at all (see
 * `src/theme/__tests__/testSupport.ts`'s `stubMatchMedia` doc) and — more importantly
 * — does not evaluate real CSS, so it has no notion of which `@media` blocks apply or
 * which utility class "wins" a given viewer's media-query state. Stubbing
 * `matchMedia` here would therefore be theater: `StockDetail` never calls
 * `matchMedia` itself for this guard (unlike `theme.ts`'s system-preference
 * resolution, which genuinely branches on it at runtime), so a stub would not change
 * anything this component does or renders. What this test CAN honestly verify is the
 * one thing that actually matters for this guard to work at all in a real browser:
 * that the escape-hatch class is present, unconditionally, in the markup. This
 * mirrors the "acceptable" fallback the task brief calls out explicitly for exactly
 * this situation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { createFakeSource } from './testSupport.ts';

vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    cursor = { idx: null };
    data: [number[], number[]] = [[], []];
  }
  return { default: FakeUPlot };
});

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resetSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource, resetSharedSource } from '../../data/config.ts';
import { StockDetail } from '../StockDetail.tsx';

afterEach(cleanup);

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

describe('StockDetail prefers-reduced-motion guard', () => {
  it('gives both the card and the stats grid the motion-reduce:animate-none escape hatch', async () => {
    const { source } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { container } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    // Wait for the ready state so the stats grid (only rendered once `quote` is set)
    // is on the page too, not just the card.
    await screen.findByTestId('stock-detail-symbol');

    // The card is the element carrying `animate-detail-reveal` — queried by that
    // class rather than DOM position, since the wrapper nesting above it is an
    // implementation detail this test shouldn't depend on.
    const card = container.querySelector('.animate-detail-reveal');
    expect(card).toBeTruthy();
    expect(card!.className).toContain('motion-reduce:animate-none');

    const stats = await screen.findByTestId('stock-detail-footer');
    expect(stats.className).toContain('motion-reduce:animate-none');
  });
});

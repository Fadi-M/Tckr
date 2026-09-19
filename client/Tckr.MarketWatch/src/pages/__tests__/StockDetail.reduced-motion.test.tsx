/**
 * Regression test for the `prefers-reduced-motion` guard on `.tckr-detail__card` /
 * `.tckr-detail__stats`'s `tckr-detail-reveal` entrance animation.
 *
 * jsdom does not evaluate real CSS (no animation timing, no media-query-conditional
 * style application), so this cannot assert "the animation doesn't run" the way a
 * real browser test could. Instead — mirroring this file's own `<style>{DETAIL_STYLES}</style>`
 * mechanism — it asserts the stylesheet text the component actually emits contains
 * the `@media (prefers-reduced-motion: reduce)` guard verbatim, targeting both
 * animated selectors. This is a deliberately simple "don't silently delete this guard
 * again" regression test, not a claim about real browser rendering behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
  it('emits a @media (prefers-reduced-motion: reduce) rule disabling the reveal animation on both animated selectors', () => {
    const { source } = createFakeSource();
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { container } = render(
      <MemoryRouter>
        <StockDetail symbol="COMI" />
      </MemoryRouter>,
    );

    const styleTags = Array.from(container.querySelectorAll('style'));
    const detailStyles = styleTags.find((tag) => tag.textContent?.includes('tckr-detail-reveal'));
    expect(detailStyles).toBeDefined();

    const css = detailStyles!.textContent ?? '';
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tckr-detail__card,\s*\.tckr-detail__stats\s*\{\s*animation:\s*none;\s*\}\s*\}/,
    );
  });
});

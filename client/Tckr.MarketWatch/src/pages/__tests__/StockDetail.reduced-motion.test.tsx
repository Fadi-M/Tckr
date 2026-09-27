/**
 * The detail pane's arrival under `prefers-reduced-motion`.
 *
 * Two mechanisms, two checks. The panel's glass fades up with a CSS animation, whose
 * `motion-reduce:animate-none` escape hatch only a real browser's CSS engine evaluates,
 * so the honest check is that the class is in the markup. The figures on it land with
 * a GSAP stagger (`useMotion`), which decides in code through `prefersReducedMotion()`,
 * so there the test stubs `matchMedia` and checks that nothing was ever set on them —
 * with the unreduced case as the control, proving the check can fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import { flushMotion, stubReducedMotion, unstubReducedMotion } from '../../motion/__tests__/motionTestSupport.ts';
import { createFakeSource } from './testSupport.ts';

vi.mock('uplot', () => {
  class FakeUPlot {
    setData = vi.fn();
    destroy = vi.fn();
    setSize = vi.fn();
    redraw = vi.fn();
    root = document.createElement('div');
    over = document.createElement('div');
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

afterEach(() => {
  cleanup();
  unstubReducedMotion();
});

beforeEach(() => {
  resetStore();
  resetSharedSource();
});

async function renderReady() {
  const { source } = createFakeSource();
  vi.mocked(getSharedSource).mockReturnValue(source);
  const view = render(
    <MemoryRouter>
      <StockDetail symbol="COMI" />
    </MemoryRouter>,
  );
  // The stat tiles only render once `quote` is set.
  await screen.findByTestId('stock-detail-footer');
  await flushMotion();
  return view;
}

function touchedByMotion(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-reveal]')).filter((el) => (el as HTMLElement).style.opacity !== '');
}

describe('StockDetail prefers-reduced-motion guard', () => {
  it('gives the panel glass the motion-reduce:animate-none escape hatch', async () => {
    const { container } = await renderReady();
    const card = container.querySelector('.animate-detail-reveal');
    expect(card).toBeTruthy();
    expect(card!.className).toContain('motion-reduce:animate-none');
  });

  it('lands the figures with no motion at all under reduced motion', async () => {
    stubReducedMotion(true);
    const { container } = await renderReady();
    expect(container.querySelectorAll('[data-reveal="figures"]').length).toBeGreaterThan(0);
    expect(touchedByMotion(container)).toEqual([]);
  });

  it('staggers the figures in otherwise (the control for the check above)', async () => {
    stubReducedMotion(false);
    const { container } = await renderReady();
    expect(touchedByMotion(container).length).toBeGreaterThan(0);
  });
});

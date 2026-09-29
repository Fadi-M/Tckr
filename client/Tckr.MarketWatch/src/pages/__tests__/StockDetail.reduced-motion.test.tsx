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
import { cleanup, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import {
  flushMotion,
  stubReducedMotion,
  unstubReducedMotion,
} from '../../motion/__tests__/motionTestSupport.ts';
import { createFakeSource, renderDetail } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

afterEach(() => {
  cleanup();
  unstubReducedMotion();
});

beforeEach(resetStore);

async function renderReady() {
  const view = await renderDetail(<StockDetail symbol="COMI" />, createFakeSource().source);
  // The stat tiles only render once `quote` is set.
  await screen.findByTestId('stock-detail-footer');
  await flushMotion();
  return view;
}

function touchedByMotion(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-reveal]')).filter(
    (el) => (el as HTMLElement).style.opacity !== '',
  );
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

/**
 * `FormingCandle` — the Tckr mark drawing itself. Whatever it animates, it must finish
 * on the logo's exact geometry (the mark is the brand; a forming candle that settles a
 * pixel off is a different logo), and it is the static mark under reduced motion.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TckrMark } from '../../components/TckrLogo.tsx';
import { FormingCandle } from '../FormingCandle.tsx';
import { finishMotion, flushMotion, primeMotion, stubReducedMotion, resetMotion, unstubReducedMotion } from './motionTestSupport.ts';

beforeEach(primeMotion);

afterEach(async () => {
  cleanup();
  unstubReducedMotion();
  await resetMotion();
});

/** Each part's geometry, as the resting logo draws it. */
function geometry(root: Element): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const rect of root.querySelectorAll('[data-candle]')) {
    parts[rect.getAttribute('data-candle')!] = ['y', 'height'].map((attr) => rect.getAttribute(attr)).join(',');
  }
  return parts;
}

function restingGeometry(): Record<string, string> {
  const { container } = render(<TckrMark height={18} />);
  const parts = geometry(container);
  cleanup();
  return parts;
}

describe('FormingCandle', () => {
  it('draws from a collapsed candle and lands on the exact logo geometry', async () => {
    const resting = restingGeometry();
    stubReducedMotion(false);
    const { container } = render(<FormingCandle height={18} />);
    // The first frame is the collapsed candle, never the finished mark.
    expect(geometry(container)['body']).not.toBe(resting['body']);
    await finishMotion();
    expect(geometry(container)).toEqual(resting);
  });

  it('is the static mark under reduced motion', async () => {
    const resting = restingGeometry();
    stubReducedMotion(true);
    const { container } = render(<FormingCandle height={18} />);
    await flushMotion();
    expect(geometry(container)).toEqual(resting);
  });
});

/**
 * `ScrambleWord` — a label that resolves from its old text to its new one. It must end
 * on exactly the new text, never scramble without a `from` (first paint) or under
 * reduced motion, and keep its intermediate strings out of the accessibility tree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScrambleWord } from '../ScrambleWord.tsx';
import { finishMotion, flushMotion, primeMotion, stubReducedMotion, resetMotion, unstubReducedMotion } from './motionTestSupport.ts';

beforeEach(primeMotion);

afterEach(async () => {
  cleanup();
  unstubReducedMotion();
  await resetMotion();
});

describe('ScrambleWord', () => {
  it('is plain text, untouched, without a from (first paint)', async () => {
    render(<ScrambleWord text="LIVE" />);
    await flushMotion();
    expect(screen.getByText('LIVE').getAttribute('aria-hidden')).toBe('true');
  });

  it('scrambles out of the old word and ends on exactly the new one', async () => {
    stubReducedMotion(false);
    const { container } = render(<ScrambleWord text="DELAYED" from="LIVE" />);
    const word = container.querySelector('span')!;
    // Scrambling from the first frame: neither the old word nor the new one yet.
    expect(word.textContent).not.toBe('LIVE');
    expect(word.textContent).not.toBe('DELAYED');
    await finishMotion();
    expect(word.textContent).toBe('DELAYED');
  });

  it('never scrambles under reduced motion', async () => {
    stubReducedMotion(true);
    const { container } = render(<ScrambleWord text="DELAYED" from="LIVE" />);
    await flushMotion();
    expect(container.querySelector('span')!.textContent).toBe('DELAYED');
  });

  it('ignores a from that arrives after mount, so a re-render never replays it', async () => {
    stubReducedMotion(false);
    const { container, rerender } = render(<ScrambleWord text="LIVE" />);
    rerender(<ScrambleWord text="LIVE" from="DELAYED" />);
    await flushMotion();
    expect(container.querySelector('span')!.textContent).toBe('LIVE');
  });
});

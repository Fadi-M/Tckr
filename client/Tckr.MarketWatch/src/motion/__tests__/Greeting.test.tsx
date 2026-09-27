/**
 * The greeting's contract with the page it plays over. However it looks, it must: stay
 * out of the accessibility tree; hide the header's lockup only while its own lockup is
 * on the way there, and always give it back; step aside on any key, click, tap or
 * scroll; record that today was greeted; and, under reduced motion, never touch the
 * header at all. jsdom paints nothing, so these drive the timelines to their ends
 * (`finishMotion`) and check what is left.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TckrLogo } from '../../components/TckrLogo.tsx';
import { Greeting } from '../Greeting.tsx';
import { shouldGreetToday } from '../greetingSchedule.ts';
import { finishMotion, primeMotion, resetMotion, stubReducedMotion, unstubReducedMotion } from './motionTestSupport.ts';

beforeEach(primeMotion);

afterEach(async () => {
  cleanup();
  unstubReducedMotion();
  window.localStorage.clear();
  await resetMotion();
});

function renderOverPage(onDone = vi.fn()) {
  render(
    <>
      <header>
        <TckrLogo size={24} />
      </header>
      <main>
        <p>The board</p>
      </main>
      <Greeting onDone={onDone} />
    </>,
  );
  return { onDone, headerLogo: document.querySelector<HTMLElement>('header [data-tckr-logo]')! };
}

/** The introduction's end starts the hand-off, a second timeline: finish both. */
async function playThrough() {
  await finishMotion();
  await finishMotion();
}

describe('Greeting', () => {
  it('is decorative: hidden from assistive technology, the page beneath still there', () => {
    stubReducedMotion(false);
    renderOverPage();
    expect(screen.getByTestId('tckr-greeting').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('The board')).toBeTruthy();
  });

  it("hides the header's lockup while its own flies there, then gives it back and finishes", async () => {
    stubReducedMotion(false);
    const { onDone, headerLogo } = renderOverPage();
    expect(headerLogo.style.opacity).toBe('0');
    await playThrough();
    expect(headerLogo.style.opacity).toBe('');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('records today as greeted as soon as it starts', () => {
    stubReducedMotion(false);
    expect(shouldGreetToday(Date.now(), '', false)).toBe(true);
    renderOverPage();
    expect(shouldGreetToday(Date.now(), '', false)).toBe(false);
  });

  it('steps aside on a key press: the rest of the introduction plays through, then the hand-off', async () => {
    stubReducedMotion(false);
    const { onDone, headerLogo } = renderOverPage();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await playThrough();
    await playThrough();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(headerLogo.style.opacity).toBe('');
  });

  it('under reduced motion, never hides the header and simply fades away', async () => {
    stubReducedMotion(true);
    const { onDone, headerLogo } = renderOverPage();
    expect(headerLogo.style.opacity).toBe('');
    await playThrough();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('gives the header its lockup back if it is torn down mid-performance', () => {
    stubReducedMotion(false);
    const { headerLogo } = renderOverPage();
    expect(headerLogo.style.opacity).toBe('0');
    cleanup();
    expect(headerLogo.style.opacity).toBe('');
  });
});

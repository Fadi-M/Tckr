/**
 * Shared helpers for this directory's theme tests. jsdom (unlike a real browser) does
 * not implement `window.matchMedia` at all — see `theme.ts`'s `getSystemTheme` try/catch,
 * written for exactly that — so any test exercising system-preference resolution needs a
 * stub. Storage-unavailable tests (private-mode Safari, quota exceeded, etc.) need a way
 * to force `localStorage.getItem`/`setItem` to throw without depending on a real browser
 * condition to reproduce it.
 */
import { vi } from 'vitest';

/** Replaces `window.matchMedia` with a stub that reports `matches` for every query —
 * good enough for `theme.ts`, which only ever queries `(prefers-color-scheme: dark)`.
 * Pair with `unstubMatchMedia` in `afterEach`; not covered by vitest.config.ts's
 * `restoreMocks: true`, which only restores `vi.fn`/`vi.spyOn` mocks, not a property
 * jsdom never defined in the first place. */
export function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

/** Undoes `stubMatchMedia`, restoring jsdom's own "not implemented" state so a test that
 * forgets to stub it still exercises the real `try/catch` fallback. */
export function unstubMatchMedia(): void {
  Reflect.deleteProperty(window, 'matchMedia');
}

/** Replaces `window.localStorage` with a `Storage` whose every method throws, simulating
 * private-mode Safari / quota-exceeded / storage-disabled contexts. Returns a restore
 * function that puts the real `localStorage` back — call it in `afterEach` so later tests
 * still get a working store. */
export function stubThrowingLocalStorage(): () => void {
  const original = window.localStorage;
  const throwing: Storage = {
    length: 0,
    getItem: () => {
      throw new Error('localStorage disabled');
    },
    setItem: () => {
      throw new Error('localStorage disabled');
    },
    removeItem: () => {
      throw new Error('localStorage disabled');
    },
    clear: () => {
      throw new Error('localStorage disabled');
    },
    key: () => {
      throw new Error('localStorage disabled');
    },
  };
  Object.defineProperty(window, 'localStorage', { value: throwing, configurable: true });
  return () => {
    Object.defineProperty(window, 'localStorage', { value: original, configurable: true });
  };
}

/**
 * `resolveInitialTheme`'s order: the user's stored choice wins over the system
 * `prefers-color-scheme`, whichever way the system points; with no stored choice the
 * system decides; and with no `matchMedia` at all it's light. index.html's pre-paint
 * script duplicates this order (see theme.ts's module doc).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSystemTheme, resolveInitialTheme, THEME_STORAGE_KEY } from '../theme.ts';
import { stubMatchMedia, unstubMatchMedia } from './testSupport.ts';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  unstubMatchMedia();
});

describe('resolveInitialTheme', () => {
  it.each([
    ['dark', false],
    ['light', true],
  ] as const)('a stored "%s" wins over the opposite system preference', (stored, systemDark) => {
    localStorage.setItem(THEME_STORAGE_KEY, stored);
    stubMatchMedia(systemDark);
    expect(resolveInitialTheme()).toBe(stored);
  });

  it.each([
    [true, 'dark'],
    [false, 'light'],
  ] as const)('with nothing stored, follows the system (dark: %s → %s)', (systemDark, expected) => {
    stubMatchMedia(systemDark);
    expect(getSystemTheme()).toBe(expected);
    expect(resolveInitialTheme()).toBe(expected);
  });

  it('defaults to light when matchMedia is unavailable', () => {
    unstubMatchMedia(); // jsdom never implements it
    expect(getSystemTheme()).toBe('light');
    expect(resolveInitialTheme()).toBe('light');
  });
});

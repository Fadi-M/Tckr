/**
 * `resolveInitialTheme`/`getSystemTheme` with no stored preference at all — falls back
 * to whatever `(prefers-color-scheme: dark)` reports, in both directions, and to
 * `'light'` specifically (not merely "whatever the fallback is") when `matchMedia` isn't
 * available, per theme.ts's module doc on why light — not dark — is the fallback since
 * the Frosted Glass Revamp design.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSystemTheme, resolveInitialTheme } from '../theme.ts';
import { stubMatchMedia, unstubMatchMedia } from './testSupport.ts';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  unstubMatchMedia();
});

describe('resolveInitialTheme / getSystemTheme — no stored preference', () => {
  it('falls back to a "dark" system preference', () => {
    stubMatchMedia(true);

    expect(getSystemTheme()).toBe('dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('falls back to a "light" system preference', () => {
    stubMatchMedia(false);

    expect(getSystemTheme()).toBe('light');
    expect(resolveInitialTheme()).toBe('light');
  });

  it('defaults to "light" when matchMedia throws or is unavailable', () => {
    unstubMatchMedia(); // jsdom never implements matchMedia in the first place

    expect(getSystemTheme()).toBe('light');
    expect(resolveInitialTheme()).toBe('light');
  });
});

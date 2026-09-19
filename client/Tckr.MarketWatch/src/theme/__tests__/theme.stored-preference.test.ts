/**
 * `resolveInitialTheme`'s resolution order: a stored preference (whatever the user
 * explicitly chose last time) must win over the system `prefers-color-scheme`
 * preference, regardless of which way the system preference points — see theme.ts's
 * module doc for why index.html's inline script must (and does) duplicate this exact
 * order.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInitialTheme, THEME_STORAGE_KEY } from '../theme.ts';
import { stubMatchMedia, unstubMatchMedia } from './testSupport.ts';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  unstubMatchMedia();
});

describe('resolveInitialTheme — stored preference wins', () => {
  it('a stored "dark" preference wins over a "light" system preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    stubMatchMedia(false); // system: light

    expect(resolveInitialTheme()).toBe('dark');
  });

  it('a stored "light" preference wins over a "dark" system preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    stubMatchMedia(true); // system: dark

    expect(resolveInitialTheme()).toBe('light');
  });
});

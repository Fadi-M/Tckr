/**
 * `applyTheme`: the one function that ever sets `data-theme` on `document.documentElement`
 * (the attribute every `tokens.css` scope keys off — see theme.ts's module doc) and
 * persists the choice to `localStorage` so it survives a reload. Also covers the
 * private-mode/quota-exceeded path: a throwing `localStorage` must not stop the
 * attribute from being applied, and must not throw out of `applyTheme` itself.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getAppliedTheme, THEME_STORAGE_KEY } from '../theme.ts';
import { stubThrowingLocalStorage } from './testSupport.ts';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('applyTheme', () => {
  it('sets data-theme on document.documentElement', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists the choice to localStorage under THEME_STORAGE_KEY', () => {
    applyTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('getAppliedTheme reflects whatever applyTheme last set, without re-resolving', () => {
    applyTheme('dark');
    expect(getAppliedTheme()).toBe('dark');
  });

  it('a throwing localStorage does not crash applyTheme — the attribute still applies', () => {
    const restore = stubThrowingLocalStorage();
    try {
      expect(() => applyTheme('dark')).not.toThrow();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(getAppliedTheme()).toBe('dark');
    } finally {
      restore();
    }
  });
});

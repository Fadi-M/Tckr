/**
 * `applyTheme` is the one function that sets `data-theme` (the attribute every
 * `tokens.css` scope keys off) and persists the choice, so it survives a reload. A
 * throwing `localStorage` (private mode, quota) must not stop the theme applying.
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
  it('sets data-theme, persists it, and reports it back', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getAppliedTheme()).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('still applies the theme when localStorage throws', () => {
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

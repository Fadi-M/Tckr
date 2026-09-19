/**
 * React binding for `theme.ts` — the reusable piece any component wanting to read or
 * flip the light/dark theme should use, rather than touching `document` or
 * `localStorage` directly. `../components/ThemeToggle.tsx` is the only current
 * consumer, but this hook supports more than one mounted instance agreeing with each
 * other (see the `MutationObserver` below) without a Context provider: the DOM
 * attribute *is* the shared state, so every instance just watches it.
 */
import { useCallback, useEffect, useState } from 'react';
import { applyTheme, getAppliedTheme, type ThemeName } from './theme.ts';

export interface UseThemeResult {
  readonly theme: ThemeName;
  readonly setTheme: (theme: ThemeName) => void;
  readonly toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  // Initializes from whatever is already applied to the document — index.html's
  // inline script has already run by the time React mounts — rather than resolving a
  // preference of its own, so this can never disagree with the DOM or cause a flash.
  const [theme, setThemeState] = useState<ThemeName>(getAppliedTheme);

  const setTheme = useCallback((next: ThemeName) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Stay in sync if the theme changes from elsewhere — another mounted `useTheme()`
  // instance, or a future settings page — by watching the one shared source of truth
  // (the DOM attribute) rather than inventing a second, bespoke pub/sub mechanism.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeState(getAppliedTheme());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return { theme, setTheme, toggleTheme };
}

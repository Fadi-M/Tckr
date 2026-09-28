/**
 * React binding for `theme.ts` — the reusable piece any component wanting to read or
 * flip the light/dark theme should use, rather than touching `document` or
 * `localStorage` directly. `../components/ThemeToggle.tsx` is the only current
 * consumer, but this hook supports more than one mounted instance agreeing with each
 * other (see the `MutationObserver` below) without a Context provider: the DOM
 * attribute *is* the shared state, so every instance just watches it.
 */
import { useCallback, useEffect, useState } from 'react';
import { runViewTransition } from '../components/viewTransition.ts';
import { applyTheme, getAppliedTheme, type ThemeName } from './theme.ts';

export interface UseThemeResult {
  readonly theme: ThemeName;
  readonly setTheme: (theme: ThemeName) => void;
  readonly toggleTheme: () => void;
}

const SWITCHING_CLASS = 'tckr-theme-switching';
const TRANSITION_CLASS = 'tckr-theme-transition';

/**
 * Applies a user-initiated theme switch as one change. Without this, every element
 * with its own colour transition (chips, pills, rows) faded on its own schedule, so for
 * ~200ms parts of the page showed the old theme's background behind the new theme's
 * text. `SWITCHING_CLASS` suppresses those per-element transitions (see tailwind.css)
 * for the duration of the switch. The whole page — header included, since every
 * surface changes colour — cross-fades once (280ms) in a document-scoped view
 * transition; where that can't run (no API, reduced motion) the switch is instant.
 */
function switchThemeSmoothly(apply: () => void): void {
  const root = document.documentElement;
  root.classList.add(SWITCHING_CLASS, TRANSITION_CLASS);
  const transition = runViewTransition(document, apply);
  if (transition) {
    void transition.finished.finally(() =>
      root.classList.remove(SWITCHING_CLASS, TRANSITION_CLASS),
    );
    return;
  }
  root.classList.remove(TRANSITION_CLASS);
  // Two frames: one for the new colours to be computed and painted without
  // transitions, one more before transitions are allowed again.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(SWITCHING_CLASS)));
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
    const next = theme === 'dark' ? 'light' : 'dark';
    switchThemeSmoothly(() => setTheme(next));
  }, [theme, setTheme]);

  // Stay in sync if the theme changes from elsewhere — another mounted `useTheme()`
  // instance, or a future settings page — by watching the one shared source of truth
  // (the DOM attribute) rather than inventing a second, bespoke pub/sub mechanism.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeState(getAppliedTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return { theme, setTheme, toggleTheme };
}

/**
 * Theme persistence + system-preference resolution — the single source of truth for
 * "light" vs "dark", independent of React (see `useTheme.ts` for the hook,
 * `../components/ThemeToggle.tsx` for the UI). Applies via `document.documentElement`'s
 * `data-theme` attribute, the same attribute `src/styles/tokens.css`'s three token
 * scopes already key off (see that file's doc comment) — this module never invents a
 * second theming mechanism, it only ever flips the one attribute every token scope
 * already reacts to.
 *
 * `index.html` has a small inline script that resolves and applies the *initial* theme
 * using this same storage key and the same "stored, else system preference" order,
 * necessarily duplicated there (a `<script type="module">` importing this file would
 * not run before first paint, defeating the point) so the page never flashes the wrong
 * theme before React mounts. Keep the two in sync if this file's resolution order ever
 * changes.
 *
 * The Frosted Glass Revamp design import (`Tckr.MarketWatch Frosted Glass
 * Revamp/Tckr Market Watch.dc.html`) is a light-themed design — light is therefore the
 * fallback here and in index.html, not dark (which `tokens.css` had defaulted to
 * before this design pass, back when the "Tckr First Run" dark look was primary).
 */

export type ThemeName = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tckr-theme';

function isThemeName(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark';
}

/** Whatever the user explicitly chose last time, if anything and if readable —
 * private-browsing/storage-disabled contexts can throw on access, not just return
 * `null`, hence the guard. */
export function getStoredTheme(): ThemeName | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The OS/browser's own preference. Defaults to `'light'` when unreadable or the
 * media query simply doesn't match — see the module doc for why light, not dark, is
 * the fallback. */
export function getSystemTheme(): ThemeName {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Stored preference wins; otherwise the system preference. */
export function resolveInitialTheme(): ThemeName {
  return getStoredTheme() ?? getSystemTheme();
}

/** The theme actually applied to the document right now — reads the DOM attribute
 * rather than recomputing a preference, so it always agrees with whatever
 * index.html's inline script (or a previous `applyTheme` call) actually set, even
 * before this module has otherwise run. */
export function getAppliedTheme(): ThemeName {
  const attr = document.documentElement.getAttribute('data-theme');
  return isThemeName(attr) ? attr : resolveInitialTheme();
}

/** Sets the `data-theme` attribute — the one thing every token scope in tokens.css
 * keys off — and persists the choice so it survives a reload. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
  // Several surfaces on this page (header, banners, table, hero cards, chart) use
  // `backdrop-filter`, which Chromium/WebKit promote to their own GPU compositing
  // layer. Some browser versions are known not to reliably repaint an *already
  // composited* backdrop-filter layer purely from a custom-property/attribute
  // change on an ancestor, particularly for a layer that is currently scrolled out
  // of the viewport — it only catches up on the next unrelated repaint (e.g. the
  // next tick's flash animation), which reads as "the old theme persists below the
  // fold until something else redraws it." Reading `offsetHeight` synchronously
  // forces a layout + paint pass right here, for every layer, regardless of scroll
  // position, closing that gap. Cheap (one synchronous reflow) and harmless to run
  // on every toggle.
  void document.body.offsetHeight;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage disabled/unavailable (private mode, quota, etc.) — the attribute above
    // still applies for this session; it just won't survive a reload. Not worth
    // surfacing as an error for a purely cosmetic preference.
  }
}

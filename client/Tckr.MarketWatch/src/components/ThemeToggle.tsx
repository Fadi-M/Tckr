/**
 * Light/dark theme switch — rendered directly by `App.tsx` in the header's slot row,
 * alongside `ConnectionStatus`/`StreamBadge`. Unlike those two, this needs no
 * data-layer wiring (`useTheme` touches only `document`/`localStorage`), so it does
 * not need to go through `main.tsx`'s composition-root slot-prop treatment — App.tsx
 * can import and render it directly without violating its own data-agnosticism
 * (`shell.no-data-import.test.ts` only forbids importing `src/data/**`).
 *
 * Presentation only — all state lives in `../theme/useTheme.ts`.
 */
import { useTheme } from '../theme/useTheme.ts';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      className="tckr-theme-toggle"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
    </button>
  );
}

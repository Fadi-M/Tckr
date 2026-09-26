/**
 * Light/dark theme switch — rendered directly by `App.tsx` in the header's slot row,
 * alongside `ConnectionStatus` (and, historically, `StreamBadge`, since deleted as
 * dead code). Unlike `ConnectionStatus`, this needs no data-layer wiring (`useTheme`
 * touches only `document`/`localStorage`), so it does
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
      className="appearance-none box-border inline-flex items-center justify-center w-[30px] h-[30px] rounded-full border border-glass-border bg-glass text-text text-sm leading-none cursor-pointer outline-none transition-[transform,border-color] duration-[150ms] fine-hover:border-accent active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
    </button>
  );
}

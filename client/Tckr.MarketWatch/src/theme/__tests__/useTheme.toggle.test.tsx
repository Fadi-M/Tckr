/**
 * `ThemeToggle` (the only current consumer of `useTheme`) end to end: clicking it must
 * flip `data-theme` on `document.documentElement` AND persist the new value to
 * `localStorage`, matching `applyTheme`'s contract (see theme.apply-persist.test.ts for
 * that function in isolation — this file proves the hook + button wire it up correctly).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { THEME_STORAGE_KEY } from '../theme.ts';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('flips data-theme on document.documentElement when clicked', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists the new value to localStorage when clicked', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('reflects the flipped state in its accessible label and pressed state', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });

    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);

    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBe(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});

/**
 * `ThemeToggle` wires `useTheme` to `applyTheme` end to end: a click flips `data-theme`,
 * persists it, and updates the button's name and pressed state.
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
  it('flips and persists the theme, and says which way it will switch next', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBe(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

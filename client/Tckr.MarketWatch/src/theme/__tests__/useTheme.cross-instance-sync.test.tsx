/**
 * `useTheme`'s `MutationObserver`-based sync (see useTheme.ts's doc comment): with no
 * Context provider, two independently mounted `useTheme()` consumers must still agree,
 * because both watch the one shared source of truth — the `data-theme` attribute on
 * `document.documentElement` — rather than owning independent state. This mounts two
 * `ThemeToggle`s side by side and proves that toggling one updates the other's rendered
 * state too, not just the DOM attribute both happen to read from on mount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useTheme — cross-instance sync', () => {
  it('a second mounted instance picks up a data-theme change made by the first', async () => {
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    const [first, second] = buttons as [HTMLElement, HTMLElement];
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(second.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(first);

    // The MutationObserver callback fires as a microtask after the attribute change,
    // not synchronously inside the click handler — `waitFor` polls until it has.
    await waitFor(() => {
      expect(second.getAttribute('aria-pressed')).toBe('true');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('a change made directly on the DOM (e.g. another tab via storage, or a settings page) is also observed', async () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    document.documentElement.setAttribute('data-theme', 'dark');

    await waitFor(() => {
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });
  });
});

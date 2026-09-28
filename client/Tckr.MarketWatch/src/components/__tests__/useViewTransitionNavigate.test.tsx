/**
 * `useViewTransitionNavigate` — navigation transitions run on the provided transition
 * scope (App's <main>), never on the document, so the header outside the scope is
 * never snapshotted or covered by the transition's layers. Without a provider they
 * fall back to the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TransitionScopeContext } from '../transitionScope.ts';
import { useViewTransitionNavigate } from '../useViewTransitionNavigate.ts';

let navigateTo: (to: string) => void = () => {};
let currentPath = '';

function Probe() {
  navigateTo = useViewTransitionNavigate();
  currentPath = useLocation().pathname;
  return null;
}

function fakeStart() {
  return vi.fn((update: () => Promise<void> | void) => {
    void update();
    return { finished: Promise.resolve() } as unknown as ViewTransition;
  });
}

const documentStart = fakeStart();
const scopeStart = fakeStart();

function Scoped({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLElement | null>(null);
  return (
    <TransitionScopeContext.Provider value={scopeRef}>
      <main
        ref={(el) => {
          scopeRef.current = el;
          if (el) {
            el.startViewTransition = scopeStart;
          }
        }}
      >
        {children}
      </main>
    </TransitionScopeContext.Provider>
  );
}

beforeEach(() => {
  documentStart.mockClear();
  scopeStart.mockClear();
  Object.defineProperty(document, 'startViewTransition', {
    value: documentStart,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe('useViewTransitionNavigate', () => {
  it.each([
    ['opening a symbol', '/', '/EGX/symbols/COMI'],
    ['switching symbols', '/EGX/symbols/COMI', '/EGX/symbols/CIB'],
    ['closing the detail', '/EGX/symbols/COMI', '/'],
  ])('animates %s on the scope element, not the document', (_label, from, to) => {
    render(
      <MemoryRouter initialEntries={[from]}>
        <Scoped>
          <Probe />
        </Scoped>
      </MemoryRouter>,
    );
    act(() => navigateTo(to));
    expect(scopeStart).toHaveBeenCalledTimes(1);
    expect(documentStart).not.toHaveBeenCalled();
    expect(currentPath).toBe(to);
  });

  it('falls back to a document transition when no scope is provided', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    );
    act(() => navigateTo('/EGX/symbols/COMI'));
    expect(documentStart).toHaveBeenCalledTimes(1);
    expect(currentPath).toBe('/EGX/symbols/COMI');
  });
});

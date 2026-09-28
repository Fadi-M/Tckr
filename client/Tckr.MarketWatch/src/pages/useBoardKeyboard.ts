/**
 * The board page's keyboard behaviour outside the table itself, split out of `StockList`.
 * (Arrow-key movement between rows stays with the table, in `StockList`.)
 */
import { useEffect, useRef, type RefObject } from 'react';
import { isEditableTarget } from '../components/keyboard.ts';
import type { useViewTransitionNavigate } from '../components/useViewTransitionNavigate.ts';
import { DETAIL_HEADING_ID } from './pageAnchors.ts';

/**
 *  Page shortcuts: ⌘K / Ctrl+K and "/" focus the search box; Escape closes the open
 *  detail pane. None of them fire while the user is typing in a field, where Escape
 *  already means "clear this field" and "/" is a character.
 */
export function useBoardShortcuts(
  searchInputRef: RefObject<HTMLInputElement | null>,
  selectedSymbol: string | null,
  navigate: ReturnType<typeof useViewTransitionNavigate>,
): void {
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && selectedSymbol !== null) {
        event.preventDefault();
        navigate('/');
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [searchInputRef, navigate, selectedSymbol]);
}

/**
 *  Keeps keyboard focus somewhere visible whenever the detail opens, switches or
 *  closes — however that happened (a row, Escape, the pane's close button, the logo).
 *  Only steps in when the focused element has gone: opening hides the list column
 *  below 800px (focus moves to the detail's heading), and closing unmounts the pane
 *  (focus returns to the row of the symbol that was open). On desktop a focused row
 *  stays visible and keeps focus, so the arrow keys keep browsing the board.
 */
export function useDetailFocusRestore(
  tbodyRef: RefObject<HTMLTableSectionElement | null>,
  selectedSymbol: string | null,
): void {
  const previousSelectedRef = useRef(selectedSymbol);
  useEffect(() => {
    const previous = previousSelectedRef.current;
    previousSelectedRef.current = selectedSymbol;
    const id = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const focusLost = !active || active === document.body || active.getClientRects().length === 0;
      if (!focusLost) {
        return;
      }
      if (selectedSymbol !== null) {
        document.getElementById(DETAIL_HEADING_ID)?.focus();
      } else if (previous !== null) {
        tbodyRef.current
          ?.querySelector<HTMLTableRowElement>(`tr[data-symbol="${CSS.escape(previous)}"]`)
          ?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [tbodyRef, selectedSymbol]);
}

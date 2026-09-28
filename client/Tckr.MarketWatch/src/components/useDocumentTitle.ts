import { useEffect } from 'react';

/** The static `<title>` in index.html, used on every page that sets no title of its own. */
export const APP_TITLE = 'Tckr MarketWatch';

/**
 * Sets `document.title` while the calling component is mounted and restores whatever it
 * replaced on unmount, so a tab and its history entry name the open instrument rather
 * than always reading "Tckr MarketWatch" (the page context a screen reader announces on
 * navigation). Deliberately not the live price: a title that changes on every beat
 * floods tab strips and history.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

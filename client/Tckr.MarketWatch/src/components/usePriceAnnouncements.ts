import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'tckr-announce-price';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Whether the detail view announces its price through a polite live region. Off by
 * default: an unrequested stream of announcements would drown out everything else a
 * screen-reader user does on the page, which is also why the board never announces rows.
 * The choice is remembered on this device (a per-viewer convenience; storage failures
 * just mean it resets to off).
 */
export function usePriceAnnouncements(): readonly [boolean, () => void] {
  const [enabled, setEnabled] = useState(readStored);
  const toggle = useCallback(() => setEnabled((previous) => !previous), []);
  // Persisted after commit, not inside the updater: updaters must stay pure (StrictMode
  // runs them twice, and a discarded render must not write).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Storage unavailable (private mode, blocked site data): the toggle still works for this visit.
    }
  }, [enabled]);
  return [enabled, toggle] as const;
}

/**
 * Small, shared keyboard facts, so every shortcut in the app reads them the same way.
 */

/** macOS / iOS / iPadOS, where the command key (⌘) is the shortcut modifier;
 * everywhere else it is Ctrl. Prefers the User-Agent Client Hints platform where the
 * browser has it, falling back to the older `navigator.platform`. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  return /mac|iphone|ipad|ipod/i.test(hinted ?? navigator.platform ?? '');
}

/** How to write the shortcut modifier on this platform: "⌘" or "Ctrl". */
export function modifierKeyLabel(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl';
}

/** True when a key press belongs to the field it was typed into (a text input, textarea,
 * select or editable region), so a page-level shortcut must leave it alone — Escape
 * clears a search box, "/" is typed into it. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

/** `keyboard.ts` — the shared shortcut facts: the platform's modifier key, and when a
 * key press belongs to a field rather than to a page shortcut. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEditableTarget, modifierKeyLabel } from '../keyboard.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('modifierKeyLabel', () => {
  it('is ⌘ on Apple platforms and Ctrl elsewhere', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(modifierKeyLabel()).toBe('⌘');
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(modifierKeyLabel()).toBe('Ctrl');
  });

  it('prefers the Client Hints platform when the browser has it', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgentData: { platform: 'Windows' } });
    expect(modifierKeyLabel()).toBe('Ctrl');
  });
});

describe('isEditableTarget', () => {
  it('is true inside text fields and editable regions, false elsewhere', () => {
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.append(inner);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(inner)).toBe(true);
    expect(isEditableTarget(document.createElement('tr'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

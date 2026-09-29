/**
 * Every colour token the UI relies on is defined in all three theme scopes of
 * `tokens.css`: the light default, the system-dark media query (unless the user chose
 * light), and an explicit `data-theme="dark"`. A token missing from one scope would fall
 * through to the other theme's colour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_TOKENS = [
  'surface',
  'surface-raised',
  'text',
  'text-muted',
  'border',
  'accent',
  'up',
  'down',
  'warning',
];

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf-8');

function block(pattern: RegExp): string {
  const body = css.match(pattern)?.[1];
  if (body === undefined) {
    throw new Error(`Expected tokens.css to contain a block matching ${pattern}`);
  }
  return body;
}

describe('tokens.css', () => {
  it.each([
    ['bare :root', /(?<!\S):root\s*\{([^}]*)\}/],
    [
      '@media (prefers-color-scheme: dark)',
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme=["']light["']\]\)\s*\{([^}]*)\}/,
    ],
    ['[data-theme="dark"]', /:root\[data-theme=["']dark["']\]\s*\{([^}]*)\}/],
  ])('defines every colour token under %s', (_scope, pattern) => {
    const body = block(pattern);
    const missing = REQUIRED_TOKENS.filter(
      (token) => !new RegExp(`--tckr-color-${token}\\s*:`).test(body),
    );
    expect(missing).toEqual([]);
  });
});

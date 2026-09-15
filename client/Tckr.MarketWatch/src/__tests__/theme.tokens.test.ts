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
] as const;

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf-8');

function block(pattern: RegExp): string {
  const match = css.match(pattern);
  if (!match || match[1] === undefined) {
    throw new Error(`Expected tokens.css to contain a block matching ${pattern}`);
  }
  return match[1];
}

const rootBlock = block(/(?<!\S)\:root\s*\{([^}]*)\}/);
const darkMediaBlock = block(
  /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
);
const dataThemeDarkBlock = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

describe('tokens.css', () => {
  it.each(REQUIRED_TOKENS)('defines --tckr-color-%s under bare :root', (token) => {
    expect(rootBlock).toMatch(new RegExp(`--tckr-color-${token}\\s*:`));
  });

  it.each(REQUIRED_TOKENS)(
    'defines --tckr-color-%s under @media (prefers-color-scheme: dark)',
    (token) => {
      expect(darkMediaBlock).toMatch(new RegExp(`--tckr-color-${token}\\s*:`));
    },
  );

  it.each(REQUIRED_TOKENS)('defines --tckr-color-%s under [data-theme="dark"]', (token) => {
    expect(dataThemeDarkBlock).toMatch(new RegExp(`--tckr-color-${token}\\s*:`));
  });

  it('defines at least 27 --tckr- custom properties in total', () => {
    const matches = css.match(/--tckr-/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(27);
  });
});

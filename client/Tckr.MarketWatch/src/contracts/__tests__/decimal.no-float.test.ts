import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'decimal.ts'), 'utf8');

describe('decimal.ts never converts a price through a JS number', () => {
  it('contains no parseFloat', () => {
    expect(source).not.toMatch(/parseFloat/);
  });

  it('contains no Number( call', () => {
    expect(source).not.toMatch(/Number\(/);
  });

  it('contains no unary + coercion', () => {
    // Matches a unary plus applied to an identifier/expression, e.g. `+x` or `+(x)`,
    // but not `a + b`, `++i`, string concatenation, or the `+` inside a regex/string.
    expect(source).not.toMatch(/(^|[^+\w])\+(?!\+)[A-Za-z_(]/m);
  });
});

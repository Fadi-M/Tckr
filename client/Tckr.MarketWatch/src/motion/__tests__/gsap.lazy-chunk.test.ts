/**
 * GSAP stays out of the entry bundle only while exactly one module imports it
 * (`src/motion/gsap.ts`) and everything else reaches it through `loadMotion()`'s dynamic
 * import. A single static `import … from 'gsap'` (or `@gsap/react`) anywhere else would
 * quietly move ~43 KB gzipped into the first load. This makes that a failing test
 * rather than a convention.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const ALLOWED = 'motion/gsap.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('GSAP lazy chunk', () => {
  it('is statically imported only by src/motion/gsap.ts', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => relative(SRC, path) !== ALLOWED)
      .filter((path) => /^\s*import\s+(?!type\b)[^;]*from\s+['"](gsap|@gsap\/react)(\/[^'"]*)?['"]/m.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});

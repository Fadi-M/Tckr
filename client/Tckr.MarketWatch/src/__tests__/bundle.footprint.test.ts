/**
 * The entry bundle stays small (GUIDELINES.md §5: under 125 KB gzip, uPlot and GSAP
 * absent). `npm run check:bundle` measures the built chunk; this is the check that runs
 * with every `npm test`, without a build, and names the import that broke it.
 *
 * It walks the entry's static import graph from `main.tsx`, the modules the first load
 * must download, and asserts the heavy parts are unreachable: uPlot (~40 KB gzip,
 * `StockDetail`'s chunk) and GSAP (~43 KB gzip, `loadMotion()`'s chunk). One static
 * import anywhere on that path (a skeleton importing `PriceChart`, a component importing
 * `gsap`) would quietly pull a library into the first load. It also pins the import
 * rules that keep those boundaries easy to hold.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

/** Static value imports and re-exports; `import type` and dynamic `import()` are
 * erased or split out by the build, so they don't count. */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;

function staticImports(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)].map((m) => m[1]!);
}

function resolveLocal(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

/** Every local module and bare package the entry reaches through static imports. */
function entryGraph(entry: string): { modules: Set<string>; packages: Set<string> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (modules.has(file) || !/\.tsx?$/.test(file)) continue;
    modules.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith('.')) {
        const target = resolveLocal(file, specifier);
        if (target) queue.push(target);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { modules, packages };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__mocks__' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function importersOf(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => staticImports(file).some((specifier) => pattern.test(specifier)))
    .map((file) => relative(SRC, file));
}

describe('entry bundle footprint', () => {
  const { modules, packages } = entryGraph(join(SRC, 'main.tsx'));
  const reached = [...modules].map((file) => relative(SRC, file));

  it('walks the real entry graph', () => {
    expect(reached).toEqual(expect.arrayContaining(['main.tsx', 'App.tsx', 'pages/StockList.tsx']));
  });

  it('keeps uPlot, the chart and the detail page out of the first load', () => {
    expect([...packages].filter((name) => name === 'uplot')).toEqual([]);
    expect(
      reached.filter((file) => /^(chart\/PriceChart|pages\/StockDetail)\.tsx$/.test(file)),
    ).toEqual([]);
  });

  it('keeps GSAP out of the first load', () => {
    expect([...packages].filter((name) => /^(gsap|@gsap\/)/.test(name))).toEqual([]);
    expect(reached).not.toContain('motion/gsap.ts');
  });

  it('imports GSAP only in motion/gsap.ts, and uPlot only under chart/', () => {
    expect(importersOf(/^(gsap|@gsap\/react)(\/|$)/)).toEqual(['motion/gsap.ts']);
    expect(importersOf(/^uplot$/).filter((file) => !file.startsWith('chart/'))).toEqual([]);
  });
});

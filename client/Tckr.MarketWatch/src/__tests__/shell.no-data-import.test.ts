import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `App.tsx` and `SimulatedBanner.tsx` must stay source-agnostic: no component may
// import `SimulatedSource`/`TckrGatewaySource` or the store directly (README.md §8),
// and the app frame itself must not hard-wire a data source. `main.tsx` is the
// composition root, not the shell — it is *expected* to import `src/data/config.ts`
// to wire real header content and the real simulated-offset value into `<App/>` (see
// this task's integration-round report), so it is deliberately not covered here.
const FILES_UNDER_TEST = ['src/App.tsx', 'src/components/SimulatedBanner.tsx'] as const;

const DATA_IMPORT_PATTERN = /from\s+['"](?:\.\.\/data|\.\/data)/;

describe('shell files do not import the data layer', () => {
  it.each(FILES_UNDER_TEST)('%s has no import from src/data', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
    expect(source).not.toMatch(DATA_IMPORT_PATTERN);
  });
});

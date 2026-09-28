// Bundle budget for the initial load (GUIDELINES.md §Performance). Run after `npm run build`.
//
// The entry chunk is the one `dist/index.html` loads. It must stay under ENTRY_GZIP_BUDGET
// and must not contain uplot or GSAP, which are lazy-loaded (see CLAUDE.md "the one seam").
// The markers are strings that only appear in those libraries' own code; the check also
// asserts each marker is found somewhere in dist, so a library upgrade that renames it fails
// loudly instead of silently passing.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
const ENTRY_GZIP_BUDGET = 125 * 1024; // 114.8 KB (zlib) at time of writing, 2026-09-28
const LAZY_MARKERS = {
  gsap: 'GreenSock',
  uplot: 'cursor-pt',
};

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entryPath = html.match(/<script[^>]+src="\/(assets\/index-[^"]+\.js)"/)?.[1];
if (!entryPath) {
  console.error(
    'check-bundle: no entry script found in dist/index.html. Run `npm run build` first.',
  );
  process.exit(1);
}

const entry = readFileSync(join(DIST, entryPath));
const entryText = entry.toString('utf8');
const gzipBytes = gzipSync(entry).length;
const chunks = readdirSync(join(DIST, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(DIST, 'assets', name), 'utf8'));

const failures = [];
if (gzipBytes > ENTRY_GZIP_BUDGET) {
  failures.push(
    `entry chunk is ${(gzipBytes / 1024).toFixed(1)} KB gzip, budget ${ENTRY_GZIP_BUDGET / 1024} KB`,
  );
}
for (const [lib, marker] of Object.entries(LAZY_MARKERS)) {
  if (entryText.includes(marker)) {
    failures.push(`${lib} is in the entry chunk (marker "${marker}"); it must stay lazy-loaded`);
  }
  if (!chunks.some((text) => text.includes(marker))) {
    failures.push(`${lib} marker "${marker}" not found in any chunk; update LAZY_MARKERS`);
  }
}

if (failures.length > 0) {
  console.error(`check-bundle failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.info(
  `check-bundle ok: entry ${(gzipBytes / 1024).toFixed(1)} KB gzip, uplot and gsap lazy`,
);

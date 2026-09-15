import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// public/symbols.json must be a byte-identical copy of the exchange's own reference
// file, disclaimer included (client/Tckr.MarketWatch/public/symbols.json is task 02's
// deliverable; src/Tckr.MockExchange/Reference/symbols.json is the .NET original, read
// here only for comparison, never modified).
const here = dirname(fileURLToPath(import.meta.url));
const clientCopyPath = resolve(here, '../../../public/symbols.json');
const exchangeOriginalPath = resolve(here, '../../../../../src/Tckr.MockExchange/Reference/symbols.json');

describe('public/symbols.json parity with the mock exchange reference file', () => {
  it('is byte-identical to src/Tckr.MockExchange/Reference/symbols.json', () => {
    const clientBuffer = readFileSync(clientCopyPath);
    const exchangeBuffer = readFileSync(exchangeOriginalPath);
    expect(clientBuffer.equals(exchangeBuffer)).toBe(true);
  });

  it('preserves the disclaimer and the simulated marking', () => {
    const text = readFileSync(clientCopyPath, 'utf-8');
    const parsed = JSON.parse(text) as { _disclaimer?: readonly string[] };
    expect(Array.isArray(parsed._disclaimer)).toBe(true);
    expect(parsed._disclaimer?.join(' ')).toMatch(/FICTIONAL/);
  });

  it('yields exactly 34 named instruments', () => {
    const parsed = JSON.parse(readFileSync(clientCopyPath, 'utf-8')) as {
      symbols: readonly unknown[];
    };
    expect(parsed.symbols).toHaveLength(34);
  });
});

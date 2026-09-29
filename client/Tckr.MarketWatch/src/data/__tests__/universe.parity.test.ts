import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// public/symbols.json must be a byte-identical copy of the mock exchange's own reference
// file (src/Tckr.MockExchange/Reference/symbols.json, read here only for comparison), so
// the client and the exchange always trade the same 34 fictional instruments.
const here = dirname(fileURLToPath(import.meta.url));
const clientCopyPath = resolve(here, '../../../public/symbols.json');
const exchangeOriginalPath = resolve(
  here,
  '../../../../../src/Tckr.MockExchange/Reference/symbols.json',
);

describe('public/symbols.json parity with the mock exchange reference file', () => {
  it('is byte-identical, keeps the FICTIONAL disclaimer, and lists 34 instruments', () => {
    const client = readFileSync(clientCopyPath);
    expect(client.equals(readFileSync(exchangeOriginalPath))).toBe(true);

    const parsed = JSON.parse(client.toString('utf-8')) as {
      _disclaimer?: readonly string[];
      symbols: readonly unknown[];
    };
    expect(parsed._disclaimer?.join(' ')).toMatch(/FICTIONAL/);
    expect(parsed.symbols).toHaveLength(34);
  });
});

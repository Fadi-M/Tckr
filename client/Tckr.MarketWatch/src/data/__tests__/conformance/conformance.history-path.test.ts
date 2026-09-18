/**
 * `TckrGatewaySource.getHistory` — REST `GET /symbols/{symbol}/history`
 * (client-contract.md). A plain, unauthenticated REST call (like `getSnapshot`/
 * `getUniverse` — see those methods, none of which check `#authenticated`), parsed
 * through the same "never trust JSON at the edge" boundary validation as every other
 * REST body this module parses.
 */
import { describe, expect, it } from 'vitest';
import { toDecimal } from '../../../contracts/decimal.ts';
import { createHarness } from './gatewayHarness.ts';

describe('gateway history-path conformance', () => {
  it('fetches GET /symbols/{symbol}/history and resolves with the parsed, typed history', async () => {
    const harness = createHarness({
      '/symbols/COMI/history': {
        v: 1,
        symbol: 'COMI',
        points: [
          { t: '2026-09-12T07:00:03.000Z', p: '84.37' },
          { t: '2026-09-12T07:00:33.000Z', p: '84.40' },
        ],
      },
    });

    const history = await harness.source.getHistory('COMI');

    expect(history).toEqual({
      v: 1,
      symbol: 'COMI',
      points: [
        { t: '2026-09-12T07:00:03.000Z', p: toDecimal('84.37') },
        { t: '2026-09-12T07:00:33.000Z', p: toDecimal('84.40') },
      ],
    });
  });

  it('resolves to an empty points array for a symbol with no history yet', async () => {
    const harness = createHarness({ '/symbols/NEWCO/history': { v: 1, symbol: 'NEWCO', points: [] } });

    const history = await harness.source.getHistory('NEWCO');

    expect(history.points).toEqual([]);
  });

  it('URL-encodes the symbol in the request path', async () => {
    const harness = createHarness({ '/symbols/FOO%2FBAR/history': { v: 1, symbol: 'FOO/BAR', points: [] } });

    await harness.source.getHistory('FOO/BAR');

    expect(harness.fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/symbols/FOO%2FBAR/history'));
  });

  it('throws on a non-ok HTTP response', async () => {
    const harness = createHarness(); // no route registered -> the harness's default 404
    await expect(harness.source.getHistory('COMI')).rejects.toThrow(/HTTP 404/);
  });

  it('rejects a malformed body (missing "points" array)', async () => {
    const harness = createHarness({ '/symbols/COMI/history': { v: 1, symbol: 'COMI' } });
    await expect(harness.source.getHistory('COMI')).rejects.toThrow(/expected array field "points"/);
  });

  it('rejects a point with an invalid decimal price', async () => {
    const harness = createHarness({
      '/symbols/COMI/history': { v: 1, symbol: 'COMI', points: [{ t: '2026-09-12T07:00:03.000Z', p: 'not-a-price' }] },
    });
    await expect(harness.source.getHistory('COMI')).rejects.toThrow(/invalid decimal price/);
  });
});

/**
 * On the DELAYED stream the detail's as-of line shows the event's own exchange time (in
 * Cairo), never local receipt time, and says in words that the prices are delayed and
 * that the delay is simulated. LIVE/DELAYED comes only from the server's `identity()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { IsoUtc } from '../../contracts/messages.ts';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail, snapshotFixture } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

beforeEach(resetStore);
afterEach(cleanup);

describe('StockDetail DELAYED labelling', () => {
  it('shows the exchange time, not receipt time, and states the simulated DELAYED context', async () => {
    const { source } = createFakeSource({
      identity: { userId: 'user-002', stream: 'DELAYED', sessionId: 'sess-2' },
      snapshotImpl: (symbol) =>
        Promise.resolve(
          snapshotFixture({
            symbol,
            stream: 'DELAYED',
            // A DELAYED snapshot keeps its original exchange time, well behind "now".
            exchangeTimestamp: '2026-09-12T10:15:00.000Z' as IsoUtc,
            snapshotAge: 15000,
          }),
        ),
    });
    await renderDetail(<StockDetail symbol="COMI" />, source);

    const asOf = screen.getByTestId('stock-detail-asof').textContent;
    expect(asOf).toContain('1:15:00 PM'); // 10:15 UTC is 13:15 in Cairo (DST, UTC+3)
    expect(asOf).toContain('DELAYED');
    expect(asOf.toLowerCase()).toContain('simulat');
  });
});

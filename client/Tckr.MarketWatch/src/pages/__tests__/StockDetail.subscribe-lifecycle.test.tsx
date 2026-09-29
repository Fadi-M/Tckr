/**
 * The detail pane subscribes to its one symbol on mount and unsubscribes on unmount,
 * netting exactly one live subscription even under StrictMode's double-invoked effects.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

beforeEach(resetStore);
afterEach(cleanup);

describe('StockDetail subscribe/unsubscribe lifecycle', () => {
  it('subscribes once on mount and unsubscribes once on unmount', async () => {
    const { source, subscribe, unsubscribe } = createFakeSource();
    const { unmount } = await renderDetail(<StockDetail symbol="COMI" />, source, {
      settleFirst: false,
    });

    expect(subscribe.mock.calls).toEqual([[['COMI']]]);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe.mock.calls).toEqual([[['COMI']]]);
  });

  it('nets exactly one active subscription under StrictMode double-invocation', async () => {
    const { source, subscribe, unsubscribe } = createFakeSource();
    await renderDetail(
      <StrictMode>
        <StockDetail symbol="COMI" />
      </StrictMode>,
      source,
      { settleFirst: false },
    );

    expect(screen.getByTestId('stock-detail-loading')).toBeTruthy();
    expect(subscribe.mock.calls.length - unsubscribe.mock.calls.length).toBe(1);
  });
});

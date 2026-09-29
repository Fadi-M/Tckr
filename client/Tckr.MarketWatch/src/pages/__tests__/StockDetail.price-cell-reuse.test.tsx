/**
 * Every price the detail pane shows (price, change, open, high, low) is rendered by
 * `PriceCell`, so each one gets the same decimal formatting and ▲/▼ signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetStore } from '../../data/store.ts';
import { createFakeSource, renderDetail } from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');
vi.mock('../../components/PriceCell.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PriceCell.tsx')>();
  return { ...actual, PriceCell: vi.fn(actual.PriceCell) };
});

import { PriceCell } from '../../components/PriceCell.tsx';
import { StockDetail } from '../StockDetail.tsx';

beforeEach(resetStore);
afterEach(cleanup);

describe('StockDetail renders every price through PriceCell', () => {
  it('routes price, change, open, high and low through PriceCell', async () => {
    await renderDetail(<StockDetail symbol="COMI" />, createFakeSource().source);
    const rendered = vi.mocked(PriceCell).mock.calls.map(([props]) => String(props.value));
    // snapshotFixture: price 84.50, change 0.13, open 84.37, high 84.60, low 84.10.
    expect(rendered).toEqual(expect.arrayContaining(['84.50', '0.13', '84.37', '84.60', '84.10']));
  });
});

/**
 * Page context for assistive tech: the tab title names the open instrument, is restored
 * when the detail closes, and never pairs a new ticker with the previous instrument's
 * name. (An unknown symbol's title is `StockDetail.unknown-symbol.test.tsx`.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetStore } from '../../data/store.ts';
import {
  cibDefinition,
  comiDefinition,
  createFakeSource,
  renderDetail,
  settle,
  universeFixture,
} from './testSupport.tsx';

vi.mock('uplot', async () => ({
  default: (await import('../../chart/__tests__/uplotTestDouble.ts')).FakeUPlot,
}));
vi.mock('../../data/config.ts');

import { StockDetail } from '../StockDetail.tsx';

beforeEach(() => {
  resetStore();
  document.title = 'Tckr MarketWatch';
});

afterEach(cleanup);

describe('StockDetail document title', () => {
  it('names the instrument, then restores the app title on close', async () => {
    const { unmount } = await renderDetail(
      <StockDetail symbol="COMI" />,
      createFakeSource().source,
    );
    expect(document.title).toBe('COMI · Commercial International Holding · Tckr MarketWatch');

    unmount();
    expect(document.title).toBe('Tckr MarketWatch');
  });

  it("never pairs the new ticker with the previous instrument's name on a switch", async () => {
    const titles: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title')!;
    vi.spyOn(document, 'title', 'set').mockImplementation(function (this: Document, value) {
      titles.push(value);
      descriptor.set!.call(this, value);
    });
    const { source } = createFakeSource({
      universe: universeFixture({ symbols: [comiDefinition(), cibDefinition()] }),
    });
    const { rerender } = await renderDetail(<StockDetail symbol="COMI" />, source);

    rerender(
      <MemoryRouter>
        <StockDetail symbol="CIB" />
      </MemoryRouter>,
    );
    await settle(1);

    expect(titles).not.toContain('CIB · Commercial International Holding · Tckr MarketWatch');
    expect(document.title).toBe('CIB · Commercial International Bank · Tckr MarketWatch');
  });
});

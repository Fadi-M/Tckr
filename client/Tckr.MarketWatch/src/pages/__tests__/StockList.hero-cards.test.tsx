/**
 * `StockList.hero-cards.test.tsx` — the highlight cards (Top gainer / Top loser / Most
 * active), critique 2026-09-26: "Most active" ranks by traded value in EGP (how EGX
 * reports activity), not by share count, and a card showing a delayed price says so,
 * like a board row does.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDecimal } from '../../contracts/decimal.ts';
import { applyTick, primeUniverse, resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, tickFixture } from './testSupport.ts';

const { mockGetSharedSource } = vi.hoisted(() => ({ mockGetSharedSource: vi.fn() }));
vi.mock('../../data/config.ts', () => ({ getSharedSource: mockGetSharedSource }));

import { StockList } from '../StockList.tsx';

async function renderAfterTicks(ticks: Parameters<typeof tickFixture>[0][]) {
  const universe = loadUniverseFixture();
  primeUniverse(universe);
  // Ticks land before mount, so the one-shot hero pick sees them.
  for (const tick of ticks) {
    applyTick(tickFixture(tick));
  }
  mockGetSharedSource.mockReturnValue(makeFakeSource(universe).source);
  render(
    <MemoryRouter>
      <StockList />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mostActiveCard(): HTMLElement {
  return screen.getByRole('button', { name: /^MOST ACTIVE[:,]/ });
}

describe('StockList highlight cards', () => {
  beforeEach(() => {
    resetStore();
    mockGetSharedSource.mockReset();
  });

  afterEach(cleanup);

  // ORAS and CIB take the gainer and loser slots on a small share count, so the Most
  // active slot is decided by traded value alone.
  const MOVERS = [
    { s: 'ORAS', p: toDecimal('260.00'), q: 10, id: 'evt-1' },
    { s: 'CIB', p: toDecimal('55.00'), q: 10, id: 'evt-2' },
  ];

  it('ranks Most active by traded value, not by share count', async () => {
    // EKHO: many cheap shares, 1.926 × 1,000,000 = EGP 1.93M.
    // COMI: fewer, dearer shares, 85.10 × 100,000 = EGP 8.51M — the most active.
    await renderAfterTicks([
      ...MOVERS,
      { s: 'EKHO', p: toDecimal('1.926'), q: 1_000_000, id: 'evt-3' },
      { s: 'COMI', p: toDecimal('85.10'), q: 100_000, id: 'evt-4' },
    ]);

    const card = mostActiveCard();
    expect(card.getAttribute('aria-label')).toMatch(
      // While EGX is closed (the suite runs on the real clock) the card also names the
      // session it describes.
      /^MOST ACTIVE(, \w{3} \d{1,2} \w{3} session)?: COMI, 85\.10, traded value EGP 8\.51M$/,
    );
    expect(card.textContent).toContain('EGP 8.51M');
  });

  it('marks a card showing a delayed price, for sighted and screen-reader users alike', async () => {
    await renderAfterTicks([
      ...MOVERS,
      { s: 'COMI', p: toDecimal('85.10'), q: 100_000, st: 'DELAYED', id: 'evt-4' },
    ]);

    const card = mostActiveCard();
    expect(card.getAttribute('aria-label')).toMatch(/, delayed stream$/);
    expect(card.querySelector('svg')).not.toBeNull();
  });
});

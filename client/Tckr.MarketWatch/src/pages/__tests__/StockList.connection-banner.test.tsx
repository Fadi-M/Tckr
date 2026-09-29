/**
 * The board's connection banner: nothing while connected; while reconnecting or closed,
 * an alert with a retry that goes through `reconnectSharedSource()`, never a bare
 * `.connect()` on the shared source (which could race a pending backoff timer into a
 * second socket; `config.reconnect-shared-source.test.ts` proves the real function).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { CloseCode } from '../../contracts/closeCodes.ts';
import type { ConnectionState } from '../../data/MarketDataSource.ts';
import { reconnectSharedSource } from '../../data/config.ts';
import { resetStore } from '../../data/store.ts';
import { loadUniverseFixture, makeFakeSource, renderBoard } from './testSupport.tsx';

vi.mock('../../data/config.ts');

async function renderIn(connectionState: ConnectionState) {
  const fake = makeFakeSource(loadUniverseFixture(), { connectionState });
  await renderBoard({ source: fake.source });
  return fake;
}

describe('StockList connection banner', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('shows nothing while connected', async () => {
    await renderIn({ kind: 'connected', since: Date.now() });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [
      'reconnecting',
      { kind: 'reconnecting', attempt: 2, nextRetryMs: 4000 } as const,
      ['retrying in', 'Attempt 2'],
      /retry now/i,
    ],
    [
      'closed',
      { kind: 'closed', code: CloseCode.Normal, reason: 'server shutdown' } as const,
      ['Disconnected'],
      /^reconnect$/i,
    ],
  ])(
    'while %s, explains it and retries through reconnectSharedSource()',
    async (_s, state, texts, button) => {
      const fake = await renderIn(state);
      const banner = screen.getByRole('alert');
      for (const text of texts) expect(banner.textContent).toContain(text);

      fireEvent.click(screen.getByRole('button', { name: button }));

      expect(reconnectSharedSource).toHaveBeenCalledTimes(1);
      expect(fake.connect).not.toHaveBeenCalled();
    },
  );
});

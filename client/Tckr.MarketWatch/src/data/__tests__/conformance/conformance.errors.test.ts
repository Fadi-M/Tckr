/**
 * All five `ErrorCode`s surface through `on.error` with the code intact, and
 * `RATE_LIMITED` throttles outbound control frames rather than just being reported.
 *
 * Coverage over `ALL_ERROR_CODES` uses the same `Record<K, T>`-must-have-exactly-these-
 * keys idiom as `conformance.messages.test.ts` (see that file's header) — keyed here by
 * `ErrorCode` directly rather than by fixture name, so it fails to compile if
 * `contracts/messages.ts`'s `ErrorCode` union ever gains or loses a member without a
 * matching fixture *and* a matching case here.
 */
import { describe, expect, it, vi } from 'vitest';
import { ALL_ERROR_CODES, FIXTURES } from '../../../contracts/fixtures/index.ts';
import type { ErrorCode, ErrorMsg } from '../../../contracts/messages.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

const FIXTURE_BY_CODE: Record<ErrorCode, object> = {
  UNKNOWN_SYMBOL: FIXTURES['error-unknown-symbol'],
  SUBSCRIPTION_LIMIT: FIXTURES['error-subscription-limit'],
  NOT_ENTITLED: FIXTURES['error-not-entitled'],
  RATE_LIMITED: FIXTURES['error-rate-limited'],
  INTERNAL: FIXTURES['error-internal'],
};

describe('gateway error-code conformance', () => {
  it.each(ALL_ERROR_CODES)('%s surfaces through on.error with the code intact', async (code) => {
    const harness = createHarness();
    const socket = await connectAndAuthenticate(harness);
    const errors: ErrorMsg[] = [];
    harness.source.on.error((e) => errors.push(e));

    socket.emit(FIXTURE_BY_CODE[code]);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(code);
  });

  it('RATE_LIMITED holds outbound control frames until the throttle window elapses', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);
      const sentBeforeThrottle = socket.sent.length;

      socket.emit(FIXTURES['error-rate-limited']);
      harness.source.subscribe(['COMI']);
      // Held: the RATE_LIMITED window has not elapsed yet.
      expect(socket.sent.length).toBe(sentBeforeThrottle);

      await vi.advanceTimersByTimeAsync(2000);
      // Released: the queued subscribe frame has now gone out.
      expect(socket.sent.length).toBe(sentBeforeThrottle + 1);
      const parsed = JSON.parse(socket.sent[socket.sent.length - 1] ?? '{}') as { type: string; symbols: string[] };
      expect(parsed).toMatchObject({ type: 'subscribe', symbols: ['COMI'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second RATE_LIMITED error while already throttled does not send anything early', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const socket = await connectAndAuthenticate(harness);

      socket.emit(FIXTURES['error-rate-limited']);
      harness.source.subscribe(['COMI']);
      await vi.advanceTimersByTimeAsync(1000);
      socket.emit(FIXTURES['error-rate-limited']); // renews the throttle window
      harness.source.subscribe(['CIB']);

      await vi.advanceTimersByTimeAsync(1000); // 2000ms since the first, but only 1000ms since the renewal
      expect(socket.sent).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1000);
      expect(socket.sent.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

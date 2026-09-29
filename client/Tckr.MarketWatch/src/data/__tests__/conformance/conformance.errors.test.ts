/**
 * `RATE_LIMITED` throttles outbound control frames rather than just being reported.
 * (Every error code reaching `on.error` intact is `conformance.messages.test.ts`.)
 */
import { describe, expect, it, vi } from 'vitest';
import { FIXTURES } from '../../../contracts/fixtures/index.ts';
import { connectAndAuthenticate, createHarness } from './gatewayHarness.ts';

describe('gateway RATE_LIMITED throttle', () => {
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
      const parsed = JSON.parse(socket.sent[socket.sent.length - 1] ?? '{}') as {
        type: string;
        symbols: string[];
      };
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

/**
 * The reconnect policy (client-contract.md §4): exponential backoff capped at 30 s with
 * ±20% jitter, and no retry for a close that would only fail again.
 */
import { describe, expect, it } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import { DEFAULT_BACKOFF_POLICY, nextDelay, shouldReconnect } from '../reconnect.ts';

describe('nextDelay', () => {
  it('doubles from 500 ms and caps at 30 s, exactly, with centred jitter', () => {
    const expected = [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000];
    const actual = expected.map((_, i) => nextDelay(i + 1, DEFAULT_BACKOFF_POLICY, () => 0.5));
    expect(actual).toEqual(expected);
  });

  it('never leaves ±20% of the centre, reaching both bounds', () => {
    expect(nextDelay(3, DEFAULT_BACKOFF_POLICY, () => 0)).toBe(1600);
    expect(nextDelay(3, DEFAULT_BACKOFF_POLICY, () => 1)).toBe(2400);
    for (let i = 0; i <= 20; i += 1) {
      const delay = nextDelay(3, DEFAULT_BACKOFF_POLICY, () => i / 20);
      expect(delay).toBeGreaterThanOrEqual(1600);
      expect(delay).toBeLessThanOrEqual(2400);
    }
  });
});

describe('shouldReconnect', () => {
  it.each([
    [CloseCode.Unauthenticated, false], // a bad token would loop forever
    [CloseCode.Normal, false],
    [CloseCode.TokenExpired, true],
    [CloseCode.HeartbeatTimeout, true],
    [CloseCode.SlowConsumer, true],
  ])('close %i → %s', (code, expected) => {
    expect(shouldReconnect(code)).toBe(expected);
  });
});

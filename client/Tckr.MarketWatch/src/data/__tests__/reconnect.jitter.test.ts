import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF_POLICY, nextDelay } from '../reconnect.ts';

describe('nextDelay — jitter bounds', () => {
  it("attempt 3's delay spans exactly [1600, 2400] ms at rand=0 and rand=1", () => {
    expect(nextDelay(3, DEFAULT_BACKOFF_POLICY, () => 0)).toBe(1600);
    expect(nextDelay(3, DEFAULT_BACKOFF_POLICY, () => 1)).toBe(2400);
  });

  it('never leaves ±20% of the centre for any rand in [0, 1)', () => {
    const centre = 2000; // attempt 3: 500 * 2^2
    const low = centre * 0.8;
    const high = centre * 1.2;
    for (let i = 0; i <= 20; i += 1) {
      const rand = i / 20;
      const delay = nextDelay(3, DEFAULT_BACKOFF_POLICY, () => rand);
      expect(delay).toBeGreaterThanOrEqual(low);
      expect(delay).toBeLessThanOrEqual(high);
    }
  });

  it('never calls Math.random itself (rand is always the caller-supplied function)', () => {
    let calls = 0;
    nextDelay(1, DEFAULT_BACKOFF_POLICY, () => {
      calls += 1;
      return 0.5;
    });
    expect(calls).toBe(1);
  });
});

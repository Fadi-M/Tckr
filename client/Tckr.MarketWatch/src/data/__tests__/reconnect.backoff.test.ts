import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF_POLICY, nextDelay } from '../reconnect.ts';

describe('nextDelay — exact centred sequence with rand = 0.5', () => {
  it('produces exactly 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000 across 10 attempts', () => {
    const rand = () => 0.5;
    const expected = [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000];
    const actual = expected.map((_, index) => nextDelay(index + 1, DEFAULT_BACKOFF_POLICY, rand));
    expect(actual).toEqual(expected);
  });
});

import { describe, expect, it } from 'vitest';
import { CloseCode } from '../../contracts/closeCodes.ts';
import { shouldReconnect } from '../reconnect.ts';

describe('shouldReconnect', () => {
  it('does not reconnect on 4401 (unauthenticated) — a bad token loops forever', () => {
    expect(shouldReconnect(CloseCode.Unauthenticated)).toBe(false);
  });

  it('does not reconnect on 1000 (normal close)', () => {
    expect(shouldReconnect(CloseCode.Normal)).toBe(false);
  });

  it('reconnects on 4403 (token expired), 4408 (heartbeat timeout), and 4429 (slow consumer)', () => {
    expect(shouldReconnect(CloseCode.TokenExpired)).toBe(true);
    expect(shouldReconnect(CloseCode.HeartbeatTimeout)).toBe(true);
    expect(shouldReconnect(CloseCode.SlowConsumer)).toBe(true);
  });
});

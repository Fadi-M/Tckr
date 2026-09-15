import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeartbeatWatchdog } from '../reconnect.ts';

describe('createHeartbeatWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTimeout after two consecutive missed heartbeats (2 * intervalMs with no pulse)', () => {
    const onTimeout = vi.fn();
    const intervalMs = 1000;
    createHeartbeatWatchdog(intervalMs, onTimeout);

    vi.advanceTimersByTime(2 * intervalMs - 1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('one missed heartbeat, followed by a late pulse before the deadline, does not fire onTimeout', () => {
    const onTimeout = vi.fn();
    const intervalMs = 1000;
    const watchdog = createHeartbeatWatchdog(intervalMs, onTimeout);

    // The heartbeat expected at t=1000 never arrives (one missed), but a pulse arrives
    // at t=1900 — still inside the 2*intervalMs=2000ms deadline — which resets the
    // window.
    vi.advanceTimersByTime(1900);
    watchdog.pulse();
    expect(onTimeout).not.toHaveBeenCalled();

    // Total elapsed since construction is now 2000ms, which would have tripped the
    // *original* deadline, but the pulse at 1900 reset it to fire at 1900+2000=3900.
    vi.advanceTimersByTime(100);
    expect(onTimeout).not.toHaveBeenCalled();

    // Confirm it still fires eventually if heartbeats then stop for real.
    vi.advanceTimersByTime(1900);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('regular on-time pulses keep the watchdog from ever firing', () => {
    const onTimeout = vi.fn();
    const intervalMs = 1000;
    const watchdog = createHeartbeatWatchdog(intervalMs, onTimeout);

    for (let i = 0; i < 20; i += 1) {
      vi.advanceTimersByTime(intervalMs);
      watchdog.pulse();
    }
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('stop() prevents a pending timeout from firing', () => {
    const onTimeout = vi.fn();
    const watchdog = createHeartbeatWatchdog(1000, onTimeout);
    watchdog.stop();
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('fires onTimeout exactly once even if timers advance well past the deadline', () => {
    const onTimeout = vi.fn();
    createHeartbeatWatchdog(1000, onTimeout);
    vi.advanceTimersByTime(50_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

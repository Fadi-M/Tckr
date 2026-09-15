import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ringBuffer.ts';

describe('RingBuffer ordering', () => {
  it('is monotonic in time, oldest to newest, before wrap-around', () => {
    const buffer = new RingBuffer(10);
    for (let i = 0; i < 5; i += 1) {
      buffer.push(1000 + i, i);
    }

    expect(buffer.length).toBe(5);
    for (let i = 1; i < buffer.length; i += 1) {
      expect(buffer.times[i]).toBeGreaterThan(buffer.times[i - 1] as number);
    }
  });

  it('stays monotonic in time, oldest to newest, after wrap-around', () => {
    const capacity = 10;
    const buffer = new RingBuffer(capacity);
    // Push far more than capacity so every slot has wrapped at least once.
    const total = capacity * 25;
    for (let i = 0; i < total; i += 1) {
      buffer.push(i, i);
    }

    expect(buffer.length).toBe(capacity);
    for (let i = 1; i < buffer.length; i += 1) {
      expect(buffer.times[i]).toBeGreaterThan(buffer.times[i - 1] as number);
    }
    // The window held is exactly the most recent `capacity` pushes.
    expect(buffer.times[0]).toBe(total - capacity);
    expect(buffer.times[capacity - 1]).toBe(total - 1);
    expect(buffer.values[0]).toBe(total - capacity);
    expect(buffer.values[capacity - 1]).toBe(total - 1);
  });
});

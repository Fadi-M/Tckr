import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ringBuffer.ts';

describe('RingBuffer capacity', () => {
  it('bounds the buffer at its configured capacity after far more pushes than that', () => {
    const capacity = 600;
    const buffer = new RingBuffer(capacity);

    for (let i = 0; i < 100_000; i += 1) {
      buffer.push(i, i);
    }

    expect(buffer.length).toBe(capacity);
    expect(buffer.times.length).toBe(capacity);
    expect(buffer.values.length).toBe(capacity);
    // The newest value pushed was i = 99_999; it must be the last element.
    expect(buffer.values[capacity - 1]).toBe(99_999);
    expect(buffer.times[capacity - 1]).toBe(99_999);
  });
});

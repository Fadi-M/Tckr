import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ringBuffer.ts';

describe('RingBuffer allocation', () => {
  it('never reallocates the underlying typed arrays, even across many pushes', () => {
    const buffer = new RingBuffer(600);
    const timesBefore = buffer.times;
    const valuesBefore = buffer.values;

    for (let i = 0; i < 10_000; i += 1) {
      buffer.push(i, i * 1.5);
    }

    expect(buffer.times).toBe(timesBefore);
    expect(buffer.values).toBe(valuesBefore);
  });

  it('keeps the same references even before the buffer first fills up', () => {
    const buffer = new RingBuffer(600);
    const timesBefore = buffer.times;
    const valuesBefore = buffer.values;

    for (let i = 0; i < 50; i += 1) {
      buffer.push(i, i);
    }

    expect(buffer.times).toBe(timesBefore);
    expect(buffer.values).toBe(valuesBefore);
  });
});

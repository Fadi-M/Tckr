import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ringBuffer.ts';

describe('RingBuffer.clear', () => {
  it('drops every point without reallocating the underlying arrays', () => {
    const buffer = new RingBuffer(10);
    const timesBefore = buffer.times;
    const valuesBefore = buffer.values;

    for (let i = 0; i < 7; i += 1) {
      buffer.push(i, i * 10);
    }
    expect(buffer.length).toBe(7);

    buffer.clear();

    expect(buffer.length).toBe(0);
    expect(buffer.times).toBe(timesBefore);
    expect(buffer.values).toBe(valuesBefore);
  });

  it('is fully reusable afterwards: subsequent pushes start a fresh series at index 0', () => {
    const buffer = new RingBuffer(5);
    for (let i = 0; i < 5; i += 1) {
      buffer.push(i, 100 + i); // fill past capacity's wrap point too
    }
    buffer.push(5, 105);
    expect(buffer.length).toBe(5);

    buffer.clear();
    expect(buffer.length).toBe(0);

    buffer.push(999, -1);
    expect(buffer.length).toBe(1);
    expect(buffer.times[0]).toBe(999);
    expect(buffer.values[0]).toBe(-1);
  });
});

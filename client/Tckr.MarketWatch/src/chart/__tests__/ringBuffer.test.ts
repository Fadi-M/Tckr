/**
 * `RingBuffer` — the chart's bounded, allocation-free point store. However long a
 * session runs, it holds exactly the newest `capacity` points, oldest to newest, in the
 * same two typed arrays it started with (so `PriceChart` hands uPlot the same buffers
 * every redraw, with no garbage per tick).
 */
import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ringBuffer.ts';

describe('RingBuffer', () => {
  it('holds the newest 600 of 100,000 pushes, in time order, in its original arrays', () => {
    const buffer = new RingBuffer(600);
    const times = buffer.times;
    const values = buffer.values;

    for (let i = 0; i < 50; i += 1) buffer.push(i, i);
    expect(buffer.times).toBe(times); // no reallocation before the buffer fills...
    for (let i = 50; i < 100_000; i += 1) buffer.push(i, i);
    expect(buffer.times).toBe(times); // ...or after it wraps
    expect(buffer.values).toBe(values);

    expect(buffer.length).toBe(600);
    expect(buffer.times.length).toBe(600);
    expect(buffer.times[0]).toBe(100_000 - 600);
    expect(buffer.times[599]).toBe(99_999);
    expect(buffer.values[599]).toBe(99_999);
    expect(Array.from(buffer.times).every((t, i, all) => i === 0 || t > all[i - 1]!)).toBe(true);
  });

  it('clears without reallocating, and starts a fresh series at index 0', () => {
    const buffer = new RingBuffer(5);
    const times = buffer.times;
    for (let i = 0; i < 6; i += 1) buffer.push(i, 100 + i); // past the wrap point

    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.times).toBe(times);

    buffer.push(999, -1);
    expect(buffer.length).toBe(1);
    expect(buffer.times[0]).toBe(999);
    expect(buffer.values[0]).toBe(-1);
  });
});

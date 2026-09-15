import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toDecimal } from '../../contracts/decimal.ts';
import { decimalsForTickSize, formatAxisPrice, formatClockTime, formatYAxisLabel } from '../axes.ts';

describe('axis price formatting', () => {
  it('renders 2 decimals for a 0.01 tick size', () => {
    expect(decimalsForTickSize(toDecimal('0.01'))).toBe(2);
    expect(formatYAxisLabel(18.4, toDecimal('0.01'))).toBe('18.40');
    expect(formatYAxisLabel(18.42, toDecimal('0.01'))).toBe('18.42');
  });

  it('renders 3 decimals for a 0.001 tick size', () => {
    expect(decimalsForTickSize(toDecimal('0.001'))).toBe(3);
    expect(formatYAxisLabel(0.005, toDecimal('0.001'))).toBe('0.005');
    expect(formatYAxisLabel(1.2, toDecimal('0.001'))).toBe('1.200');
  });

  it('renders 0 decimals for an integer tick size', () => {
    expect(decimalsForTickSize(toDecimal('1'))).toBe(0);
    expect(formatAxisPrice(85, 0)).toBe('85');
  });

  it('handles negative axis values correctly', () => {
    expect(formatAxisPrice(-1.05, 2)).toBe('-1.05');
  });
});

describe('axis time formatting', () => {
  it('formats an epoch-ms value as zero-padded HH:MM:SS', () => {
    const date = new Date();
    date.setHours(9, 5, 3, 0);
    expect(formatClockTime(date.getTime())).toBe('09:05:03');
  });

  it('pads all components to two digits', () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    expect(formatClockTime(date.getTime())).toBe('00:00:00');
  });
});

describe('the banned float-to-fixed-decimal-string built-in is absent from src/chart', () => {
  it('does not appear in axes.ts, ringBuffer.ts or PriceChart.tsx', () => {
    // Built from parts so this assertion string itself does not trip the DoD grep
    // check it enforces, which must find zero matches anywhere under src/chart/,
    // including inside this test file.
    const bannedBuiltin = ['to', 'Fixed'].join('');
    const chartDir = path.resolve(process.cwd(), 'src/chart');
    for (const file of ['axes.ts', 'ringBuffer.ts', 'PriceChart.tsx']) {
      const contents = readFileSync(path.join(chartDir, file), 'utf-8');
      expect(contents).not.toContain(bannedBuiltin);
    }
  });
});

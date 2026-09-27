import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { toDecimal } from '../../contracts/decimal.ts';

vi.mock('uplot', async () => {
  const mod = await import('./uplotTestDouble.ts');
  return { default: mod.FakeUPlot };
});

import { constructorSpy, instances, resetUplotMock } from './uplotTestDouble.ts';
import { PriceChart } from '../PriceChart.tsx';

interface CapturedOpts {
  series: [unknown, { stroke: () => string; fill: () => string }];
  axes: [unknown, { grid: { stroke: () => string } }];
}

const root = document.documentElement;

function setUpColor(accent: string, border: string): void {
  root.style.setProperty('--tckr-color-up', accent);
  root.style.setProperty('--tckr-color-border', border);
}

afterEach(() => {
  cleanup();
  root.removeAttribute('data-theme');
  for (const name of ['--tckr-color-up', '--tckr-color-down', '--tckr-color-text', '--tckr-color-border']) {
    root.style.removeProperty(name);
  }
});

beforeEach(() => {
  resetUplotMock();
});

describe('PriceChart theme restyle', () => {
  it('repaints with the new theme tokens in place when data-theme flips, without recreating the instance', async () => {
    root.setAttribute('data-theme', 'light');
    setUpColor('#0f7a4d', '#d8dbe1');
    render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} direction="up" />);

    const opts = constructorSpy.mock.calls[0]![0] as CapturedOpts;
    expect(opts.series[1].stroke()).toBe('#0f7a4d');
    expect(opts.axes[1].grid.stroke()).toBe('#d8dbe1');

    const plot = instances[0]!;
    plot.redraw.mockClear();

    setUpColor('#3fd79c', 'rgba(255, 255, 255, 0.1)');
    await act(async () => {
      root.setAttribute('data-theme', 'dark');
      // useTheme's MutationObserver delivers on a microtask.
      await Promise.resolve();
    });

    expect(plot.redraw).toHaveBeenCalled();
    expect(opts.series[1].stroke()).toBe('#3fd79c');
    expect(opts.axes[1].grid.stroke()).toBe('rgba(255, 255, 255, 0.1)');
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it('colours the line and its whole fill green up, red down and ink when unchanged, repainting in place', () => {
    root.style.setProperty('--tckr-color-up', '#0f7a4d');
    root.style.setProperty('--tckr-color-down', '#c0392b');
    root.style.setProperty('--tckr-color-text', '#14181f');
    const { rerender, container } = render(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} direction="up" />);
    const opts = constructorSpy.mock.calls[0]![0] as CapturedOpts;
    const plot = instances[0]!;
    expect(opts.series[1].stroke()).toBe('#0f7a4d');

    plot.redraw.mockClear();
    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} direction="down" />);
    expect(opts.series[1].stroke()).toBe('#c0392b');
    expect(opts.series[1].fill()).toBe('color-mix(in srgb, #c0392b 14%, transparent)');
    expect(plot.redraw).toHaveBeenCalled();
    expect(container.querySelector('[data-direction]')?.getAttribute('data-direction')).toBe('down');

    rerender(<PriceChart symbol="COMI" tickSize={toDecimal('0.01')} direction={null} />);
    expect(opts.series[1].stroke()).toBe('#14181f');
    expect(opts.series[1].fill()).toBe('color-mix(in srgb, #14181f 14%, transparent)');
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });
});

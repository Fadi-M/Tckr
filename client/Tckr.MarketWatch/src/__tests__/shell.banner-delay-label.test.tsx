import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SimulatedBanner } from '../components/SimulatedBanner';

afterEach(cleanup);

describe('SimulatedBanner delayed-offset label', () => {
  it('states the simulated offset and that the real delay is 15 minutes', () => {
    render(<SimulatedBanner delayedOffsetMs={15000} />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toMatch(/15\s*s(?:econds)?\b/i);
    expect(text).toMatch(/real delay is 15 minutes/i);
    expect(text.toLowerCase()).toContain('delayed');
  });

  it('says nothing about an offset or the 15-minute delay when none is given', () => {
    render(<SimulatedBanner />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).not.toMatch(/15 minutes/i);
    expect(text).not.toMatch(/offset/i);
  });
});

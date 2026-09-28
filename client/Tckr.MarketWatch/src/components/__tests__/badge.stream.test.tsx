/**
 * `StreamBadge` — the header's LIVE/DELAYED entitlement pill. Asserts the badge is
 * driven only by the server's `identity()`: nothing before `connected` (never a LIVE
 * default), the right label per stream, an honest delay label (the simulated offset,
 * flagged as simulated — never "15 min" for a 15-second simulated delay), and a flip
 * when the entitlement changes.
 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { IsoUtc } from '../../contracts/messages.ts';
import {
  finishMotion,
  primeMotion,
  stubReducedMotion,
  resetMotion,
  unstubReducedMotion,
} from '../../motion/__tests__/motionTestSupport.ts';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(),
}));

import { getSharedSource, resolveClientConfig } from '../../data/config.ts';
import { StreamBadge } from '../StreamBadge.tsx';

function mockSource(
  source: ReturnType<typeof createFakeSource>,
  sourceKind: 'simulated' | 'gateway' = 'simulated',
) {
  vi.mocked(getSharedSource).mockReturnValue(source);
  vi.mocked(resolveClientConfig).mockReturnValue({
    source: sourceKind,
    simulated: { delayedOffsetMs: 15_000 },
  } as ReturnType<typeof resolveClientConfig>);
}

beforeEach(primeMotion);

afterEach(async () => {
  cleanup();
  unstubReducedMotion();
  await resetMotion();
});

describe('StreamBadge', () => {
  it('renders nothing until the server has said which stream this connection is on', () => {
    mockSource(createFakeSource(null));
    render(<StreamBadge />);
    expect(screen.queryByTestId('stream-badge')).toBeNull();
  });

  it('shows LIVE for a live entitlement', () => {
    mockSource(createFakeSource(fakeIdentity({ stream: 'LIVE' })));
    render(<StreamBadge />);
    const badge = screen.getByTestId('stream-badge');
    expect(badge.dataset.stream).toBe('LIVE');
    expect(badge.textContent).toContain('LIVE');
  });

  it('shows DELAYED with the simulated offset, and says it is simulated', () => {
    mockSource(createFakeSource(fakeIdentity({ stream: 'DELAYED' })));
    render(<StreamBadge />);
    const badge = screen.getByTestId('stream-badge');
    expect(badge.dataset.stream).toBe('DELAYED');
    expect(badge.textContent).toContain('15s');
    expect(badge.textContent?.toLowerCase()).toContain('simulated');
  });

  it('shows the real 15-minute delay when the gateway source is active', () => {
    mockSource(createFakeSource(fakeIdentity({ stream: 'DELAYED' })), 'gateway');
    render(<StreamBadge />);
    const badge = screen.getByTestId('stream-badge');
    expect(badge.textContent).toContain('15 min');
    expect(badge.textContent?.toLowerCase()).not.toContain('simulated');
  });

  it('flips when the entitlement changes', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    mockSource(source);
    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').dataset.stream).toBe('LIVE');

    act(() => {
      source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
      source.emitEntitlement({
        v: 1,
        type: 'entitlementChanged',
        stream: 'DELAYED',
        resubscribeRequired: false,
        effectiveFrom: '2026-09-12T10:00:00.000Z' as IsoUtc,
      });
    });
    expect(screen.getByTestId('stream-badge').dataset.stream).toBe('DELAYED');
  });

  it('pulses only on a real entitlement change, never on first paint, inside a persistent live region', () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    mockSource(source);
    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').className).not.toContain('animate-stream-change');
    const liveRegion = screen.getByRole('status');

    act(() => {
      source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
      source.emitEntitlement({
        v: 1,
        type: 'entitlementChanged',
        stream: 'DELAYED',
        resubscribeRequired: false,
        effectiveFrom: '2026-09-12T10:00:00.000Z' as IsoUtc,
      });
    });
    expect(screen.getByTestId('stream-badge').className).toContain('animate-stream-change');
    expect(screen.getByRole('status')).toBe(liveRegion);
    // What a screen reader hears (the visible word is aria-hidden while it scrambles).
    expect(liveRegion.querySelector('.sr-only')!.textContent).toContain('Delayed stream');
  });

  it('scrambles the word from the old stream to the new one, with the screen reader hearing only the new one', async () => {
    stubReducedMotion(false);
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    mockSource(source);
    render(<StreamBadge />);
    const liveRegion = screen.getByRole('status');

    act(() => {
      source.setIdentity(fakeIdentity({ stream: 'DELAYED' }));
      source.emitEntitlement({
        v: 1,
        type: 'entitlementChanged',
        stream: 'DELAYED',
        resubscribeRequired: false,
        effectiveFrom: '2026-09-12T10:00:00.000Z' as IsoUtc,
      });
    });
    // Mid-scramble: the visible word is in flight, and it is aria-hidden, so the live
    // region never speaks an intermediate string.
    const word = liveRegion.querySelector(
      '[data-testid="stream-badge"] > span[aria-hidden="true"] > span[aria-hidden="true"]',
    )!;
    // Already scrambling on the first frame: the amber pill never paints the old word.
    expect(word.textContent).not.toBe('LIVE');
    expect(word.textContent).not.toBe('DELAYED');
    await finishMotion();
    expect(word.textContent).toBe('DELAYED');
    expect(screen.getByTestId('stream-badge').querySelector('.sr-only')!.textContent).toContain(
      'Delayed stream',
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createFakeSource, fakeIdentity } from './testSupport.ts';

vi.mock('../../data/config.ts', () => ({
  getSharedSource: vi.fn(),
  resolveClientConfig: vi.fn(() => ({
    source: 'simulated' as const,
    gatewayUrl: 'ws://localhost:5000',
    demoUser: 'user-001',
    simulated: { eventsPerSecond: 2000, delayedOffsetMs: 15000, seed: 1 },
  })),
}));

import { getSharedSource } from '../../data/config.ts';
import { StreamBadge } from '../StreamBadge.tsx';

afterEach(cleanup);

// Type-level assertion: `StreamBadge` takes no props at all. This function is never
// called — TypeScript still type-checks it, so `npm run typecheck` fails if
// `StreamBadge` ever grows a prop that would make `@ts-expect-error` here incorrect
// (an unused `@ts-expect-error` is itself a compile error).
function neverRendered() {
  // @ts-expect-error StreamBadge accepts no props — there is no client-side setter.
  return <StreamBadge stream="LIVE" />;
}
void neverRendered;

describe('StreamBadge — no client-side source of truth', () => {
  it('renders nothing while identity() is null (never a LIVE default)', () => {
    const source = createFakeSource(null);
    vi.mocked(getSharedSource).mockReturnValue(source);

    const { container } = render(<StreamBadge />);
    expect(container.textContent).toBe('');
    expect(screen.queryByTestId('stream-badge')).toBeNull();
  });

  it("renders the server's LIVE value exactly as identity() reports it", () => {
    const source = createFakeSource(fakeIdentity({ stream: 'LIVE' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    expect(screen.getByTestId('stream-badge').textContent).toContain('LIVE');
    expect(screen.getByTestId('stream-badge').textContent).not.toContain('DELAYED');
  });

  it("renders the server's DELAYED value, labelled as a simulated offset, and is distinguishable by text alone", () => {
    const source = createFakeSource(fakeIdentity({ stream: 'DELAYED' }));
    vi.mocked(getSharedSource).mockReturnValue(source);

    render(<StreamBadge />);
    const text = screen.getByTestId('stream-badge').textContent ?? '';
    expect(text).toContain('DELAYED');
    expect(text).not.toContain('LIVE');
    expect(text.toLowerCase()).toContain('simulated');
  });
});

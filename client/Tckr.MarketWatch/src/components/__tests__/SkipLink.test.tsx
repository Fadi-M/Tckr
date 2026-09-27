/**
 * `SkipLink` — jumps focus straight to the first control in its target region (a
 * roving-tabindex list's current stop included), not merely the region's start.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SkipLink } from '../SkipLink.tsx';

afterEach(cleanup);

describe('SkipLink', () => {
  it("focuses the target's current Tab stop, skipping elements taken out of the Tab order", () => {
    render(
      <>
        <SkipLink targetId="board">Skip to instruments</SkipLink>
        <table>
          <tbody id="board">
            <tr tabIndex={-1} data-testid="other">
              <td>A</td>
            </tr>
            <tr tabIndex={0} data-testid="stop">
              <td>B</td>
            </tr>
          </tbody>
        </table>
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip to instruments' }));
    expect(document.activeElement).toBe(screen.getByTestId('stop'));
  });

  it('focuses the target itself when it holds nothing focusable', () => {
    render(
      <>
        <SkipLink targetId="empty">Skip</SkipLink>
        <div id="empty">Nothing here</div>
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip' }));
    expect(document.activeElement?.id).toBe('empty');
  });
});

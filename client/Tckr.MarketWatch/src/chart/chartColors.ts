/**
 * The chart's colours. Canvas can't read CSS custom properties, so `PriceChart` resolves
 * the tokens here, at mount and on every theme or direction change.
 */

export type LineDirection = 'up' | 'down' | 'flat';

// The token that colours the line for each direction. The canvas reads it by name
// (`readChartColors`); the DOM pieces (last-price tag, cursor dot) get it through
// `--tckr-chart-line` on the container. Both follow light/dark with the tokens.
export const LINE_TOKEN: Record<LineDirection, string> = {
  up: '--tckr-color-up',
  down: '--tckr-color-down',
  flat: '--tckr-color-text',
};

function readCssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export interface ChartColors {
  /** The line's (and its fill's) colour, by session direction — see `LINE_TOKEN`. */
  readonly accent: string;
  readonly border: string;
  readonly muted: string;
}

/** Canvas can't read CSS custom properties, so the line and gridline colours are
 * resolved from the tokens here: once at mount, and again on every theme switch. */
export function readChartColors(el: Element, direction: LineDirection): ChartColors {
  return {
    accent: readCssVar(el, LINE_TOKEN[direction], '#14181f'),
    border: readCssVar(el, '--tckr-color-border', '#d8dbe1'),
    muted: readCssVar(el, '--tckr-color-text-muted', '#5b6472'),
  };
}

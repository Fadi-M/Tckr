/**
 * Real-browser verification of the 400px claims in
 * docs/phase-3-web-client/README.md §8 ("Accessible and usable at 400px wide") and the
 * chart's axis configuration (src/chart/PriceChart.tsx / axes.ts, task 05), which task 05
 * configured `axis.space`/`incrs` to satisfy but could not confirm — jsdom has no canvas
 * and every chart Vitest suite mocks uPlot entirely (see `chartTestSupport.ts` /
 * `uplotTestDouble.ts`). Every prior check of these three things was CSS review or a
 * mocked-canvas unit test, never a real layout in a real viewport. This spec is that
 * missing check.
 *
 * Screenshots are written to `perf/raw/layout-400/` for a human to look at directly.
 *
 * ---------------------------------------------------------------------------------
 * Axis label counting method — and why this is not a pixel scan
 * ---------------------------------------------------------------------------------
 * An earlier version of this spec counted axis labels by scanning rendered canvas
 * pixels for the grid-line colour. That approach produced misleading undercounts (it
 * mistook thin, anti-aliased 1px lines and a same-colour axis baseline for the wrong
 * count) and, separately, this task's own manual screenshot review of a *tall* cropped
 * PNG turned out to be truncating the image before the bottom axis band — a viewing
 * artifact, not a rendering one. Both were replaced with a direct, unambiguous signal:
 * an `addInitScript` wraps `CanvasRenderingContext2D.prototype.fillText` (a global
 * browser API — no `src/` file is touched or hooked) so every axis-label draw call
 * `PriceChart`'s mounted uPlot instance issues is recorded verbatim: exact text, canvas
 * position, resolved `fillStyle`/`globalAlpha`/`font`. This is strictly more reliable
 * than re-deriving "was a label drawn" from pixel colour, because it reads the actual
 * draw instruction uPlot issued rather than inferring it after the fact.
 *
 * uPlot's own text alignment distinguishes the two axes without guessing: the x-axis
 * (`axes[0]`, `side: 2`, bottom) draws with `textAlign: 'center', textBaseline: 'top'`;
 * the y-axis (`axes[1]`, `side: 3`, left) draws with `textAlign: 'right', textBaseline:
 * 'middle'` (see `PriceChart.tsx` — uPlot derives these from `side`, not something this
 * spec assumes). Distinct `(text, x, y)` triples within one settled redraw are counted
 * per axis.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = resolve(HERE, 'raw', 'layout-400');
const VIEWPORT = { width: 400, height: 800 };

interface FillTextCall {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fillStyle: string;
  readonly globalAlpha: number;
  readonly textAlign: string;
  readonly textBaseline: string;
}

test.beforeAll(() => {
  mkdirSync(RAW_DIR, { recursive: true });
});

test.describe('400px viewport', () => {
  test.use({ viewport: VIEWPORT });

  test('StockList has no horizontal overflow at 400px and shows the search box and rows', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table.tckr-stocklist__table tbody tr[data-symbol]', { timeout: 15_000 });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    await page.screenshot({ path: resolve(RAW_DIR, 'stocklist-400.png'), fullPage: true });

    writeFileSync(
      resolve(RAW_DIR, 'stocklist-400-overflow.json'),
      JSON.stringify({ viewport: VIEWPORT, ...overflow, capturedAt: new Date().toISOString() }, null, 2),
    );

    // clientWidth is the viewport's own layout width; scrollWidth must not exceed it
    // (a small rounding tolerance for scrollbar-gutter/subpixel layout).
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await expect(page.locator('#tckr-stocklist-search')).toBeVisible();
    const rowCount = await page.locator('table.tckr-stocklist__table tbody tr[data-symbol]').count();
    expect(rowCount).toBe(34);
  });

  test('StockDetail + chart has no horizontal overflow at 400px, and the chart renders labelled axes', async ({
    page,
  }) => {
    // Installed before any app script runs — see module doc. Records every axis-label
    // draw call uPlot issues onto the chart's canvas, verbatim.
    await page.addInitScript(() => {
      const w = window as unknown as { __tckrFillTextCalls: FillTextCallShape[] };
      interface FillTextCallShape {
        text: string;
        x: number;
        y: number;
        fillStyle: string;
        globalAlpha: number;
        textAlign: string;
        textBaseline: string;
      }
      w.__tckrFillTextCalls = [];
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.fillText;
      proto.fillText = function fillTextRecorder(
        this: CanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        maxWidth?: number,
      ) {
        w.__tckrFillTextCalls.push({
          text,
          x,
          y,
          fillStyle: String(this.fillStyle),
          globalAlpha: this.globalAlpha,
          textAlign: this.textAlign,
          textBaseline: this.textBaseline,
        });
        return original.call(this, text, x, y, maxWidth);
      };
    });

    await page.goto('/symbols/COMI');
    await page.waitForSelector('.tckr-price-chart__canvas canvas', { timeout: 15_000 });
    // Let several ticks land and the chart settle into a steady redraw before sampling —
    // avoids the very first frame, where the ring buffer holds only the seed point and
    // uPlot's auto-range has not yet converged on the real data.
    await page.waitForTimeout(5_000);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    await page.screenshot({ path: resolve(RAW_DIR, 'stockdetail-400.png'), fullPage: true });
    await page.locator('.tckr-price-chart').screenshot({ path: resolve(RAW_DIR, 'chart-400.png') });

    writeFileSync(
      resolve(RAW_DIR, 'stockdetail-400-overflow.json'),
      JSON.stringify({ viewport: VIEWPORT, ...overflow, capturedAt: new Date().toISOString() }, null, 2),
    );

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Sample exactly one redraw's worth of fillText calls: clear what accumulated
    // during warm-up, then wait for the next two animation frames — the chart's own
    // redraw is itself rAF-gated to at most once per frame (PriceChart.tsx), so two
    // frames reliably straddle one fresh, complete redraw without also capturing
    // several scrolled-by-a-pixel repeats of the same labels from later redraws.
    await page.evaluate(() => {
      (window as unknown as { __tckrFillTextCalls: unknown[] }).__tckrFillTextCalls = [];
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolvePromise) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
        }),
    );

    const calls: FillTextCall[] = await page.evaluate(
      () => (window as unknown as { __tckrFillTextCalls: FillTextCall[] }).__tckrFillTextCalls,
    );

    // uPlot derives text alignment from each axis's configured `side` (PriceChart.tsx):
    // side 2 (x, bottom) -> textBaseline 'top'; side 3 (y, left) -> textBaseline 'middle'.
    const xAxisCalls = calls.filter((c) => c.textBaseline === 'top');
    const yAxisCalls = calls.filter((c) => c.textBaseline === 'middle');

    function distinctLabels(cs: readonly FillTextCall[]): string[] {
      return [...new Set(cs.map((c) => `${c.text}@${c.x},${c.y}`))];
    }
    function distinctText(cs: readonly FillTextCall[]): string[] {
      return [...new Set(cs.map((c) => c.text))];
    }
    const xLabels = distinctLabels(xAxisCalls);
    const yLabels = distinctLabels(yAxisCalls);
    const xLabelTexts = distinctText(xAxisCalls);
    const yLabelTexts = distinctText(yAxisCalls);

    const visible = (c: FillTextCall): boolean => c.globalAlpha > 0 && c.fillStyle !== 'transparent' && c.fillStyle !== '';

    const result = {
      viewport: VIEWPORT,
      totalFillTextCallsInWindow: calls.length,
      xAxisLabels: xLabels,
      yAxisLabels: yLabels,
      xAxisLabelCount: xLabels.length,
      yAxisLabelCount: yLabels.length,
      xAxisDistinctLabelText: xLabelTexts,
      yAxisDistinctLabelText: yLabelTexts,
      allCallsVisible: calls.every(visible),
      sampleCalls: calls.slice(0, 20),
      capturedAt: new Date().toISOString(),
    };

    writeFileSync(resolve(RAW_DIR, 'axis-labels-400.json'), JSON.stringify(result, null, 2));

    // eslint-disable-next-line no-console
    console.log(
      `[layout-400] x-axis distinct label text=${xLabelTexts.length} (${xLabelTexts.join(', ')}) ` +
        `y-axis distinct label text=${yLabelTexts.length} (${yLabelTexts.join(', ')})`,
    );

    // DoD floor: >=3 y-axis labels, >=2 x-axis labels, at 400px width. Distinct label
    // *text* (not raw draw-call count, which can repeat a label at a shifted pixel
    // position across redraws within the sampling window — see module doc) is the
    // faithful count of "how many labels does the viewer actually see."
    expect(yLabelTexts.length).toBeGreaterThanOrEqual(3);
    expect(xLabelTexts.length).toBeGreaterThanOrEqual(2);
  });
});

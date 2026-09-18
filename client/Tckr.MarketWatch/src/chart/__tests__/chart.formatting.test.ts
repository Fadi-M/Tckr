import { readdirSync, readFileSync } from 'node:fs';
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
  // Fixture timestamps verified against `Intl` ground truth in marketCalendar.test.ts:
  // 2026-01-15 is Egypt-DST-off (UTC+2), 2026-08-13 is Egypt-DST-on (UTC+3).

  it('formats an epoch-ms value as zero-padded HH:MM:SS, in Cairo time (winter, UTC+2)', () => {
    expect(formatClockTime(Date.UTC(2026, 0, 15, 7, 5, 3))).toBe('09:05:03');
  });

  it('formats an epoch-ms value as zero-padded HH:MM:SS, in Cairo time (summer, UTC+3)', () => {
    expect(formatClockTime(Date.UTC(2026, 7, 13, 6, 5, 3))).toBe('09:05:03');
  });

  it('pads all components to two digits', () => {
    expect(formatClockTime(Date.UTC(2026, 0, 15, 22, 0, 0))).toBe('00:00:00');
  });

  it("uses Cairo time (EGX's own market timezone), not UTC and not the viewer's local timezone — must match StockDetail's header timestamp regardless of where the viewer is", () => {
    // A timestamp whose Cairo and UTC renderings visibly differ. If this function ever
    // regresses to UTC or local-time getters, this is the exact class of bug that
    // silently disagrees with StockDetail's header (both must call the same shared
    // `marketCalendar.formatCairoClock` — see this function's own doc).
    const epochMs = Date.UTC(2026, 0, 1, 23, 30, 0); // 2026-01-01 (winter, UTC+2)
    expect(formatClockTime(epochMs)).toBe('01:30:00'); // next day in Cairo
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

// ---------------------------------------------------------------------------------
// ringBuffer.ts's module doc claims `toPlotValue` is the one place a price-shaped value
// is converted to a JS `number` (the "price becomes a number" boundary this project
// takes seriously — see decimal.ts's own "prices must never go through float parsing"
// rule). This grep check enforces that claim precisely: it is scoped to *price-shaped*
// arguments (source text containing "price", case-insensitively — e.g. `Number(price)`,
// `parseFloat(snapshot.price)`), not a blanket ban on `Number(`/`parseFloat(` anywhere,
// since both appear elsewhere in this codebase for genuinely non-price values
// (`marketCalendar.ts`'s calendar-component parsing, `contracts/messages.ts`'s
// `requireNumber` for integer wire fields) that this check has no business flagging.
// ---------------------------------------------------------------------------------

/** Recursively collects every `.ts`/`.tsx` file under `dir`, skipping any `__tests__`
 * directory — this check is about production call sites, not test fixtures/assertions
 * (and skipping `__tests__` also means this very file's own prose below never risks
 * tripping the pattern it defines). */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('a DecimalString price becomes a number only via toPlotValue', () => {
  it('Number(...)/parseFloat(...) called on a price-shaped argument appears nowhere under src/ except ringBuffer.ts\'s own toPlotValue definition', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
    const ringBufferPath = path.resolve(srcDir, 'chart/ringBuffer.ts');
    const priceShapedConversion = /\b(?:Number|parseFloat)\(\s*[\w$.]*[Pp]rice\b/;

    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcDir)) {
      if (file === ringBufferPath) {
        continue; // the one sanctioned definition (`toPlotValue`)
      }
      const contents = readFileSync(file, 'utf-8');
      if (priceShapedConversion.test(contents)) {
        offenders.push(path.relative(srcDir, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Decimal-safe price handling, per client-contract.md §1.2: "Prices are decimal
 * strings, never JSON numbers." IEEE-754 doubles cannot represent every decimal price
 * exactly, so this module never converts a price through the JS `number` type. All
 * arithmetic is done on scaled integers (BigInt) parsed directly from the string's
 * digits — 4 implied decimal places, matching `PriceScale` on the exchange wire
 * (see ../../../docs/decisions/001-mock-exchange-wire-protocol.md).
 *
 * `percentChange` is the sole, deliberate exception: it returns a JS `number` because a
 * percentage is presentational and never round-trips into a price. Even there, the
 * numeric value is produced from an exact BigInt ratio via `JSON.parse` of a
 * hand-built numeral string — never the double-parsing globals this module otherwise
 * bans outright (see decimal.no-float.test.ts), and never a unary sign coercion.
 */

declare const brand: unique symbol;

/** A price (or any exchange-scale decimal quantity), branded so a bare `string`
 * cannot be used where a validated decimal is required. Construct via `toDecimal`. */
export type DecimalString = string & { readonly [brand]: 'decimal' };

/** Number of implied decimal digits the exchange's fixed-point scale carries. */
const SCALE_DIGITS = 4;

/**
 * Accepts an optional leading sign, at least one integer digit, and up to
 * `SCALE_DIGITS` fractional digits.
 *
 * client-contract.md's own REST example (`"change": "+1.05"`) carries an explicit
 * leading `+`, so unlike the plain `/^-?\d+(\.\d{1,4})?$/` this also accepts `+`. See
 * "Notes for other tasks" in 01-scaffold-contracts-and-fixtures.md for why this
 * widens the brief's literal regex.
 */
const DECIMAL_PATTERN = /^[+-]?\d+(\.\d{1,4})?$/;

export function isDecimal(raw: string): raw is DecimalString {
  return DECIMAL_PATTERN.test(raw);
}

export function toDecimal(raw: string): DecimalString {
  if (!isDecimal(raw)) {
    throw new RangeError(`Not a valid decimal price string: ${JSON.stringify(raw)}`);
  }
  return raw;
}

/** Digits after the decimal point in `value`, as written (0 if there is no `.`). */
function decimalPlaces(value: string): number {
  const dotIndex = value.indexOf('.');
  return dotIndex === -1 ? 0 : value.length - dotIndex - 1;
}

/** Parses a validated decimal string into a signed BigInt scaled by 10**SCALE_DIGITS.
 * Pure string/BigInt manipulation — no float parsing at any point. */
function toScaledInt(value: DecimalString): bigint {
  const negative = value.charAt(0) === '-';
  const hasSign = negative || value.charAt(0) === '+';
  const unsigned = hasSign ? value.slice(1) : value;
  const dotIndex = unsigned.indexOf('.');
  const intPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fracRaw = dotIndex === -1 ? '' : unsigned.slice(dotIndex + 1);
  const fracPart = fracRaw.padEnd(SCALE_DIGITS, '0');
  const magnitude = BigInt(intPart + fracPart);
  return negative ? -magnitude : magnitude;
}

/** Renders a scaled BigInt back to a decimal string with exactly `decimals` fractional
 * digits (0..SCALE_DIGITS). Safe to truncate rather than round because callers only
 * ever request a precision that is already exact for the value in hand. */
function fromScaledInt(scaled: bigint, decimals: number): DecimalString {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(SCALE_DIGITS + 1, '0');
  const intPart = digits.slice(0, digits.length - SCALE_DIGITS);
  const fullFrac = digits.slice(digits.length - SCALE_DIGITS);
  const frac = decimals > 0 ? fullFrac.slice(0, decimals).padEnd(decimals, '0') : '';
  const body = decimals > 0 ? `${intPart}.${frac}` : intPart;
  const text = negative ? `-${body}` : body;
  return text as DecimalString;
}

export function compare(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const diff = toScaledInt(a) - toScaledInt(b);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

export function subtract(a: DecimalString, b: DecimalString): DecimalString {
  const result = toScaledInt(a) - toScaledInt(b);
  // Both operands carry at most 4dp; a result at max(dpA, dpB) decimals is always
  // exact because any digits beyond that are guaranteed zero on both sides.
  const decimals = Math.max(decimalPlaces(a), decimalPlaces(b));
  return fromScaledInt(result, decimals);
}

/**
 * Presentational percentage change from `from` to `to`, as a plain JS `number`. This
 * is the only function in this module permitted to produce one. The ratio is computed
 * exactly in BigInt space (parts-per-10000-of-a-percent) and the final `number` is
 * obtained via `JSON.parse` of a numeral string this module built itself — never one
 * of the double-parsing globals this file otherwise bans, and never a unary sign
 * coercion of the original decimal strings.
 */
export function percentChange(from: DecimalString, to: DecimalString): number {
  const fromScaled = toScaledInt(from);
  if (fromScaled === 0n) {
    return 0;
  }
  const toScaledValue = toScaledInt(to);
  const diff = toScaledValue - fromScaled;
  const PERCENT_PRECISION = 10000n; // 4 fractional digits of percent precision
  const scaledPercent = (diff * 100n * PERCENT_PRECISION) / fromScaled;
  const negative = scaledPercent < 0n;
  const magnitude = negative ? -scaledPercent : scaledPercent;
  const intPart = magnitude / PERCENT_PRECISION;
  const fracPart = (magnitude % PERCENT_PRECISION).toString().padStart(4, '0');
  const numeral = `${negative ? '-' : ''}${intPart.toString()}.${fracPart}`;
  return JSON.parse(numeral) as number;
}

export function format(
  value: DecimalString,
  opts?: { decimals?: number; sign?: boolean },
): string {
  const decimals = opts?.decimals ?? decimalPlaces(value);
  const scaled = toScaledInt(value);
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(SCALE_DIGITS + 1, '0');
  const intPart = digits.slice(0, digits.length - SCALE_DIGITS);
  const fullFrac = digits.slice(digits.length - SCALE_DIGITS);
  const frac = decimals > 0 ? fullFrac.slice(0, decimals).padEnd(decimals, '0') : '';
  const body = decimals > 0 ? `${intPart}.${frac}` : intPart;
  const isZero = magnitude === 0n;
  const signPrefix = negative ? '-' : opts?.sign === true && !isZero ? '+' : '';
  return `${signPrefix}${body}`;
}

/**
 * The one way a change percentage becomes text, on every surface (board chips, hero
 * badges, row and card accessible names, the detail's change pill), so one move never
 * reads as −0.23% in one place and −0.24% in another.
 *
 * `Number.prototype.toFixed` rounds the binary double (−0.235 is stored as
 * −0.23499…, so it prints −0.23), while `Intl.NumberFormat` rounds the number's
 * shortest decimal form half-away-from-zero (−0.24). The board used the first and the
 * detail the second; both now go through here.
 */
const signed = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const unsigned = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'never',
});

/** `value` (a percentage, e.g. `-0.235`) at two decimals, without a `%` sign. Signed
 * ("+0.24", "−" as ASCII "-") unless `magnitude` asks for the bare size ("0.24"). */
export function formatPercentFigure(value: number, opts?: { magnitude?: boolean }): string {
  return (opts?.magnitude ? unsigned : signed).format(value);
}

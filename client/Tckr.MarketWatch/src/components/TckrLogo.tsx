/**
 * The Tckr lockup — candlestick "T" mark + "ckr" wordmark (design import:
 * "Tckr Logo Final.dc.html", spec in its logo/README.md).
 *
 * The mark is inlined rather than loaded as an <img> so it follows the in-app theme
 * toggle (`data-theme`) through `--tckr-logo-ink` / `--tckr-logo-candle` (tokens.css).
 * This is the only copy of the mark's geometry in the app (58×72 viewBox, from the
 * design's logo/tckr-mark-{light,dark}.svg).
 *
 * Lockup rules from the spec: mark height = 1.15 × wordmark size, mark width =
 * 0.8 × mark height, gap ≈ 0.06 × wordmark size, bottoms aligned, wordmark in
 * IBM Plex Mono 600 / -0.02em / line-height 0.92. `size` is the wordmark font size in
 * px; the spec's minimum is 14.
 */
export interface TckrLogoProps {
  size?: number;
}

/** The candlestick "T" on its own (58×72 viewBox; width = 0.8 × height), themed like
 * the lockup. Decorative (`aria-hidden`). Minimum height 16px per the logo spec.
 * `data-candle` names each part for `FormingCandle` (src/motion), which animates the
 * geometry below rather than keeping a copy of it. */
export function TckrMark({ height }: { readonly height: number }) {
  return (
    <svg
      width={Math.round(height * 0.8)}
      height={height}
      viewBox="0 0 58 72"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="flex-none"
    >
      <rect data-candle="bar" x="2" y="4" width="54" height="11" rx="5.5" fill="var(--tckr-logo-ink)" />
      <rect data-candle="wick-high" x="27" y="15" width="4" height="10" fill="var(--tckr-logo-candle)" />
      <rect data-candle="body" x="17" y="25" width="24" height="34" rx="6" fill="var(--tckr-logo-candle)" />
      <rect data-candle="wick-low" x="27" y="59" width="4" height="11" rx="2" fill="var(--tckr-logo-candle)" />
    </svg>
  );
}

export function TckrLogo({ size = 24 }: TckrLogoProps) {
  const markHeight = Math.round(size * 1.15);
  return (
    <span data-tckr-logo className="inline-flex items-end" style={{ gap: Math.max(1, Math.round(size * 0.06)) }}>
      <TckrMark height={markHeight} />
      <span
        data-wordmark
        aria-hidden="true"
        className="font-mono font-semibold tracking-[-0.02em] leading-[0.92] text-[var(--tckr-logo-ink)]"
        style={{ fontSize: size }}
      >
        ckr
      </span>
    </span>
  );
}

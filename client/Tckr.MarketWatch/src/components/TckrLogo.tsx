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

export function TckrLogo({ size = 24 }: TckrLogoProps) {
  const markHeight = Math.round(size * 1.15);
  const markWidth = Math.round(markHeight * 0.8);
  return (
    <span className="inline-flex items-end" style={{ gap: Math.max(1, Math.round(size * 0.06)) }}>
      <svg
        width={markWidth}
        height={markHeight}
        viewBox="0 0 58 72"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="flex-none"
      >
        <rect x="2" y="4" width="54" height="11" rx="5.5" fill="var(--tckr-logo-ink)" />
        <rect x="27" y="15" width="4" height="10" fill="var(--tckr-logo-candle)" />
        <rect x="17" y="25" width="24" height="34" rx="6" fill="var(--tckr-logo-candle)" />
        <rect x="27" y="59" width="4" height="11" rx="2" fill="var(--tckr-logo-candle)" />
      </svg>
      <span
        aria-hidden="true"
        className="font-mono font-semibold tracking-[-0.02em] leading-[0.92] text-[var(--tckr-logo-ink)]"
        style={{ fontSize: size }}
      >
        ckr
      </span>
    </span>
  );
}

/**
 * The Frost field's three colour glows (DESIGN.md › Colors › Glow Mint / Coral /
 * Periwinkle): large, 70px-blurred radial blobs behind everything, atmosphere only,
 * removed below 640px.
 *
 * One definition, two layers. The page draws them `fixed` behind the app; the daily
 * greeting (`motion/Greeting.tsx`) draws the same three inside its own full-viewport
 * overlay. Because both are measured from the viewport, the overlay's light sits exactly
 * on the page's, so when the overlay dissolves at the hand-off only the content appears.
 * The light never moves.
 */
const GLOWS = [
  'top-[-180px] right-[-80px] w-[720px] h-[560px] bg-[radial-gradient(circle_at_60%_40%,var(--tckr-blob-a),transparent_68%)]',
  'top-[90px] right-[280px] w-[480px] h-[440px] bg-[radial-gradient(circle_at_50%_50%,var(--tckr-blob-b),transparent_70%)]',
  'bottom-[-220px] left-[-140px] w-[720px] h-[600px] bg-[radial-gradient(circle_at_40%_60%,var(--tckr-blob-c),transparent_70%)]',
] as const;

export function FrostGlows({ layer }: { readonly layer: 'page' | 'overlay' }) {
  const position = layer === 'page' ? 'fixed -z-1' : 'absolute';
  return (
    <>
      {GLOWS.map((glow) => (
        <span
          key={glow}
          data-frost-glow
          className={`${position} rounded-full blur-[70px] pointer-events-none max-[640px]:hidden ${glow}`}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/** The user's reduced-motion preference, read at the moment of use (it can change while
 * the page is open). Every animation decision in the app goes through this one check. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

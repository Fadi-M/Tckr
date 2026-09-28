---
paths:
  - "src/motion/**/*"
  - "src/styles/**/*"
---

# Motion

Rules are in `GUIDELINES.md` §1 (lazy GSAP), §5 and §7. They apply here in these ways:

- Only `src/motion/gsap.ts` imports `gsap`. Everything else uses `loadMotion()` /
  `useMotion()`. Don't use `@gsap/react`.
- Animate transform and opacity only. Every moment has a reduced-motion path.
- Tests go through `src/motion/__tests__/motionTestSupport.ts` (`primeMotion`,
  `finishMotion`).
- Moments are named and specified in `DESIGN.md` (§Moments, the daily greeting, the board
  re-rank). Follow the spec; don't invent new motion.
- `emil-design-eng` is the rulebook. A motion diff gets `review-animations` in `/postflight`.

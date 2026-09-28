---
paths:
  - "src/chart/**/*"
  - "src/display/**/*"
  - "src/components/PriceCell.tsx"
  - "src/pages/StockList.tsx"
---

# Chart and hot render path

Rules are in `GUIDELINES.md` §5 (performance) and §2 (price correctness). They apply here in
these ways:

- This is the tick-to-paint path. Keep work in the coalesced rAF flush. Don't add
  per-tick React state or per-tick layout reads.
- Ref reads during render in `PriceCell` and `RollingText` are deliberate (see
  §3, React Compiler lint rules). Don't "fix" them into state.
- `uplot` is imported only here, and must stay out of the entry chunk (`npm run check:bundle`).
- A change here triggers the `performance-analyzer` agent in `/postflight`. Re-run
  `npm run test:perf` if the render cost could have moved.

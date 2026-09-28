---
name: postflight
description: End-of-task check for Tckr.MarketWatch against GUIDELINES.md's Definition of done. Run before reporting any code, UI, docs, or config task in this package as done.
---

# postflight

Walk `GUIDELINES.md` §Definition of done for the current diff (`git diff` plus untracked
files) and report the result as a checklist. Re-read the section first; don't work from
memory.

1. **Mechanical checks.** Run `npm run check` (typecheck, lint, test, build, bundle
   budget). Paste the failing output if anything fails, and fix it before continuing.
2. **Tests.** For each behaviour change, name the test that covers it. If one is missing,
   write it (`gen-test` / `test-writer`) before continuing.
3. **Review passes.** Run the ones the diff calls for, and fix or explicitly answer each
   finding:
   - Always: `/code-review` on the diff. Run `/simplify` if the diff is non-trivial.
   - Data layer, config, env, or rendering external data: `/security-review`.
   - UI: `/impeccable critique` and `/impeccable audit` on the changed surface. Then look at
     it in the running app (`/run`, market hours via `npm run dev:open` if relevant), in
     light and dark, at 400 px.
   - Motion: `review-animations`, and confirm reduced-motion behaviour.
   - `src/chart/**`, `TickDispatcher`, `store`, board render path: the
     `performance-analyzer` agent. Re-run `npm run test:perf` and update
     `docs/phase-3-web-client/results.md` if the numbers moved.
4. **Guideline drift.** Did this task break a rule, or reveal a new one? Update
   `GUIDELINES.md`. Mark a rule **[enforced]** only if a check exists.
5. **Docs.** Update `README.md`, `CLAUDE.md`, ADRs, and `client-contract.md` if behaviour,
   commands, config, or decisions changed.
6. **Known debt.** Remove items this task fixed. Add any debt it knowingly left.

Finish with a status line for each item: done, skipped (why), or not applicable. Never
report the task done while a mechanical check fails.

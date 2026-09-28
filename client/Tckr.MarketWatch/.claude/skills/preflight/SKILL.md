---
name: preflight
description: Start-of-task check for Tckr.MarketWatch against GUIDELINES.md. Run before planning or editing for any code, UI, docs, or config task in this package; skip for pure questions.
---

# preflight

Before planning or editing, produce a short preflight note, 15 lines at most, and show it to
the user.

1. **Re-read `GUIDELINES.md`.** Don't rely on memory of it; it changes. Also read
   `git status` and `git log -5 --oneline` for context.
2. **Classify the task.** Mark every area it touches: data layer / price path / chart /
   board render / motion / UI surface / config-env / docs / dependencies.
3. **List the rules in play.** Cite section and rule, e.g. "§2 no floats on a price",
   "§1 one seam". For each, say how this task could break it.
4. **Find the prior art.** Name the ADRs, contract sections (`client-contract.md`),
   `DESIGN.md` rules, or `README.md` sections the task must honour. Read the relevant ones
   now.
5. **Check Known debt.** Does the task touch a §Known debt item? Say whether it will fix,
   work around, or leave it.
6. **Plan the reviews.** From the §Definition of done, list which conditional reviews will
   apply (security-review, impeccable, review-animations, performance-analyzer), so
   they're planned for, not discovered at the end.
7. **Pick the right lens** for the plan: `software-design-philosophy` for module or API
   shape, `refactoring-patterns` for restructuring, `impeccable shape` for a new surface,
   `design-everyday-things` for state and feedback design, `improve-retention` /
   `hooked-ux` for first-run or engagement (bounded by §8).

If the task conflicts with a rule, stop and raise it with the user before planning. Don't
quietly work around the rule. If it needs an ADR, say so up front.

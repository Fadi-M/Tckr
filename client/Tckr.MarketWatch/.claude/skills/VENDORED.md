# Vendored skills

These skills are copied verbatim from [wondelai/skills](https://github.com/wondelai/skills)
(MIT, see `WONDELAI-LICENSE`), commit `c172996` (2026-09-10), on 2026-09-28.

| Skill | Why it is here |
|---|---|
| `software-design-philosophy` | Planning/review lens for module and API design (deep modules, information hiding) |
| `refactoring-patterns` | Named, behavior-preserving refactors for the large page/chart components |
| `design-everyday-things` | Conceptual models and error design for connection/entitlement states |
| `improve-retention` | First-run friction and event-based prompts (B=MAP) |
| `hooked-ux` | Engagement loops, gated by the Manipulation Matrix and GUIDELINES.md §Engagement ethics |

Do not edit these folders. Where a skill's advice conflicts with this repo, the conflict is
recorded in `GUIDELINES.md` (§Skill precedence), which wins.

## Upgrading

```bash
git clone --depth 1 https://github.com/wondelai/skills /tmp/wondelai
for s in software-design-philosophy refactoring-patterns design-everyday-things improve-retention hooked-ux; do
  rm -rf ".claude/skills/$s" && cp -R "/tmp/wondelai/$s" .claude/skills/
done
git -C /tmp/wondelai log -1 --format='%h %cs'   # record the new commit above
git diff --stat .claude/skills                   # review what changed before committing
```

# Lessons Learned — Index

Institutional memory for failure patterns across the AI Triad Research project.
Organized by category. Each file contains the full pattern details.

**Last updated:** 2026-07-26 | **Total patterns:** 81 | **Resolved:** 21 | **Active:** 60

## Summary

| Category | File | Patterns | Resolved | Active |
|----------|------|----------|----------|--------|
| Build | [build.md](build.md) | 50 | 10 | 40 |
| PowerShell | [powershell.md](powershell.md) | 7 | 3 | 4 |
| Data | [data.md](data.md) | 3 | 1 | 2 |
| Type System | [type-system.md](type-system.md) | 4 | 0 | 4 |
| Process | [process.md](process.md) | 13 | 7 | 6 |
| API | [api.md](api.md) | 3 | 0 | 3 |
| Design | [design.md](design.md) | 1 | 0 | 1 |

## AGENTS.md Rules (Escalated from Sage)

Seven patterns crossed the 3-instance threshold (or were high-severity) and became systemic rules:

1. **Shell Quoting Rule** — root AGENTS.md (q/4, p/8#7)
2. **Strict Mode + JSON Guardrails** — `scripts/AGENTS.md` (p/20#12)
3. **Data File Convention** — root AGENTS.md (p/8#22)
4. **Git Commit Rule (Multi-Agent)** — root AGENTS.md (p/8#25)
5. **Overlay Repo — expanded ogit + add -f** — root AGENTS.md (p/8#28)
6. **Git `--` flag ordering** — root AGENTS.md (p/8#30, overlay 95e9c3b)
7. **Git Forensics — object level, never inference** — root AGENTS.md Common Traps (p/8#53, approved p/8#54, patterns #44/#54/#55)
8. **Gate Signal Integrity — verify + co-locate** — root AGENTS.md + TL AGENTS.md (overlay 5732aa7, t/1589, patterns #20/#46/#48/#61/#64)

## Quick Reference — Top Recurring Patterns

- **Overlay repo (ogit)** — 7 instances, 4 agents → [build.md](build.md)
- **Bash heredoc/quoting** — 10 instances, 7 agents → [build.md](build.md) (incl. `pwsh -File` over inline `-Command` for non-trivial PS, p/20#23)
- **Git `--` flag ordering** — 4 instances, 4 agents → [build.md](build.md) (main-repo ✓ resolved via rule + hook; **overlay `ogit` form recurred 2026-07-26, suspected hook-coverage gap** — flagged to Diagnostics, p/217#1)
- **Push contention (multi-agent)** — 6 instances, 5 agents → [build.md](build.md) (**split by scale:** small commit-to-push contention is self-correcting/not escalating; the LARGE-divergence variant — p/9#36, local 46 ahead/origin 52 ahead — is a push-cadence-ceiling breach that hits out-of-scope conflicts and needs TL/DevOps)
- **JSON schema assumptions** — 6 instances, 2 agents → [data.md](data.md)
- **PS strict mode + JSON** — 3 instances → [powershell.md](powershell.md)
- **Pathspec skips untracked** — 4 instances, 4 agents → [build.md](build.md) (not escalating — self-correcting)
- **Bash dollar-sign substitution** — 2 instances → [build.md](build.md)
- **Python cp1252 encoding** — 5 instances, 2 agents → [build.md](build.md) (not escalating — self-correcting)
- **Worktree-land / divergence-window hazards** — 6 git-side footguns + 2 env/cleanup hazards, 5 agents (Server Storage, DebateTool, PowerShell, ElectronMain, Shared Lib), 2026-07-17 → 07-26 during active push-cadence lands → [build.md](build.md). Common root: *during a land/divergence, never assume a file's working-tree content is local HEAD or that your commit/tree contains what you intended; scope by path, check file-counts, act at the object level.* Git footguns: #72 (`git diff HEAD..origin/main` false-flags your own unpushed files + verify dirties snapshots); #74 (bare `git restore <file>` reverts to local HEAD wiping origin-side content); #75 (`git checkout -- .` / `git restore .` reverts ALL unstaged tracked edits, untracked survivors mask the loss); #76 (`git commit -- <explicit list>` silently omits a glob-staged file → broken origin, file-count is the tell); + #73 facet-B (`git show <ref>:<path>` MSYS-mangling signature). #79 (`cp`-ing a whole file from the shared tree into a worktree sweeps in its uncommitted WIP — a BOM + unrelated model-bump rode into a commit; `git diff --stat` line-gap is the tell but content-diff-vs-origin is what identifies it; step-3 refinement: re-apply edits onto origin-clean files). Env/cleanup hazards: #77 (`npm ci` in a fresh worktree leaves an empty package dir → false `tsc` TS2307); #78 (`git worktree remove` fails exit 128 on the untracked node_modules that in-worktree `npm ci` creates → needs `--force`; a `/land-from-worktree` step-8 wording gap). **Escalation status (2026-07-17):** TL folded the cluster (#72/#74/#75/#76/#77) + the #73 facet-B MSYS signature into a 4-item AGENTS.md/`/land-from-worktree` batch, owner-gated, being surfaced to the owner now (p/8#86). Diagnostics **shipped** the `staged-files-after-commit` hook for #76 (p/9#33, inert until next sync per #68); the broad-scope-revert hook for #75 is still pending Diagnostics' feasibility call (p/9#27).
- **Lossy error boundaries (generic recovery discards a real payload)** — 5 instances, 3 agents (TL + PowerShell + Diagnostics) → [api.md](api.md) (**escalation resolved 2026-07-17** — genus broadened past the provider edge to any recovery/parse boundary, e.g. `parseAIJson`→null dropping 7 debater sketches, t/1626. Two-track fix, both landed: Diagnostics expanded the t/1623 `lossy-error-boundary-guard` hook to a 2nd boundary Family B (`parseAIJson`/`repairJson` + `argumentNetwork.ts`, p/9#23) — **verified live + t/1623 closed** (p/9#25: template intact across 55 manifest snapshots, Family-A blockers t/1620/t/1621 also landed); TL-approved minimal debate-local rule landed in `lib/debate/AGENTS.md` by DebateTool (overlay 31e0eeb, p/70#5) — recovery-that-drops-a-non-empty-payload = silent lossy failure, not recovery)

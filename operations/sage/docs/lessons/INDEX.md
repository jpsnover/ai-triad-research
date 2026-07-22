# Lessons Learned — Index

Institutional memory for failure patterns across the AI Triad Research project.
Organized by category. Each file contains the full pattern details.

**Last updated:** 2026-07-17 | **Total patterns:** 74 | **Resolved:** 21 | **Active:** 53

## Summary

| Category | File | Patterns | Resolved | Active |
|----------|------|----------|----------|--------|
| Build | [build.md](build.md) | 44 | 10 | 34 |
| PowerShell | [powershell.md](powershell.md) | 7 | 3 | 4 |
| Data | [data.md](data.md) | 3 | 1 | 2 |
| Type System | [type-system.md](type-system.md) | 4 | 0 | 4 |
| Process | [process.md](process.md) | 12 | 7 | 5 |
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
- **Bash heredoc/quoting** — 9 instances, 7 agents → [build.md](build.md)
- **Git `--` flag ordering** — 3 instances, 3 agents → [build.md](build.md) ✓ resolved
- **Push contention (multi-agent)** — 4 instances, 4 agents → [build.md](build.md) (not escalating — self-correcting)
- **JSON schema assumptions** — 6 instances, 2 agents → [data.md](data.md)
- **PS strict mode + JSON** — 3 instances → [powershell.md](powershell.md)
- **Pathspec skips untracked** — 4 instances, 4 agents → [build.md](build.md) (not escalating — self-correcting)
- **Bash dollar-sign substitution** — 2 instances → [build.md](build.md)
- **Python cp1252 encoding** — 5 instances, 2 agents → [build.md](build.md) (not escalating — self-correcting)
- **Lossy error boundaries (generic recovery discards a real payload)** — 5 instances, 3 agents (TL + PowerShell + Diagnostics) → [api.md](api.md) (**escalation resolved 2026-07-17** — genus broadened past the provider edge to any recovery/parse boundary, e.g. `parseAIJson`→null dropping 7 debater sketches, t/1626. Two-track fix, both landed: Diagnostics expanded the t/1623 `lossy-error-boundary-guard` hook to a 2nd boundary Family B (`parseAIJson`/`repairJson` + `argumentNetwork.ts`, p/9#23) — **verified live + t/1623 closed** (p/9#25: template intact across 55 manifest snapshots, Family-A blockers t/1620/t/1621 also landed); TL-approved minimal debate-local rule landed in `lib/debate/AGENTS.md` by DebateTool (overlay 31e0eeb, p/70#5) — recovery-that-drops-a-non-empty-payload = silent lossy failure, not recovery)

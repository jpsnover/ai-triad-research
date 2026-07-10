# Lessons Learned — Index

Institutional memory for failure patterns across the AI Triad Research project.
Organized by category. Each file contains the full pattern details.

**Last updated:** 2026-07-09 | **Total patterns:** 58 | **Resolved:** 16 | **Active:** 42

## Summary

| Category | File | Patterns | Resolved | Active |
|----------|------|----------|----------|--------|
| Build | [build.md](build.md) | 33 | 7 | 26 |
| PowerShell | [powershell.md](powershell.md) | 7 | 3 | 4 |
| Data | [data.md](data.md) | 3 | 1 | 2 |
| Type System | [type-system.md](type-system.md) | 3 | 0 | 3 |
| Process | [process.md](process.md) | 9 | 5 | 4 |
| API | [api.md](api.md) | 2 | 0 | 2 |
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

## Quick Reference — Top Recurring Patterns

- **Overlay repo (ogit)** — 7 instances, 4 agents → [build.md](build.md)
- **Bash heredoc/quoting** — 8 instances, 6 agents → [build.md](build.md)
- **Git `--` flag ordering** — 3 instances, 3 agents → [build.md](build.md) ✓ resolved
- **Push contention (multi-agent)** — 4 instances, 4 agents → [build.md](build.md) (not escalating — self-correcting)
- **JSON schema assumptions** — 6 instances, 2 agents → [data.md](data.md)
- **PS strict mode + JSON** — 3 instances → [powershell.md](powershell.md)
- **Bash dollar-sign substitution** — 2 instances → [build.md](build.md)
- **Python cp1252 encoding** — 2 instances → [build.md](build.md)

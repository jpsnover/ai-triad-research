# Error Diagnosis Format

**Status:** Canonical (shared)
**Owner:** Technical Lead
**Last updated:** 2026-07-16

When reporting an error to another role — a coding agent, DevOps, the Technical Lead, or the PM — use this structured format. It forces root-cause diagnosis before a fix is proposed and gives the receiving role everything needed to act without a round-trip.

```
**Error:** [one-line summary]
**Job:** [which job/task/build]
**Root Cause:** [what actually went wrong]
**Location:** [file:line — function]
**Blast Radius:** [what else is affected]
**Introduced By:** [recent commit or pre-existing]
**Fix:**
1. [specific step]
2. [specific step]
**Owning Agent:** [the role that should implement the fix]
```

## Field guidance

- **Error** — a single line a human can scan. Not a stack trace.
- **Job** — the CI job, build, cmdlet, or task where it surfaced.
- **Root Cause** — what *actually* went wrong, traced across the full call chain. Not the symptom. If you can't name the root cause, you are not ready to route the fix.
- **Location** — `file:line — function`. Point at the code, not the log line.
- **Blast Radius** — what else this breaks or masks. Names the other roles/scopes affected.
- **Introduced By** — check `git blame` / recent commits. "Recent commit `<sha>`" or "pre-existing." This decides whether the fix is a revert or a forward change.
- **Fix** — concrete, ordered steps. Each step is something the owning agent can execute.
- **Owning Agent** — the role that owns the file(s) in the Fix. Resolve with `resolve_owner` if unsure. (Legacy docs call this **Owning Profile** — same meaning; "profile" was the old term for a role/scope.)

## When to use it

- Reporting a CI failure or production blocker to the owning role
- Handing a UAT bug to the agent who will fix it
- Any cross-role error hand-off where the receiver must act without re-diagnosing

Diagnosis-only roles (e.g. Diagnostics) produce this as the output of their *Recommend* step and ping the Technical Lead with it. Build/deploy roles (e.g. DevOps) produce it for build and deployment failures. The Technical Lead uses it when routing fixes to coding agents.

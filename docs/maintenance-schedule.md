# Maintenance Schedule

Codified list of recurring maintenance tasks. Each task has a cadence, owner, and command or procedure. Agents should check this schedule at session start and execute any overdue tasks for their scope.

## Per-Session (Every Agent Start)

| Task | Owner | Command / Procedure |
|------|-------|---------------------|
| Check ticket queue | Each agent | `list_tickets` — work unblocked items |
| Read inbox | Each agent | Check pings and email for action items |
| Scan recent commits | Tech Lead | `git log --oneline -20` — spot regressions, verify merged PRs |

## Per-Task Completion

| Task | Owner | Command / Procedure |
|------|-------|---------------------|
| Run verify gate | Taxonomy Editor agent | `cd taxonomy-editor && npm run verify` |
| Run Pester tests | PowerShell agent | `Invoke-Pester ./tests/` |
| Type-check server | Taxonomy Editor agent | `cd taxonomy-editor && npx tsc -p tsconfig.server.json --noEmit` |

## Weekly

| Task | Owner | Command / Procedure |
|------|-------|---------------------|
| Dependency audit (npm) | Tech Lead → route to Taxonomy Editor | `cd taxonomy-editor && npm audit` — triage per `docs/security/dependency-policy.md` CVE SLA |
| Dependency audit (pip) | Tech Lead → route to PowerShell agent | `pip-audit -r scripts/requirements.txt` — triage per dependency policy CVE SLA |
| Review Dependabot PRs | Tech Lead | Check GitHub PR queue for Dependabot updates, review + merge or close |
| CodeQL alert review | Tech Lead | GitHub Security tab → review new alerts, triage, ticket actionable ones |
| Flight recorder spot check | Tech Lead | Pull a recent flight recorder dump, scan for recurring `system.error` patterns |
| SBOM currency check | Taxonomy Editor agent | `cd taxonomy-editor && npm run licenses && git diff THIRD-PARTY-NOTICES.txt` — commit if changed |

## Monthly

| Task | Owner | Command / Procedure |
|------|-------|---------------------|
| Security review | Tech Lead (spawn `security-reviewer`) | Review changes touching auth, secrets, user input from past month |
| Performance review | Tech Lead | Check flight recorders for latency trends; review `adminReviewStats` for >10s operations |
| Dead code scan | Tech Lead (spawn reviewer) | `depgraph --orphans` + grep for unused exports across `lib/` |
| Coverage trend check | Tech Lead | Compare current coverage thresholds vs actuals — raise thresholds if actuals are 10%+ above |
| CLAUDE.md accuracy audit | Tech Lead | Read CLAUDE.md end-to-end, verify paths/versions/conventions match reality |
| ESLint warning review | Taxonomy Editor agent | `cd taxonomy-editor && npx eslint src/ 2>&1 \| grep "warning"` — ticket any new categories |
| Azure cost review | DevOps | Check Azure portal for cost anomalies (Container Apps, Storage, Key Vault) |

## Quarterly

| Task | Owner | Command / Procedure |
|------|-------|---------------------|
| Architecture review | Tech Lead | Full system review: are patterns holding? New tech debt? Document in ADR if decisions change |
| ADR review | Tech Lead | Read `docs/design/adr/` — any decisions to revisit or supersede? |
| Major dependency evaluation | Tech Lead | Check for major version bumps in core deps (React, Electron, Vite, Zustand, Zod). Evaluate breaking changes, ticket upgrades |
| Code review guide refresh | Tech Lead | Review `docs/CodeReview/` guides — add patterns learned from recent reviews |
| LessonsLearned consolidation | Sage | Review `docs/LessonsLearned.md` — archive resolved items, extract patterns into CLAUDE.md or AGENTS.md |
| Test suite health | Tech Lead | Are tests meaningful? Any flaky tests? Any areas with zero coverage that should have some? |

## Per-Release

| Task | Owner | Command / Procedure |
|------|-------|---------------------|
| Regenerate SBOM | Taxonomy Editor agent | `cd taxonomy-editor && npm run licenses` — commit updated THIRD-PARTY-NOTICES.txt |
| Validate module manifest | PowerShell agent | `Test-ModuleManifest -Path ./build/AITriad/AITriad.psd1` |
| Version consistency check | Tech Lead | Verify version matches across: `AITriad.psd1` (source + build), `package.json`, CLAUDE.md |
| Container smoke test | DevOps | Build container locally, run health check: `curl http://localhost:7862/health` |
| Security checklist | Tech Lead | No secrets in code/config/images, CORS configured, CSP headers set, rate limits active |

## Ad-Hoc (Triggered by Events)

| Trigger | Task | Owner |
|---------|------|-------|
| UAT bug found | Triage: why didn't tests catch it? What test to add? Cross-feature interaction? | Tech Lead |
| CI failure on main | Root-cause analysis, fix, regression test | Tech Lead → route to owning agent |
| New agent/role created | Review scope boundaries, update CODEOWNERS, verify AGENTS.md | Tech Lead |
| Post-incident | Write postmortem, update LessonsLearned.md, ticket preventive measures | Tech Lead + Sage |
| Flight recorder shows recurring error (3+ occurrences) | Investigate root cause, ticket fix | Tech Lead |

## How to Use This Schedule

**For agents:** Check overdue tasks for your scope at session start. Execute what's due. Update ticket or ping Tech Lead with findings.

**For Tech Lead:** Use this as a checklist during weekly planning. Create tickets for findings. Route execution to owning agents.

**For humans:** Review monthly and quarterly tasks during planning. Adjust cadences based on project phase (faster during active development, slower during maintenance).

**Tracking:** When a scheduled task surfaces a finding, create a ticket. Reference this schedule in the ticket description so the pattern is traceable.

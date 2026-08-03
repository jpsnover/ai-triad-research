# Dependency Policy

**Status:** Active
**Last reviewed:** 2026-08-03
**Owner:** Technical Lead

This policy governs third-party dependency selection, license compliance, and vulnerability response for the AI Triad Research project. It turns the SBOM (`THIRD-PARTY-NOTICES.txt`) from documentation into governance.

## License Policy

The project is licensed under MIT. All dependencies must be compatible with MIT redistribution.

### Allowed Licenses (no review needed)

| License | SPDX ID |
|---------|---------|
| MIT | MIT |
| MIT No Attribution | MIT-0 |
| Apache 2.0 | Apache-2.0 |
| BSD 2-Clause | BSD-2-Clause |
| BSD 3-Clause | BSD-3-Clause |
| ISC | ISC |
| Zero-Clause BSD | 0BSD |
| Creative Commons Zero | CC0-1.0 |
| Unlicense | Unlicense |
| Blue Oak Model License | BlueOak-1.0.0 |
| Python Software Foundation | Python-2.0 |
| Creative Commons Attribution | CC-BY-3.0, CC-BY-4.0 |
| WTFPL | WTFPL |

### Review-Required Licenses (case-by-case approval)

| License | SPDX ID | Notes |
|---------|---------|-------|
| Mozilla Public License 2.0 | MPL-2.0 | File-level copyleft — acceptable if we don't modify MPL-licensed files |
| Dual-licensed (MIT or GPL) | Various | Acceptable if we explicitly use under the MIT option |
| LGPL 2.1 / 3.0 | LGPL-2.1, LGPL-3.0 | Acceptable for dynamically linked dependencies (npm packages qualify); not for statically bundled code without source disclosure |

### Banned Licenses

| License | SPDX ID | Reason |
|---------|---------|--------|
| GPL 2.0 / 3.0 (sole license) | GPL-2.0-only, GPL-3.0-only | Copyleft incompatible with MIT project |
| AGPL 3.0 | AGPL-3.0 | Network copyleft — triggers on server use |
| Server Side Public License | SSPL-1.0 | MongoDB-style copyleft — incompatible |
| Business Source License | BUSL-1.1 | Not open source; restricts production use |
| No license declared | UNLICENSED | Legal risk — cannot determine rights |

### Current Exceptions

| Package | License | Status | Notes |
|---------|---------|--------|-------|
| jszip@3.10.1 | MIT OR GPL-3.0 | Approved | Used under MIT option |
| Packages with `Apache-2.0 AND LGPL-3.0-or-later` | Dual | Approved | npm dynamic linking qualifies under LGPL |
| 1 UNLICENSED package | None | Needs investigation | Identify and replace or vendor with attribution |

## Vulnerability Response SLA

| Severity | Response Time | Action |
|----------|--------------|--------|
| Critical (CVSS 9.0+) | 48 hours | Patch, upgrade, or remove. If no fix available, document mitigation and set a review date. |
| High (CVSS 7.0-8.9) | 7 days | Patch or upgrade. Dependabot PRs for high-severity should not sit unmerged. |
| Medium (CVSS 4.0-6.9) | 30 days | Address in next scheduled maintenance cycle. |
| Low (CVSS < 4.0) | Next maintenance cycle | Address when convenient. Track in ticket if persistent. |

Response time starts when the vulnerability is reported (Dependabot alert, `npm audit`, `pip-audit`, or manual discovery). The clock runs on business days.

### Process

1. **Dependabot** creates PRs automatically for known vulnerabilities (npm, pip, GitHub Actions)
2. **Weekly audit** (`npm audit` + `pip-audit`) per maintenance schedule — Tech Lead triages, routes to owning agent
3. **Critical/High**: Tech Lead creates a ticket immediately, assigns to owning agent, sets due date per SLA
4. **Medium/Low**: Batch into maintenance tickets, address in the next cycle

## Code Scanning Alert Triage

GitHub's Security → Code scanning tab holds two unrelated queues under one number. Triage them separately; the combined total is not a meaningful metric.

| Queue | Tool | Owner | What it means |
|---|---|---|---|
| Source SAST | CodeQL | Tech Lead | A finding in code we wrote. Each one is individually actionable. |
| Container CVE | Trivy | DevOps | A CVE in a base-image or npm-global layer. Remediated by bumping the image, not by editing our code. |

**Count Trivy by unique CVE ID, never by alert count.** Every image build re-files the same findings against the image ref and the prior alerts do not auto-close, so the alert count inflates without any change in real exposure. As of 2026-08-03 the queue held 1,066 Trivy alerts covering 263 unique CVEs — a ~4x multiplier. Any SLA written against the alert count is unmeetable by construction.

### SLA Applicability

The Vulnerability Response SLA above applies to the **Trivy** queue by CVE severity, exactly as it does to Dependabot alerts.

For the **CodeQL** queue the SLA is different, because CodeQL severity measures query confidence rather than exploitability:

| CodeQL severity | Requirement |
|---|---|
| Critical / High | Fix or dismiss within 7 days. The CI gate blocks new high+ findings on a PR, so anything at this level on `main` means the gate was bypassed — investigate that too. |
| Medium / Low / Note | **Verdict** within 30 days, not necessarily a fix. A written "by design, here's why" closes the SLA. |

The distinction matters: the `codeql.yml` CI gate is **differential** — only *new* high+ findings fail a PR. Nothing in the medium backlog blocks anything, so the backlog only shrinks if someone works this schedule. It does not self-clear.

### Dismissal Rules

1. **Every dismissal carries a written justification** in `dismissed_comment` — source, sink, and why the flow is safe. "Looks fine" is not a justification. This is the Gate Co-Location rule: the reasoning lives at the alert, not in ticket history.
2. **Production code is confirmed by its owning agent before dismissal.** Route the alert to the owner, get the source/sink analysis on a ticket, then dismiss citing it. The TL does not dismiss production-code alerts on inspection alone.
3. **Analysis scripts and dev tooling** (`research/*/scripts/`, `taxonomy-editor/tools/`) may be dismissed as `won't fix` directly — not shipped surface. Say so in the comment.
4. **Never dismiss to make a number go down.** An alert that is real and unfixed stays open with a ticket reference.
5. Dismissing requires code-scanning write permission, which the agent fleet does not currently hold — agents supply the justification, a human or the TL applies it.

## New Dependency Evaluation

Before adding any new dependency, evaluate against this checklist:

### Required Checks

- [ ] **License compatible?** — Must be on the Allowed list or get Review-Required approval
- [ ] **Actively maintained?** — Last commit within 12 months, issues triaged, not archived
- [ ] **Security track record?** — Fewer than 3 critical CVEs in the past year
- [ ] **Size reasonable?** — Check bundle impact (`npx bundlephobia <package>` or `npm pack --dry-run`). Reject if it adds >500KB for a utility function
- [ ] **No better alternative?** — Is there a lighter, more maintained, or already-included package that does the same thing?
- [ ] **TypeScript types available?** — `@types/*` package or built-in types. Untyped JS packages require justification.

### For Python Dependencies

- [ ] License compatible (check PyPI classifiers)
- [ ] Pinned to exact version in `requirements.txt` (no floating `>=`)
- [ ] No native compilation requirements that complicate container builds (or documented in Dockerfile)

### Documentation

When adding a new dependency, note in the PR description:
- Why it's needed (what it does that we can't do ourselves in <50 lines)
- License
- Bundle size impact
- Alternatives considered

## SBOM Management

- `THIRD-PARTY-NOTICES.txt` is generated via `npm run licenses` and committed to the repo
- Regenerated before each release and verified in CI (diff check)
- Python SBOM: `requirements.txt` serves as the manifest; `pip-audit` checks vulnerabilities
- Covers direct and transitive npm dependencies via `generate-license-file`

## Audit Schedule

| Cadence | Task | Owner |
|---------|------|-------|
| Weekly | `npm audit` + `pip-audit` | Tech Lead (triage) → owning agent (fix) |
| Weekly | Review and merge Dependabot PRs | Tech Lead |
| Monthly | Full license scan — check for new UNLICENSED or banned licenses | Tech Lead |
| Per-release | Regenerate SBOM, verify currency | Taxonomy Editor agent |

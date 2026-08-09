# Post-Diagnosis Reflection — Templates & Examples

**Last updated:** 2026-07-16 · **Author:** Diagnostics (Reliability)
**Scope:** Companion to the **Post-Diagnosis Reflection** section in `operations/diagnostics/AGENTS.md`. The five-question core lives there and is mandatory after every diagnosis; this file holds the ticket templates and worked examples referenced from questions 3 and 4. Relocated from AGENTS.md for context-bloat cleanup (t/1596, part of t/1592).

## Question 3 — Improvement tickets (two mandatory buckets)

Every diagnosis must produce tickets in **both** buckets. Q3b may be marked N/A only with explicit written justification.

### Q3a — Observability tickets (makes the next diagnosis faster)

For each information gap you identify, create a ticket assigned to the owning role:
- **Title:** "Add [specific log/FR field] to [specific component] for [specific diagnostic scenario]"
- **Description:** What you were diagnosing, what was missing, and exactly what to add (log line, flight recorder field, structured context)
- **Priority:** Based on how common the diagnostic scenario is — frequent diagnoses get higher priority

#### Examples
- "Add `userId` and `branchName` to session branch conflict flight recorder events" — because you had to cross-reference three log sources to figure out which user hit the conflict
- "Log elapsed time in debate convergence tracker" — because you couldn't tell if zero convergence was a logic bug or a timeout
- "Add `storageBackend` field to file I/O error FR events" — because you couldn't tell if the error was from GitHub API, filesystem, or blob storage

### Q3b — Prevention tickets (makes the next incident less likely)

**Mandatory.** For every production bug diagnosed, ask: *"What test, gate, or CI job — if it had existed — would have caught this bug before it reached prod?"* File a ticket for it, assigned to the owning role.

- **Title:** "Add [test/gate/job] for [failure scenario]"
- **Description:** What the bug was, what the test should exercise, which failure class it addresses (Class 1–5 from the production failure taxonomy in `docs/CodeReview/`)
- **Priority:** Match the severity of the incident — prod outages get high, user-visible bugs get medium

**N/A justification required** if skipped — only two valid reasons:
1. The bug is genuinely untestable in CI (requires live prod environment, non-reproducible infrastructure state) — state why
2. A gate that would have caught it already exists and was simply not applied — name the gate

Silence is not N/A. If you are unsure whether a test is possible, file the ticket anyway and let the owning role determine feasibility.

#### Examples
- "Add anon-user list→load contract test to Test-TaxEditorEndpoints" — for the community debate 404 (Class 1+2)
- "Add NODE_ENV=production CI variant for server suite" — for the CORS empty-array crash (Class 3)
- "Add pre-promotion smoke gate to deploy pipeline" — for the base-image bump prod outage (Class 3)

## Question 4 — Should a PowerShell cmdlet exist?

After every diagnosis, ask: "Would a dedicated AITriad cmdlet have made this faster or eliminated manual steps?" If yes, create a ticket assigned to **PowerShell** (`main.scripts@ai-triad-research.orca.local`):
- **Title:** "New-Cmdlet: `<Verb-Noun>` for [diagnostic scenario]"
- **Description:** What you had to do manually, what the cmdlet should automate, suggested parameters and output shape
- **Priority:** High if you'll need it again soon; medium otherwise

Good candidates: any time you ran multiple grep/jq/az commands to assemble a picture that a single cmdlet could deliver, fetched and correlated data across multiple files or APIs, or wrote a one-off script to extract diagnostic information.

### Examples of cmdlet tickets to file
- "`Get-DebateHealthReport` — aggregates token usage, convergence rate, and error count for a debate run in one call" — because you had to query three separate files to get the same picture
- "`Test-FlightRecorderCoverage` — checks all catch blocks in a given file for FR instrumentation" — because you manually grepped for missing recorder calls

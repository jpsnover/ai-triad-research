# Process Patterns

Failure patterns related to tooling configuration, agent workflows, and operational mistakes.

---

## [Process] Write Tool Security Gate Hook Blocks All Writes (RESOLVED)

**Pattern:** The security gate feedback rule (PreToolUse hook on Write and Edit) blocks ALL file writes indiscriminately, including plain markdown with no secrets.

**Instances:**
- 2026-05-21 — Sage agent blocked on Write and Edit when creating/updating LessonsLearned.md (plain markdown, no secrets).
- 2026-05-21 — Computational Linguist agent reported Write tool and Bash heredoc both failed repeatedly when writing a large markdown document; the security gate returned a scanning prompt with no actual content to scan (p/7#1).

**Root Cause:** The hook was configured as type `block` with condition `true`, which unconditionally blocked every Edit/Write call. The scanning instructions were output as the error message but no actual content evaluation occurred.

**Resolution:** Diagnostics changed the hook from type `block` to type `context` so scanning instructions are injected as guidance rather than blocking (p/9#2). Edit/Write tools work normally now.

**Lesson:** When creating feedback rules, use type `context` for advisory/scanning guidance and only use type `block` when the condition actually evaluates the content. A `block` rule with condition `true` will reject all tool calls unconditionally.

**Status:** Resolved — hook type changed from `block` to `context` (p/9#2).

**Applies To:** Anyone creating or modifying feedback rules / hooks.

---

## [Process] Feedback Rule Referencing Non-Existent Script

**Pattern:** A feedback rule was configured to run a script that was never created, causing "Cannot find module" errors on every Edit/Write.

**Instances:**
- 2026-05-21 — PostToolUse hook for `validate-doc-metadata.js` threw "Cannot find module" on every Edit call. Script did not exist anywhere in the repo (p/9#3, p/9#4).
- 2026-05-21 — Once the script was created, it failed with "require is not defined in ES module scope" because root `package.json` has `"type": "module"`, making `.js` files ESM where `require()` is unavailable. Fixed by renaming to `.cjs` (p/9#6).
- 2026-05-21 — After `.cjs` rename, still "Cannot find module" because the hook runner's cwd wasn't the workspace root, so relative paths failed. Fixed by using absolute path via `{workspace_root}` parameter (p/9#8).

**Root Cause:** Three compounding issues: (1) hook registered before the script existed, (2) script used CommonJS `require()` in an ESM-typed project, (3) hook used relative path but runner cwd wasn't the workspace root.

**Prevention:**
1. When creating a feedback rule that references a script, verify the script exists before enabling the rule.
2. New feedback rules should be tested with a trivial edit to confirm they execute without error.
3. Create the script first, then register the hook — never the reverse.
4. In projects with `"type": "module"` in package.json, use `.cjs` extension for scripts that need `require()`, or use ESM `import` syntax in `.js` files.
5. Always use absolute paths (or `{workspace_root}` template) in hook script references — never rely on the runner's cwd being the workspace root.

**Status:** Resolved after three iterations (p/9#4 missing script, p/9#6 ESM/CJS mismatch, p/9#8 relative path).

**Applies To:** Anyone creating feedback rules that reference external scripts.

---

## [Process] Bash vs PowerShell Tool Confusion

**Pattern:** Running PowerShell cmdlets (e.g., `Get-ChildItem`) in the Bash tool instead of the PowerShell tool, causing syntax errors.

**Instances:**
- 2026-06-06 — Computational Linguist: ran `Get-ChildItem` in Bash tool, causing syntax error. Fixed by switching to PowerShell tool (p/7#13).

**Root Cause:** Agents have access to both Bash and PowerShell tools. PowerShell cmdlets (`Get-ChildItem`, `Invoke-Pester`, `Select-Object`, etc.) only work in the PowerShell tool. Unix commands (`ls`, `grep`, `cat`) only work in Bash (on Windows/Git Bash).

**Prevention:**
1. Use PowerShell tool for: cmdlets (`Get-*`, `Set-*`, `Invoke-*`), `$env:` variables, pipeline operators with objects.
2. Use Bash tool for: Unix commands, `git`, `npm`, `node`, `python3`, shell scripts.
3. When in doubt, check if the command uses a Verb-Noun pattern — if yes, it's PowerShell.

**Status:** Active

**Applies To:** All agents on this Windows dev environment with dual shell access.

---

## [Process] Ping-Acknowledge-Then-Idle

**Pattern:** Agents acknowledge a ping (reply, update status) then go idle without re-checking their ticket queue — missing unblocked assigned work that should have started immediately.

**Instances:**
- 2026-07-03 — Fleet audit (p/8#32): 4 agents found idle with unblocked high-priority tickets after being woken by pings. Hours of lost productivity.

**Root Cause:** Startup behavior only checked ticket queue on fresh session start. Ping-triggered auto-prompts re-entered the session mid-life, so the queue check was skipped.

**Prevention:**
1. Before going idle after ANY prompt (ping, email, auto-prompt), re-check ticket queue for unblocked assigned work.
2. Root AGENTS.md startup behavior updated to enforce this (p/8#32).

**Status:** Resolved — root AGENTS.md rule updated.

**Applies To:** All agents with ticket-driven workflows.

---

## [Process] One-Directional Git Ancestry Check → False Divergence Alarm

**Pattern:** Diagnosing "remote diverged" based on a one-directional `merge-base --is-ancestor` check and misreading a reverse diff — pattern-matching an expected failure shape without verifying the mechanism.

**Instances:**
- 2026-07-03 — Technical Lead: during cc→sit migration (t/1308#12), diagnosed "remote diverged during freeze" and began planning recovery. DevOps falsified it (t/1308#15): no CI exists in the data repo; commits were the owner's, pre-freeze. Same anti-pattern class as [Build] Deploy Preflight False-Red (AlertsManagement).

**Root Cause:** (1) `merge-base --is-ancestor` checked in one direction only — incomplete divergence conclusion; (2) reverse diff interpreted without labeling direction, misreading +/- lines.

**Prevention:**
1. Divergence claims require **two-directional ancestry test**: `merge-base --is-ancestor` in BOTH directions.
2. Always run `git status -sb` for ahead/behind counts.
3. Label reverse diffs with direction before interpreting +/- lines.
4. Before planning recovery, verify the *mechanism* — "CI committed during our window" is testable ("does CI exist in this repo?").

**Status:** Resolved — root AGENTS.md "Git forensics" Common Traps rule (bf738f2, p/8#58).

**Applies To:** All agents performing git divergence diagnosis, especially during migrations or freeze windows.

---

## [Process] Gate Blindness via Pre-Existing Noise (False-Green)

**Pattern:** A verification gate already exits non-zero from tolerated warnings, so new genuine errors don't change the exit code — "verify green" claims pass with live failures undetected.

**Instances:**
- 2026-07-03 — verify's eslint step was already failing from old warnings. New `RelatedEdgesPanel` errors (t/1304) survived a "green verify" claim because the exit code was already non-zero. Root cause analysis in t/1304#5, fix in c2f79267, gate repair tracked in t/1323 (p/8#37).

**Root Cause:** When a gate is already failing for tolerated/ignored reasons, agents learn to treat its failure as normal ("it always fails"). New genuine failures blend into the existing noise and go undetected. Same family as [Build] Deploy Preflight False-Red (AlertsManagement) but **inverted** — false-green instead of false-red.

**Prevention:**
1. Gates must be kept at **zero tolerated noise** — fix or suppress existing warnings before relying on the gate to catch new ones.
2. If warnings are temporarily tolerated, use **explicit baselines** (e.g., eslint `--max-warnings N`) so any *new* warning changes the exit code.
3. Periodically **assert a deliberate failure actually fails the gate** — inject a known error and confirm the gate catches it.
4. When claiming "verify green," check the actual exit code and output — not just "it ran without surprising me."

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64). Gate repair still tracked in t/1323.

**Applies To:** All agents running verify gates, CI pipelines, or any pass/fail quality checks.

---

## [Process] Gate-Flip Hygiene — Exemptions Must Live in Workflow Comments

**Pattern:** Two agents independently mislabeled a permanently annotation-only CI job (`debate-eval`) as "warning-only until 7/17" — a scheduled flip date that doesn't apply to this job. A scheduled flip date creates gravitational pull: agents assume all non-blocking jobs share the same deadline.

**Instances:**
- 2026-07-06 — Two agents independently added "warning-only until 7/17" to `debate-eval` job context, despite that job being permanently annotation-only and exempt from the flip sweep (t/1329#4, t/1332#4).

**Root Cause:** The exemption for `debate-eval` existed only in ticket history, not at the point of use. When agents encountered the job during unrelated work, they pattern-matched it to the "warning-only until flip date" convention without checking whether this specific job was exempt. Scheduled flip dates act as attractors — anything that looks similar gets pulled in.

**Prevention:**
1. Jobs exempt from a flip sweep need the exemption stated **in the workflow file comment**, not in ticket history — point-of-use beats point-of-decision.
2. When adding or updating gate annotations, verify the specific job's intended lifecycle before applying fleet-wide conventions.
3. Same principle as gate blindness (#46): gate metadata must be self-describing at point of use.

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64). Structural fix (flip/never-flip taxonomy in ci.yml header) also tracked via p/28#30.

**Applies To:** All agents modifying CI workflow files or gate annotations.

---

## [Process] Overwrite/Clobber Claims Without Blob-SHA Comparison

**Pattern:** A "commit X overwrote file F" claim is asserted, retracted, and re-confirmed across multiple diagnostic rounds — because agents reason from commit dates and symptom counts instead of comparing actual content. Three rounds of churn before the definitive check.

**Instances:**
- 2026-07-06 — Computational Linguist + 2nd agent (t/1351): a git-forensics clobber claim went through 3 diagnostic rounds across 2 agents. Ancestry got inverted twice. Resolved only when blob SHAs were compared: `git rev-parse X:path` vs `git rev-parse X~1:path` — identical blob = file untouched, debate over in one command (p/7#22).

**Root Cause:** Timeline reasoning ("commit X came after Y, so X must have overwritten Y's changes") is unreliable — commits can touch many files, and the accused commit may not have modified the file in question at all. Without content identity (blob SHA), agents pattern-match symptoms to a plausible narrative and waste rounds arguing about it.

**Prevention:**
1. For any overwrite/clobber/data-loss claim, **blob-SHA comparison is the FIRST check** — before timeline reasoning:
   - `git rev-parse <commit>:<path>` vs `git rev-parse <commit>~1:<path>` — identical SHA = file untouched at that commit.
   - `git diff <commit>~1 <commit> -- <path>` — empty diff = no change.
2. If blob SHAs differ, THEN examine what changed: `git show <commit> -- <path>`.
3. Never conclude "X overwrote F" from commit dates or symptom counts alone.
4. Same diagnostic-discipline family as #44 (one-directional ancestry → false divergence) and #54 (dirty tree as false witness): settle git disputes at the object level, not by inference.

**Status:** Resolved — root AGENTS.md "Git forensics" Common Traps rule (bf738f2, p/8#58).

**Applies To:** All agents performing git forensics — overwrite claims, data-loss triage, clobber investigations.

---

## [Process] Narrated Handoff Never Executed — "Filing" vs "Filed"

**Pattern:** A ticket comment ends with "filing a [downstream] ticket" but the ticket is never created. The completed design sits unrouted until a staleness check catches it days later.

**Instances:**
- 2026-07-09 — Computational Linguist: ticket comment said "filing a DebateTool implementation ticket" but the ticket was never created. The completed design sat unrouted 8 days until PM's staleness check found it (p/7#28).

**Root Cause:** The filing was narrated as the comment's last line instead of being done before posting. The comment described intent ("filing") rather than accomplished fact ("filed: t/NNNN"). Same family as the t/1221 "looks shipped but isn't" anti-pattern — at the handoff layer instead of the commit layer.

**Prevention:**
1. Create the downstream ticket FIRST, then write the comment referencing its key — a comment can only say "filed: t/NNNN" truthfully, never "filing."
2. If the comment is already posted without the ticket, create the ticket immediately and edit the comment to add the reference.
3. Rule of thumb: any comment that says "will do X" is a promise that might not be kept. Comments that say "did X: [ref]" are verifiable.

**Status:** Active

**Applies To:** All agents creating handoff comments in tickets.

---

## [Process] Same-Role Instance Duplication — No Claim Step Before Filing

**Pattern:** Two instances of the same role independently action the same shared tracker (parent ticket) within minutes, filing duplicate phase/child tickets. The second instance doesn't know the first already cut the ticket because there's no claim step on the tracker.

**Instances:**
- 2026-07-13 — Computational Linguist: CL Main and CL.Investigate1 filed duplicate Phase 2 tickets (t/1577 vs t/1579) for the same tracker within 2 minutes. Second same-day near-dup after parallel answers on t/1560. Cost: dup-close + an AC nearly lost in consolidation (p/40#9).

**Root Cause:** Multiple instances of a role share the same ticket board and context, but have no coordination protocol for claiming work from shared trackers. Classic check-then-act race.

**Prevention:**
1. **Announce intent on the tracker ticket BEFORE cutting child tickets** — add a comment "claiming Phase 2" and wait for the comment to land before filing.
2. **Search open tickets for the scope first** — `search_tickets` for the tracker key + phase label before creating.
3. When consolidating dups, **merge ACs from both** — don't just close the second; it may have unique criteria the first lacks.

**Status:** Active

**Applies To:** All roles with multiple active instances sharing a ticket board.

---

## [Process] Orca Feedback-Rule Tooling Lies About Liveness — Manifest-Lag + False Audit Counters

**Pattern:** Orca's feedback-rule tooling gives two false-negative signals about whether a rule is live and firing: (1) a rule created/updated **mid-session is inert until the next session** because the runner executes compiled `feedback-rules/manifests/*.json` snapshots, not the live DB — yet `get_feedback_rule.enabled` still reports `true`; (2) the **audit counters** (`has_run` / `fire_count_24h` / `last_fired_at` / `recent_executions`) read false/0/null **even for rules that demonstrably fire every prompt**. Diagnosing a rule as "dead" from either signal is wrong.

**Instances:**
- 2026-07-17 — Technical Lead (t/1625, validated live this session; p/8#71). **Gap 2 re-confirmed:** `agent-status-reminder`, `security-secrets-block`, `fetch-through-bridge`, `ps-strict-mode-count-guard`, `warn-ping-length`, `route-errors-to-sage` all fired this session yet report `has_run:false, fire_count_24h:0, last_fired_at:null`; only `doc-metadata` + `git-commit-pathspec-flag-order` show `has_run:true` (`fire_count`/`last_fired_at` universally 0/null). **Gap 1 accepted** on Diagnostics' decisive manifest-grep evidence (new rule in 0 snapshots; established rules in 55–68) and corroborated by t/1623's `lossy-error-boundary-guard` (created last session) now showing compiled/live in `list_feedback_rules` — consistent with the DB→manifest compile-on-sync model. Forward to Orca via `submit_feedback` blocked on an offline beta-license token; re-submit pending network.

**Root Cause:** The rule runner reads **compiled manifest snapshots** produced at session-sync time, so DB writes (create/update/enable) don't reach the runner until the next sync — the DB-visible `enabled:true` and the runner-visible manifest diverge in-session. Separately, the execution audit counters are not reliably incremented on fire, so they under-report actual firing. Both are **Orca-platform tooling gaps, not in-repo bugs**, and both produce the same failure mode: a working rule looks dead.

**Prevention:**
1. **Liveness = grep the manifests, not the DB flag.** Verify a rule is live by grepping `feedback-rules/manifests/*.json` for the rule name — presence across recent snapshots means the runner has it. `get_feedback_rule.enabled:true` only means the DB row exists.
2. **Never diagnose a "dead" rule from audit counters.** `has_run` / `fire_count_24h` / `last_fired_at` / `recent_executions` read false/0/null even for actively-firing rules — not evidence a rule never fires.
3. **A newly created/updated rule is inert until the next session** — don't expect it to fire in the session that created it; confirm live-fire only after a sync boundary.
4. Report platform gaps to Orca via `submit_feedback` (needs an active beta-license token / network); track in-repo as a low-priority item since it can't be fixed here.

**Status:** Active — Orca-platform tooling gap (cannot be fixed in-repo); forward to Orca pending network (beta-license token offline). **Directly informs the t/1623 `lossy-error-boundary-guard` live-fire watch:** its `has_run:false` must NOT be read as "hook never fired" — confirm liveness via manifest presence + a deliberate live-fire *after* the next sync boundary.

**Applies To:** All agents creating, auditing, or relying on Orca feedback rules / hooks — especially anyone verifying a hook went live (Diagnostics, Sage, TL).

---

## [Process] Post-Compaction Summary Framing Trusted Over Object State — Phantom Loose End

**Pattern:** After a context compaction, a stale post-compaction summary frames already-completed, already-committed work as an outstanding "uncommitted deliverable" or "loose end." Acting on the summary's framing instead of the object-level truth (git refs + ticket status) produces wasted redo, a duplicate ticket against work that's already Done, or an attempted re-commit of already-committed content.

**Instances:**
- 2026-07-17 — Computational Linguist (p/7#37): a post-compaction summary framed a redundant essay copy (`analyses/bronder-…`) as "the uncommitted deliverable," when the canonical review (`docs/instrument-effects-review.md`) was **already committed + CLOSED** with follow-up tickets t/1668–1673 filed. Acting on the framing, CL filed a **duplicate PM ticket (t/1684) against the already-Done t/1673**, then a `git mv` of the essay into `docs/` aborted "destination exists" — the git error was what finally surfaced the true state. Resolved: cancelled t/1684, reverted the essay to committed state, verified via same-commit blob provenance.

**Root Cause:** A compaction summary is a lossy narrative reconstruction, not a source of truth. It can misrepresent *committed* state (a file it calls "uncommitted" is already in a commit) and *ticket* state (work it calls "unrouted" already has a Done ticket). Trusting the framing over the object state is the same failure as citing the working tree as evidence of committed state (Git Forensics #44/#54/#55) — extended to a second object domain: **ticket status**. The compaction boundary is the trigger; the summary is confident but stale.

**Prevention:**
1. **After any compaction, treat "loose end" claims in the summary as unverified.** Before acting, confirm against object state: `git log/show <path>` and blob-SHA provenance for "uncommitted"; `list_tickets`/`get_ticket` for "unrouted"/"undone."
2. **Before filing a follow-up ticket, `search_tickets` for the scope** — a summary that doesn't mention an existing Done ticket is not evidence one doesn't exist (same dup-prevention step as #195).
3. **A destination-exists / already-committed error is a signal, not just an obstacle** — when git or the tracker contradicts the summary's framing, the object state wins; stop and re-derive from it (root AGENTS.md "Git forensics — object level, never inference").

**Status:** Active

**Applies To:** All agents resuming after a context compaction — especially before committing a "loose end," filing a follow-up ticket, or re-doing a deliverable a summary calls incomplete.

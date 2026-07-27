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
- 2026-07-17 — Diagnostics (during triage, p/9#28; **re-hit same day, p/9#34** — identical `(Get-Item $file).Length` idiom): ran `$var = ...; (Get-Item $var).Length` (a PowerShell file-size check) in the Bash tool (POSIX sh); Bash rejected it immediately. Fixed by switching to the PowerShell tool. Tell: `$var = ...` assignment with no `export`, a `;`-chained statement, and `.Length` property access on a cmdlet result are all PowerShell, not sh. File-size/`Get-Item`/`Get-ChildItem` checks belong in the PowerShell tool. **Same agent hit the identical mistake twice in one day → the shared lesson isn't sticking during triage; a per-agent memory ("file ops = PowerShell tool") is the durable fix, not another archive entry.**
- 2026-07-26 — PowerShell 2 (p/228#1): `node require('/c/Users/.../file.json')` (a **git-bash `/c/...` msys path**) threw MODULE_NOT_FOUND. `node` is a legitimate Bash-tool program, but its **win32 runtime doesn't resolve msys `/c/...` paths** — git-bash only rewrites them for some contexts, not inside a JS string passed to `require`. Fixed by reading the JSON via the PowerShell tool with a native `C:\...` path. Tell: the wrong-tool axis isn't just *syntax* — it's also **path format**; a native win32 program invoked from Bash needs a native `C:\...` (or repo-relative) path, not `/c/...`.

**Root Cause:** Agents have access to both Bash and PowerShell tools. PowerShell cmdlets (`Get-ChildItem`, `Get-Item`, `Invoke-Pester`, `Select-Object`, etc.), `$var = ...` assignment, `.Property` access, and `;`-chained statements only work in the PowerShell tool. Unix commands (`ls`, `grep`, `cat`, `stat -c%s`) only work in Bash (on Windows/Git Bash). **A second axis is path format:** git-bash presents `/c/Users/...` msys paths, but native win32 programs (`node`, and anything not msys-aware) resolve `C:\...` — an msys path handed to `node require`/`fs` fails as MODULE_NOT_FOUND / ENOENT.

**Prevention:**
1. Use PowerShell tool for: cmdlets (`Get-*`, `Set-*`, `Invoke-*`), `$env:` variables, `$var = ...` assignment, `.Property` access on results, pipeline operators with objects. File-size checks: `(Get-Item $p).Length`.
2. Use Bash tool for: Unix commands, `git`, `npm`, `node`, `python3`, shell scripts. File-size in Bash: `stat -c%s <file>` or `wc -c < <file>`.
3. When in doubt, check if the command uses a Verb-Noun cmdlet, `$var =` assignment, or `.Property` access — if yes, it's PowerShell.
4. **Path format:** when a native win32 program (`node`, etc.) needs a filesystem path, give it a native `C:\...` or repo-relative path — NOT a git-bash `/c/...` msys path (fails as MODULE_NOT_FOUND/ENOENT). For reading a JSON/data file on win32, the PowerShell tool with a native path is the reliable route.

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

**Pattern:** A verification gate fails to detect new genuine failures because it's compromised by tolerated noise. Two mechanisms: **(A) exit-code blend** — the gate already exits non-zero from tolerated warnings, so new errors don't change the exit code; **(B) skip-before-run** — an EARLIER step that hard-fails on tolerated noise (no `continue-on-error`) aborts the pipeline *before* the real gate runs, so the real gate is **skipped entirely** and its absence reads as pass. Either way, "gate green" claims pass with live failures undetected.

**Instances:**
- 2026-07-03 — verify's eslint step was already failing from old warnings. New `RelatedEdgesPanel` errors (t/1304) survived a "green verify" claim because the exit code was already non-zero (mechanism A). Root cause analysis in t/1304#5, fix in c2f79267, gate repair tracked in t/1323 (p/8#37).
- 2026-07-26 — Technical Lead (t/1800, DevOps; p/8#101): the CI `Audit dependencies` step (`npm audit high`, **no `continue-on-error`**) hard-fails on lockfile dependabot vulns and sits **BEFORE Test**, so vitest+Pester are **skipped repo-wide** (mechanism B). The Test gate was a **false-green for ~3 pushes** and **masked t/1788's Linux route-table check**. The audit red was tolerated noise (dependabot vulns), so its failure was dismissed while the real gate never ran. Fix per Gate Verification + Gate Co-Location (below).

**Root Cause:** When a gate is already failing (A) or an upstream step hard-fails (B) for tolerated/ignored reasons, agents learn to treat the red as normal ("it always fails / it's just the audit noise"). New genuine failures either blend into the existing non-zero exit (A) or never execute because the pipeline short-circuits first (B). Same family as [Build] Deploy Preflight False-Red (AlertsManagement) but **inverted** — false-green instead of false-red. Mechanism B is especially insidious: the real gate produces NO signal at all (skipped ≠ failed ≠ passed), and "skipped" is easily misread as "fine."

**Prevention:**
1. Gates must be kept at **zero tolerated noise** — fix or suppress existing warnings before relying on the gate to catch new ones.
2. If warnings/vulns are temporarily tolerated, use **explicit baselines co-located at the step** (eslint `--max-warnings N`; baseline the known dependabot advisory IDs in the `npm audit` step) so any *new* one changes the exit code — and set `continue-on-error` (or order the step AFTER the real gate) so a tolerated-noise step can NEVER short-circuit the real test gate.
3. **Ordering rule (mechanism B):** never place a step that hard-fails on tolerated noise *before* the real quality gate; the test gate must run regardless of audit/lint advisory state.
4. Periodically **assert a deliberate failure actually fails the gate** — inject a known error and confirm the gate catches it (Gate Verification). This catches BOTH mechanisms: a deliberately-broken test that still shows "green" reveals the gate is blind or skipped.
5. When claiming "gate green," check that the real gate **actually ran** (not skipped) and its exit code/output — not just "the job didn't surprise me."

**Status:** Resolved-genus, **recurred 2026-07-26 in a new (skip-before-run) mechanism** (t/1800). Root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589) apply directly to the fix: TL cited both — deliberately break a test to prove the restored gate fires (Verification), and baseline any tolerated vuln in `ci.yml` at the step (Co-Location). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64). Fix tracked t/1800 (DevOps).

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

## [Process] Overwrite/Clobber Claims & Config-Failure Triage Without Object-Level Verification

**Pattern:** A "commit X broke/overwrote F" claim is asserted from the **working tree** (grep, symptom counts, commit dates) instead of the committed object, then retracted when someone finally checks the object. Two shapes: (a) a clobber claim churned across diagnostic rounds; (b) a **config failure** (missing entry, BOM, wrong value in the working-tree config file) attributed to a commit — when the committed code was correct all along and the divergence lived only in the local working tree.

**Instances:**
- 2026-07-06 — Computational Linguist + 2nd agent (t/1351): a git-forensics clobber claim went through 3 diagnostic rounds across 2 agents. Ancestry got inverted twice. Resolved only when blob SHAs were compared: `git rev-parse X:path` vs `git rev-parse X~1:path` — identical blob = file untouched, debate over in one command (p/7#22).
- 2026-07-17 — Diagnostics (**2nd config-failure instance**, p/9#30): a flight recorder showed `zai-glm-5-2` missing from `ai-models.json` + a BOM. Diagnostics **grepped the working tree** and attributed both to a revert commit — never running `git show HEAD:ai-models.json`. The committed code was correct; the divergence was working-tree-only. Notably, the memory rule ("`git diff HEAD -- <configfile>` before blaming a commit for config") **existed but was not applied under triage pressure** — the 1st config instance was the t/1618 Z.AI triage.

**Root Cause:** Timeline/working-tree reasoning ("commit X came after Y, so X must have broken it" / "the file is wrong now, so a commit made it wrong") is unreliable — commits can touch many files, the accused commit may not have modified the file at all, and a working-tree config file can diverge from committed state via a local refresh/edit with no commit involved. Without content identity (blob SHA / `git show HEAD:<file>`), agents pattern-match symptoms to a plausible commit and waste rounds. The recurrence shows a second failure mode: **the object-level rule can exist (root AGENTS.md + memory) yet not fire during live triage** — knowing the rule ≠ invoking it when a plausible commit-blame narrative is in hand.

**Prevention:**
1. For any "a commit broke/overwrote F" claim, **object-level comparison is the FIRST check** — before timeline or working-tree reasoning:
   - `git rev-parse <commit>:<path>` vs `git rev-parse <commit>~1:<path>` — identical SHA = file untouched at that commit.
   - `git diff <commit>~1 <commit> -- <path>` — empty diff = no change.
2. If blob SHAs differ, THEN examine what changed: `git show <commit> -- <path>`.
3. **Config-failure triage specifically:** before asserting a commit broke config, run `git diff HEAD -- <configfile>` (or `git show HEAD:<configfile>`) — a non-empty diff means the problem is **working-tree-only** (local refresh/edit), NOT the committed code. A missing entry or BOM in the working tree is a working-tree symptom until the committed object proves otherwise.
4. Never conclude "X broke/overwrote F" from commit dates, grep of the working tree, or symptom counts alone.
5. **The rule must fire during triage, not just exist:** when you have a plausible commit to blame, that is exactly the moment to run the object-level check — treat "I suspect commit X" as the trigger phrase for `git show HEAD:<path>`. Same diagnostic-discipline family as #44 (one-directional ancestry → false divergence) and #54 (dirty tree as false witness).

**Status:** Resolved (root AGENTS.md "Git forensics" Common Traps rule, bf738f2, p/8#58) — but **recurred 2026-07-17 as a config-failure variant despite the rule** (application gap under triage pressure, prevention #5). If a 3rd config instance appears, consider a point-of-use trigger (a triage-checklist step or Diagnostics hook) rather than relying on recall.

**Applies To:** All agents performing git forensics and config-failure triage — overwrite/clobber claims, data-loss triage, and any "a commit broke this config" diagnosis.

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

## [Process] Feedback Hook Silently Dead on Windows — `{workspace_root}` Expands Empty → Wrong Path → crash → exit 1 Suppresses With No Guidance

**Pattern:** A feedback hook whose `run.args` reference `{workspace_root}` is **silently non-functional on Windows** because `{workspace_root}` expands to an **empty string**. Node then receives `/operations/diagnostics/<script>.cjs`, which on Windows resolves to `c:\operations\...` (a path that doesn't exist), so the script crashes. The crash exits 1, which the runner treats as "suppress" — the hook neither runs its check NOR surfaces any guidance. The result is the worst kind of gate: it **looks installed** (rule enabled, manifest present) but provides **zero coverage and zero signal** — a false-green far more dangerous than no hook, because everyone believes the guard is in place.

**Instances:**
- 2026-07-26 — Diagnostics (p/9#39, discovered while extending `check-git-commit-order.cjs`, commit 039f9501): the hook's `{workspace_root}` expanded empty on Windows → node got `/operations/diagnostics/check-git-commit-order.cjs` → resolved to `c:\operations\...` → script crashed → exit 1 → suppressed with no guidance. The regex fix (overlay-form coverage) is committed but **dead until the path expansion is resolved**. Almost certainly affects **every** hook whose args use `{workspace_root}` — including the `staged-files-after-commit` hook (#76's supposed mechanical defense).
- 2026-07-26 — **post-inlining regression: the residual is now LOUD noise, not silence** (Sage direct observation across the session + PowerShell 2 p/228#1): after the p/9#41 re-inline, the guard runs but logs **`Feedback rule 'node' exited with code 1` on ~every matching Bash/PowerShell call** — PowerShell 2 read it as "a broken feedback rule." This strongly implies the inlined `node -e` script **exits 1 unconditionally** (even when there's NO flag-order/staged violation), i.e. an exit-logic/parse bug in the inlined form, not a real flag. Net effect: the fix traded a *silent* dead hook for a *noisy* one — arguably worse for gate-signal-integrity, because constant `exited code 1` noise trains the whole fleet to ignore the guard, so a real flag won't be read either.

**Root Cause:** The hook-runner's `{workspace_root}` template variable does not expand on this Windows setup (empty string), so absolute-path construction in `run.args` silently produces a bogus root. This is the exact opposite failure mode of the standing Diagnostics rule "always use absolute paths via `{workspace_root}`" — the rule assumed `{workspace_root}` resolves; here it doesn't. Compounded by the runner's **exit-1 = suppress-silently** contract: a *crashing* hook is indistinguishable from a *passing* hook, so the failure is invisible. This is a gate-signal-integrity failure (root AGENTS.md #20/#46): a gate that can't run can't detect anything, and one that fails silently reports false-green. Sibling of #68 (feedback tooling lies about liveness) — there the lie was manifest-lag + false counters; here it's a crash masquerading as a pass.

**Prevention:**
1. **A hook is not "landed" until it's proven to FIRE on Windows** — enabled + manifest-present is not enough (see #68). Test with a deliberate trigger and confirm the guidance actually appears; a hook that never emits output may be crashing, not passing.
2. **Verify `{workspace_root}` actually expands** in this environment before relying on it for hook script paths; if it expands empty, use a path form that works on Windows (or resolve the script path inside the `.cjs` via `__dirname`/`process.cwd()` rather than a template arg).
3. **A crashing hook must not silently pass** — where possible, make hook failure visible (non-suppressing error surface) so a dead guard is detected, not assumed working. Exit-1-as-suppress hides exactly the failure you most need to see.
4. **Audit ALL `{workspace_root}` hooks for the same silent death** — this is not one hook's bug; every hook using that template on Windows is suspect. (Recommended a fleet-wide hook audit to Diagnostics.)
5. **A hook must exit 0 on the clean/no-violation path.** If the inlined script exits non-zero unconditionally (crash or exit-logic bug), it emits `node exited code 1` on EVERY matching call — pure noise that trains the fleet to ignore the guard (violates the zero-gate-noise rule, #20/#46). Test the clean path explicitly, not just the violation path.

**Status:** Active — three-part root cause. **Part 1 — `{workspace_root}` path crash: FIXED (Diagnostics audit, p/9#41):** the two hooks using `{workspace_root}` external scripts (`git-commit-pathspec-flag-order`, `staged-files-after-commit`) were **re-inlined via `node -e`**; no other `run.command` hooks exist, so the path-crash class is closed. **Part 2 — exit-1-suppresses-silently: OPEN, Orca Support's platform contract** (a hook exiting non-zero for any reason is suppressed with no signal — crash indistinguishable from pass). **Part 3 — NEW, post-inlining (p/228#1): the inlined guard now exits 1 on ~every matching call regardless of violation** → fleet-visible `node exited code 1` noise (2 observers: Sage + PowerShell 2). This is an in-repo bug in the inlined script's exit logic (prevention #5), separate from the Orca contract, and Diagnostics can fix it directly (exit 0 when clean). Until Parts 2+3 are fixed, the guard provides neither reliable signal (Part 2) nor low noise (Part 3) — the behavioral rule remains the real defense. Flagged both to Diagnostics (p/9 thread).

**Applies To:** All agents (esp. Diagnostics) authoring or relying on feedback hooks on Windows — and Sage/TL when recording a hook as a "mechanical defense," which must now carry a "proven-to-fire-on-Windows" caveat.

---

## [Process] Rule-Exists-But-Not-Applied — a Point-of-Use Failure Class (not a coverage gap)

**Pattern:** A recurrence whose root cause is NOT a missing rule — the rule is written, correct, and in the right place (AGENTS.md / a skill step / a memory) — but it **doesn't fire at the moment of action**. The agent doesn't recall/apply it mid-task. This is a distinct triage class from "no rule exists": adding more prose won't fix it, because the failure is point-of-use, not coverage. The lever is a **point-of-use gate (PreToolUse hook)** where the signal is clean — converting the rule from something-to-remember into something-enforced.

**Instances (running tally — tag every new one; track BOTH the class total AND the max-per-offender count, per TL p/8#95/#97). Current: CLASS TOTAL ≥ 12 / ~6 trigger → MET; MAX PER OFFENDER ≥ 5 / 4 trigger → MET. TWO offenders now trip the per-offender trigger (see #4 and #5).**
- 2026-07-17 — object-level git-forensics, **2nd config-failure instance** (Diagnostics, p/9#30): the "run `git diff HEAD -- <configfile>` before blaming a commit for config" rule existed in memory + root AGENTS.md but wasn't invoked mid-triage. [offender: config-forensics recall — count 1]
- 2026-07-26 — strict-mode unguarded property access (TL, t/1726, p/8#88): the `PSObject.Properties` guard rule existed (scripts/AGENTS.md) but wasn't applied at 4 `.factual_claims` sites; a blanket property-access hook was ruled too noisy to scope. [offender: strict-mode property guard — count 1]
- 2026-07-26 — `/land-from-worktree` #81 (ServerAPI, p/79#10 / p/8#93): step 7 mandates `git restore --worktree` and explicitly forbids `git checkout … -- <files>`; the agent used the forbidden form anyway. [offender: land-worktree step-7 form — count 1]
- 2026-07-26 — **direct-commit-to-shared-main instead of worktree-landing** (TL, p/8#99; PM p/21#49): agents keep committing docs straight to LOCAL shared `main` rather than worktree-landing. The worktree-landing rule exists (the `/land-from-worktree` skill + root AGENTS.md) but isn't applied at commit time. **Recurring since t/1714; PM flagged 5 more re-stranded TODAY** → this offender is at **≥5 instances on its own** (floor; recurrences pre-today not fully counted). [offender: worktree-landing-not-applied — count ≥5 → **trips both triggers**]
- 2026-07-26 — **data-shape type-check-not-applied** (Computational Linguist, p/7#36 + p/7#38; **REVERSES Sage's earlier not-in-#82 call**): the root "Data File Convention" rule (inspect a sample + `type()`/`isinstance()` before operating) exists but keeps not being applied — inline code assumes uniform JSON shape and crashes on the variant (p/7#38: `interpretations.{pov}` dict for 1,236 nodes / string for 23, same-session recurrence hours after the prior instance was logged). I originally excluded this as "trivial/self-correcting/not-hookable" (p/7#36); **CL's same-session-recurrence argument corrects that — severity is not the gating criterion, frequency + rule-not-applied is, and recording-isn't-preventing is precisely this class's signature.** Post-rule inline type-check misses: p/7#16, p/7#18, p/7#36, p/7#38 → [offender: data-shape type-check — count ≥4 → **trips per-offender trigger**]. Hookability caveat: a blanket `isinstance`-before-`.get/.items/len` check is likely too noisy (same tradeoff as strict-mode property access) — may need a scoped design (e.g. only inline Python touching known project JSON) or fall in the "rule is the only defense" bucket. TL to weigh vs offender #4 for the hook-spec.

**Root Cause:** Rules delivered as prose (AGENTS.md, skill steps, memory) depend on recall at the exact moment of action; under task focus/triage pressure the relevant rule often doesn't surface. Coverage (the rule exists) and application (it fires when needed) are different problems, and only the latter is failing here. The reliable fix is to move enforcement to the point of use — a gate that fires mechanically — but only where the trigger is cheaply and unambiguously detectable (the `ps-strict-mode-count-guard` `.Count` guard is the model; a blanket property-access hook was rejected as too noisy — that tradeoff still holds).

**Prevention:**
1. **Triage recurrences into two buckets:** "no rule exists" (→ write/escalate a rule) vs "rule exists but wasn't applied" (→ this class; more prose won't help). Record which bucket in the pattern's Status.
2. **For the point-of-use class, tag every instance and track TWO counters; TL acts on whichever trigger fires first (p/8#95/#97):**
   - **(a) per-offender:** any single offender hits its **4th** instance → TL specs a point-of-use hook *for that offender* (the `.Count` guard is the model).
   - **(b) class-total:** the class reaches **~6 total instances across offenders** → that's systemic (a long tail of distinct one/two-off offenders, not one bad actor), so the lever is a **broader point-of-use reinforcement** — a review-habit/checklist change or a meta-hook — NOT one rule.
   - Rationale for (b): a per-offender trigger alone never fires when the class grows via many distinct offenders each recurring once or twice — which is exactly the observed trend (3 instances / 3 offenders). Rank both counters in the tally header.
3. **A candidate becomes a hook only if the trigger is cleanly detectable** — greppable command shape, specific API call — else the noise defeats it (property-access lesson). Where it isn't hookable, the honest record is "rule is the only defense; recall is the residual risk."

**Status:** Active — **TRIGGER FIRED 2026-07-26.** Offender #4 (direct-commit-to-shared-main instead of worktree-landing) is the frequency leader at ≥5 instances, tripping **both** triggers at once: per-offender ≥5 ≥ 4 (a), and class-total ≥8 ≥ ~6 (b). Per the agreed rule (TL p/8#95/#97), this warrants **a point-of-use hook for that offender** — TL already proposed exactly this (p/8#99): a PreToolUse warning on a direct commit to shared-tree `main` (cleanly hookable — greppable command shape — leveraging the existing git-commit hook infra). Frame agreed p/8#94→#99. **Next:** TL specs/owns the hook; Sage keeps tagging + watching for the NEXT distinct offender toward a fresh class-total read. (Sibling context: the same direct-commit-to-main behavior drove the large-divergence push failure, p/9#36.)

**Applies To:** Sage (triage + tagging) and TL (hook-spec decision) — and anyone tempted to answer a recurrence with "add a rule" when the rule already exists.

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

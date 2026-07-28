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
- 2026-07-28 — Taxonomy Editor 2 (**`/tmp` mount variant**, p/195#5): `node -e "require('/tmp/x.json')"` failed MODULE_NOT_FOUND — Node's win32 runtime can't resolve **git-bash's `/tmp` mount** (it's a virtual msys mount, not a real Windows path), and `> /tmp/…` redirects write to a location Node can't then `require`. Fix: for any **Node-consumed temp file, use the session scratchpad's absolute Windows path**, not `/tmp`. Generalizes the p/228#1 lesson: `/tmp` and `/c/...` are both git-bash-only paths that native `node` can't see — the scratchpad Windows path is the temp-file route that works in both tools.

**Root Cause:** Agents have access to both Bash and PowerShell tools. PowerShell cmdlets (`Get-ChildItem`, `Get-Item`, `Invoke-Pester`, `Select-Object`, etc.), `$var = ...` assignment, `.Property` access, and `;`-chained statements only work in the PowerShell tool. Unix commands (`ls`, `grep`, `cat`, `stat -c%s`) only work in Bash (on Windows/Git Bash). **A second axis is path format:** git-bash presents `/c/Users/...` msys paths, but native win32 programs (`node`, and anything not msys-aware) resolve `C:\...` — an msys path handed to `node require`/`fs` fails as MODULE_NOT_FOUND / ENOENT.

**Prevention:**
1. Use PowerShell tool for: cmdlets (`Get-*`, `Set-*`, `Invoke-*`), `$env:` variables, `$var = ...` assignment, `.Property` access on results, pipeline operators with objects. File-size checks: `(Get-Item $p).Length`.
2. Use Bash tool for: Unix commands, `git`, `npm`, `node`, `python3`, shell scripts. File-size in Bash: `stat -c%s <file>` or `wc -c < <file>`.
3. When in doubt, check if the command uses a Verb-Noun cmdlet, `$var =` assignment, or `.Property` access — if yes, it's PowerShell.
4. **Path format:** when a native win32 program (`node`, etc.) needs a filesystem path, give it a native `C:\...` or repo-relative path — NOT a git-bash `/c/...` msys path OR a git-bash mount like **`/tmp`** (both fail as MODULE_NOT_FOUND/ENOENT — `/tmp` is a virtual msys mount Node can't resolve, and `> /tmp/…` redirects land where Node can't `require`). **For any Node-consumed temp file, write it to the session scratchpad's absolute Windows path, not `/tmp`.** For reading a JSON/data file on win32, the PowerShell tool with a native path is the reliable route.

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
- 2026-07-26 — Technical Lead (t/1800, DevOps; p/8#101): the CI `Audit dependencies` step (`npm audit high`, **no `continue-on-error`**) hard-fails on lockfile dependabot vulns and sits **BEFORE Test**, so vitest+Pester are **skipped repo-wide** (mechanism B). The Test gate was a **false-green for ~3 pushes** and **masked t/1788's Linux route-table check**. The audit red was tolerated noise (dependabot vulns), so its failure was dismissed while the real gate never ran. **FIXED (DevOps, 231e0f3e, p/26#17):** decoupled audit into **its own job** + `.github/scripts/ci-audit.mjs` with **co-located per-app baselines** — so audit can never precede/skip Test. Durable lesson: **two independent gates must be separate CI jobs — a security gate must never precede Test in the same job, or its failure masks Test.**

**Root Cause:** When a gate is already failing (A) or an upstream step hard-fails (B) for tolerated/ignored reasons, agents learn to treat the red as normal ("it always fails / it's just the audit noise"). New genuine failures either blend into the existing non-zero exit (A) or never execute because the pipeline short-circuits first (B). Same family as [Build] Deploy Preflight False-Red (AlertsManagement) but **inverted** — false-green instead of false-red. Mechanism B is especially insidious: the real gate produces NO signal at all (skipped ≠ failed ≠ passed), and "skipped" is easily misread as "fine."

**Prevention:**
1. Gates must be kept at **zero tolerated noise** — fix or suppress existing warnings before relying on the gate to catch new ones.
2. If warnings/vulns are temporarily tolerated, use **explicit baselines co-located at the step** (eslint `--max-warnings N`; baseline the known dependabot advisory IDs in the `npm audit` step) so any *new* one changes the exit code — and set `continue-on-error` (or order the step AFTER the real gate) so a tolerated-noise step can NEVER short-circuit the real test gate.
3. **Ordering rule (mechanism B):** never place a step that hard-fails on tolerated noise *before* the real quality gate; the test gate must run regardless of audit/lint advisory state.
4. Periodically **assert a deliberate failure actually fails the gate** — inject a known error and confirm the gate catches it (Gate Verification). This catches BOTH mechanisms: a deliberately-broken test that still shows "green" reveals the gate is blind or skipped.
5. When claiming "gate green," check that the real gate **actually ran** (not skipped) and its exit code/output — not just "the job didn't surprise me."
6. **Two independent gates must be separate CI jobs** (DevOps, 231e0f3e, p/26#17): a security/audit gate must never share a job with — and precede — Test, or its failure short-circuits Test. Decouple into its own job; the strongest form of the ordering rule (#3).

**Status:** Resolved-genus, recurred 2026-07-26 in a new (skip-before-run) mechanism (t/1800) — **now FIXED (DevOps, 231e0f3e, p/26#17):** audit decoupled into its own job + `.github/scripts/ci-audit.mjs` with co-located per-app baselines, so it can never precede/skip Test. Root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589) applied; new durable rule added to prevention (#6: two independent gates = separate jobs). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** All agents running verify gates, CI pipelines, or any pass/fail quality checks.

---

## [Process] Background-Task Gate Wrapper Swallows the Real Exit Code — False-Green from `&& echo PASS || echo FAIL`

**Pattern:** Wrapping a gate as `cmd >log 2>&1 && echo PASS || echo FAIL` (common for background tasks) makes the **task's exit code ALWAYS 0** — the trailing `echo` succeeds whether `cmd` passed or failed, so the `&&`/`||` swallows `cmd`'s real exit. The background-task-completion "exit 0" notification is therefore **meaningless for pass/fail**. Compounding: `>log 2>&1` captures only `cmd`'s output, so the `PASS`/`FAIL` marker (emitted by the `echo`, after the redirect) lands in the **task-output file, NOT the `log` you tail** — so tailing the log shows no verdict, and the exit code lies green.

**Instances:**
- 2026-07-26 — Taxonomy Editor 2 (t/1798, p/195#3): briefly misread a **failed `npm run verify` as green** — the `... && echo PASS || echo FAIL` wrapper exited 0, and the FAIL marker was in the task-output file (not the tailed log). Resolution: read the **marker text** (or the inner command's real exit code), never the wrapper's exit code.

**Root Cause:** `A && echo PASS || echo FAIL` is a shell idiom whose *own* exit status is that of the last `echo`, which always succeeds — it converts `cmd`'s pass/fail into stdout TEXT and discards it from the exit code. For a background task the harness reports the wrapper's exit (0), not `cmd`'s. Separately, `cmd >log 2>&1` redirects only `cmd`; the post-`&&` echo writes to the task's default stdout, so the verdict and the log are in different files. Same false-green genus as gate-blindness (#20/#46) but the mechanism is **exit-code laundering by the wrapper**, not tolerated noise.

**Prevention:**
1. **Never trust a background task's exit code when the command is `... && echo PASS || echo FAIL`** — that exit is the echo's (always 0). Trust the marker TEXT or the inner command's real exit.
2. **Preserve the real exit code:** run the gate without the echo wrapper (let `cmd`'s exit be the task's exit), or capture it explicitly: `cmd >log 2>&1; ec=$?; echo "EXIT=$ec"` — then read `EXIT=`.
3. **Put the verdict where you'll look:** if you emit a PASS/FAIL marker, write it into the same `log` you tail (`... ; echo "RESULT=..." >>log`), not the task's separate stdout — or just `grep` the task-output file for the marker, don't tail the redirected log expecting it.
4. **When claiming "verify green" from a background task, confirm the marker/exit, not the completion notification.** (Pairs with the gate-blindness rule: "the job didn't surprise me" is not "the gate passed.")

**Status:** Active — false-green (exit-code-laundering) variant of the gate-signal-integrity genus (#20/#46/#48/#61/#64). Distinct mechanism from gate-blindness (tolerated noise) and skip-before-run.

**Applies To:** All agents running gates as background Bash tasks, especially with a `&& echo PASS || echo FAIL` wrapper and a tailed redirect log.

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

**Status:** Active — three-part root cause. **Part 1 — `{workspace_root}` path crash: FIXED (Diagnostics audit, p/9#41):** the two hooks using `{workspace_root}` external scripts (`git-commit-pathspec-flag-order`, `staged-files-after-commit`) were **re-inlined via `node -e`**; no other `run.command` hooks exist, so the path-crash class is closed. **Part 2 — exit-1-suppresses-silently: OPEN, Orca Support's platform contract** (a hook exiting non-zero for any reason is suppressed with no signal — crash indistinguishable from pass). **Part 3 — NEW, post-inlining (p/228#1): the inlined guard now exits 1 on ~every matching call regardless of violation** → fleet-visible `node exited code 1` noise (2 observers: Sage + PowerShell 2). This is an in-repo bug in the inlined script's exit logic (prevention #5), separate from the Orca contract, and Diagnostics can fix it directly (exit 0 when clean). Until Parts 2+3 are fixed, the guard provides neither reliable signal (Part 2) nor low noise (Part 3) — the behavioral rule remains the real defense. Flagged both to Diagnostics (p/9 thread). **Scope add (p/9#47):** when Part-3 is fixed (exit 0 on clean), Diagnostics will also have the guard emit corrective guidance on a real flag-order violation — "flags before --: git commit -m 'msg' -- <paths>" — turning the 7×-recurring cryptic git pathspec error into a one-line fix (see the git `--` flag-order pattern in build.md).

**Applies To:** All agents (esp. Diagnostics) authoring or relying on feedback hooks on Windows — and Sage/TL when recording a hook as a "mechanical defense," which must now carry a "proven-to-fire-on-Windows" caveat.

---

## [Process] Rule-Exists-But-Not-Applied — a Point-of-Use Failure Class (not a coverage gap)

**Pattern:** A recurrence whose root cause is NOT a missing rule — the rule is written, correct, and in the right place (AGENTS.md / a skill step / a memory) — but it **doesn't fire at the moment of action**. The agent doesn't recall/apply it mid-task. This is a distinct triage class from "no rule exists": adding more prose won't fix it, because the failure is point-of-use, not coverage. The lever is a **point-of-use gate (PreToolUse hook)** where the signal is clean — converting the rule from something-to-remember into something-enforced.

**Instances (running tally — tag every new one; track BOTH the class total AND the max-per-offender count, per TL p/8#95/#97). Current: CLASS TOTAL ≥ 12 / ~6 trigger → MET; MAX PER OFFENDER ≥ 5 / 4 trigger → MET. TWO offenders now trip the per-offender trigger (see #4 and #5).**
- 2026-07-17 — object-level git-forensics, **2nd config-failure instance** (Diagnostics, p/9#30): the "run `git diff HEAD -- <configfile>` before blaming a commit for config" rule existed in memory + root AGENTS.md but wasn't invoked mid-triage. [offender: config-forensics recall — count 1]
- 2026-07-26 — strict-mode unguarded property access (TL, t/1726, p/8#88): the `PSObject.Properties` guard rule existed (scripts/AGENTS.md) but wasn't applied at 4 `.factual_claims` sites; a blanket property-access hook was ruled too noisy to scope. [offender: strict-mode property guard — count 1]
- 2026-07-26 — `/land-from-worktree` #81 (ServerAPI, p/79#10 / p/8#93): step 7 mandates `git restore --worktree` and explicitly forbids `git checkout … -- <files>`; the agent used the forbidden form anyway. [offender: land-worktree step-7 form — count 1]
- 2026-07-26 — **direct-commit-to-shared-main instead of worktree-landing** (TL, p/8#99; PM p/21#49): agents keep committing docs straight to LOCAL shared `main` rather than worktree-landing. The worktree-landing rule exists (the `/land-from-worktree` skill + root AGENTS.md) but isn't applied at commit time. **Recurring since t/1714; PM flagged 5 more re-stranded TODAY** → this offender is at **≥5 instances on its own** (floor; recurrences pre-today not fully counted). [offender: worktree-landing-not-applied — count ≥5 → **trips both triggers**]
- 2026-07-26 — **data-shape type-check-not-applied** (Computational Linguist, p/7#36 + p/7#38; **REVERSES Sage's earlier not-in-#82 call**): the root "Data File Convention" rule (inspect a sample + `type()`/`isinstance()` before operating) exists but keeps not being applied — inline code assumes uniform JSON shape and crashes on the variant (p/7#38: `interpretations.{pov}` dict for 1,236 nodes / string for 23, same-session recurrence hours after the prior instance was logged). I originally excluded this as "trivial/self-correcting/not-hookable" (p/7#36); **CL's same-session-recurrence argument corrects that — severity is not the gating criterion, frequency + rule-not-applied is, and recording-isn't-preventing is precisely this class's signature.** Post-rule inline type-check misses: p/7#16, p/7#18, p/7#36, p/7#38 → [offender: data-shape type-check — count ≥4 → tripped the per-offender trigger]. **DISPOSITION: RULE-ONLY, no hook (t/1810 spike, TL p/8#109).** Empirical false-red surface is decisive: `graph_attributes` = 514 reads / 132 files, `interpretations` = 213 / 76 — and the *correct* pattern (normalize-at-fetch) leaves **most reads legitimately guard-free**, so a "read-without-coercion" detector would false-red on correct code = dead gate (#20/#46). Strengthened instead by **TS union-types (tsc = the real gate) + naming the variadic fields in the rule** (detail t/1810#1). **Recurrence continues (+3 probe, p/7#47 → ≥7) — confirming rule-only means recall is the residual risk** — and the class shipped to PRODUCTION (extraction cmdlet char-explodes bare-string `aliases`, 13/37 records, t/1830). **Correction (CL p/7#49): that bug is in POWERSHELL (`Invoke-EntityExtraction`), so the TS-union-types strengthening does NOT cover it — no `tsc` runs on that surface.** The PS-side prevention is coerce-at-read (`if ($x -is [string]) { @($x) }`) at each AI-JSON boundary as ONE shared helper (Shared Utility Rule) + a bare-string Pester fixture. So the offender's real defense splits by surface: **TS surfaces → union types (tsc catches it); PS surfaces → shared coerce-at-read helper + Pester fixture** — the rule-only disposition holds, but "strengthen with the real gate" means a *different* gate per language.

**Root Cause:** Rules delivered as prose (AGENTS.md, skill steps, memory) depend on recall at the exact moment of action; under task focus/triage pressure the relevant rule often doesn't surface. Coverage (the rule exists) and application (it fires when needed) are different problems, and only the latter is failing here. The reliable fix is to move enforcement to the point of use — a gate that fires mechanically — but only where the trigger is cheaply and unambiguously detectable (the `ps-strict-mode-count-guard` `.Count` guard is the model; a blanket property-access hook was rejected as too noisy — that tradeoff still holds).

**Prevention:**
1. **Triage recurrences into two buckets:** "no rule exists" (→ write/escalate a rule) vs "rule exists but wasn't applied" (→ this class; more prose won't help). Record which bucket in the pattern's Status.
2. **For the point-of-use class, tag every instance and track TWO counters; TL acts on whichever trigger fires first (p/8#95/#97):**
   - **(a) per-offender:** any single offender hits its **4th** instance → TL specs a point-of-use hook *for that offender* (the `.Count` guard is the model).
   - **(b) class-total:** the class reaches **~6 total instances across offenders** → that's systemic (a long tail of distinct one/two-off offenders, not one bad actor), so the lever is a **broader point-of-use reinforcement** — a review-habit/checklist change or a meta-hook — NOT one rule.
   - Rationale for (b): a per-offender trigger alone never fires when the class grows via many distinct offenders each recurring once or twice — which is exactly the observed trend (3 instances / 3 offenders). Rank both counters in the tally header.
3. **The hook lever converts an offender ONLY when its violation is a crisp, unambiguous SYNTACTIC signal** (TL, general #82 criterion, p/8#109). If the offender's *correct* pattern is **syntactically identical** to the violation, a detector false-reds on correct code = dead gate (#20/#46) → it stays **rule-only**. Worked examples: **#4** direct-commit (`branch == main` = crisp, distinct signal → HOOK, t/1780); **#5** data-shape read-without-coercion (correct normalize-at-fetch leaves most reads legitimately guard-free — 514/213 reads across 132/76 files — so violation ≈ correct → RULE-ONLY, t/1810). This is the sharpened form of "cleanly detectable": *detectable* means *distinguishable-from-correct*, not just *greppable*.
4. **When rule-only, strengthen the rule's reach by other real gates, not a noisy hook** — e.g. TS union-types so `tsc` (the real gate) catches the shape mismatch, and name the specific variadic fields in the rule (t/1810#1). Where it stays rule-only, the honest record is "rule is the only defense; recall is the residual risk."

**Status:** Active — **BOTH triggers fired 2026-07-26; both offenders now have concrete dispositions (TL, p/8#104):**
- **Offender #4** (direct-commit-to-shared-main, ≥5) → hook **already spec'd as t/1780** (In Review with Diagnostics; Gate-Verification + owner-go gated). No new spec needed; the #5 data point reinforced its priority. Cleanly hookable (greppable). Sibling context: same behavior drove the large-divergence push failure (p/9#36).
- **Offender #5** (data-shape type-check, ≥4) → **RULE-ONLY, no hook (t/1810 decided, TL p/8#109).** The spike measured the false-red surface — `graph_attributes` 514 reads/132 files, `interpretations` 213/76 — and found the correct normalize-at-fetch pattern leaves most reads legitimately guard-free, so a read-without-coercion detector false-reds on correct code (dead gate, #20/#46). Strengthened by TS union-types (tsc = the real gate) + naming the variadic fields in the rule. This validated the general criterion now in prevention #3 (hook only when violation ≠ correct syntactically).
- Class-total ≥12; **both offenders dispositioned.** Net outcome: of the two per-offender-trigger offenders, one earned a hook (#4, crisp signal) and one stayed rule-only (#5, violation≈correct) — exactly the discrimination the crisp-syntactic-signal criterion predicts. **Sage standing action:** keep tagging new distinct offenders + both counters; watch t/1780 (In Review).

**Applies To:** Sage (triage + tagging) and TL (hook-spec decision) — and anyone tempted to answer a recurrence with "add a rule" when the rule already exists.

---

## [Process] Post-Compaction Summary Framing Trusted Over Object State — Phantom Loose End

**Pattern:** After a **session boundary** (context compaction OR a session interruption), the resumed state is stale: a summary frames already-committed work as an outstanding "loose end," OR a **peer instance has landed the work while you were paused**. Acting on the stale framing instead of the object-level truth (git refs + ticket status) produces wasted redo, a duplicate ticket against work that's already Done, or an attempted re-commit of content already in HEAD.

**Instances:**
- 2026-07-17 — Computational Linguist (p/7#37): a post-compaction summary framed a redundant essay copy (`analyses/bronder-…`) as "the uncommitted deliverable," when the canonical review (`docs/instrument-effects-review.md`) was **already committed + CLOSED** with follow-up tickets t/1668–1673 filed. Acting on the framing, CL filed a **duplicate PM ticket (t/1684) against the already-Done t/1673**, then a `git mv` of the essay into `docs/` aborted "destination exists" — the git error was what finally surfaced the true state. Resolved: cancelled t/1684, reverted the essay to committed state, verified via same-commit blob provenance.
- 2026-07-26 — Computational Linguist (**peer-already-landed variant**, p/7#42): after a **session interruption**, CL re-drove a pending register-staging commit for the t/1676 provenance entries; the script exited 1 ("nothing to stage") because sibling **CL.Investigate1 had already committed the identical hunks (7f9b4c36)** during the pause, so the diff was empty. **Benign — the "nothing to stage → abort" was correctly-designed fail-safe behavior** (a good gate: it refused to act on an empty diff), and an object-level check confirmed all entries were in HEAD; no data loss. Cousin of #83 (concurrent writers). Lesson: after any interruption, `git log -- <file>` before re-driving a pending commit — a peer may have landed it.

**Root Cause:** A resumed session's picture of "what's still to do" is a lossy reconstruction, not a source of truth — whether it's a **compaction summary** (stale narrative) or a **post-interruption assumption** that your pending work is still pending. It can misrepresent *committed* state (a file it calls "uncommitted" is already in a commit — possibly landed by a **peer instance** sharing the branch), and *ticket* state (work it calls "unrouted" already has a Done ticket). Trusting the framing over the object state is the same failure as citing the working tree as evidence of committed state (Git Forensics #44/#54/#55) — extended to **ticket status** and to **peer-landed commits**. The session boundary (compaction or interruption) is the trigger; the resumed assumption is confident but stale.

**Prevention:**
1. **After any compaction, treat "loose end" claims in the summary as unverified.** Before acting, confirm against object state: `git log/show <path>` and blob-SHA provenance for "uncommitted"; `list_tickets`/`get_ticket` for "unrouted"/"undone."
2. **Before filing a follow-up ticket, `search_tickets` for the scope** — a summary that doesn't mention an existing Done ticket is not evidence one doesn't exist (same dup-prevention step as #195).
3. **A destination-exists / already-committed / nothing-to-stage error is a signal, not just an obstacle** — when git or the tracker contradicts the resumed framing, the object state wins; stop and re-derive from it (root AGENTS.md "Git forensics — object level, never inference"). A script that **aborts on an empty diff is a correctly-designed fail-safe** — treat its refusal as "already landed," not as a failure to work around.
4. **After a session interruption, `git log -- <file>` (and check for peer commits) before re-driving a pending commit** — on a shared branch a peer instance may have landed your work while you were paused; re-driving it finds an empty diff (best case) or duplicates (worst case). Same discipline as compaction: verify object state before acting.

**Status:** Active — genus broadened 2026-07-26 (p/7#42) from *compaction* to *any session boundary* (compaction OR interruption), and to the **peer-already-landed** variant on shared branches.

**Applies To:** All agents resuming after a context compaction OR a session interruption — especially before committing a "loose end," filing a follow-up ticket, or re-driving a pending commit a peer may have already landed.

---

## [Process] Stale Barrel-Path Citations After ADR-007 Splits Fail SILENTLY (grep-empty, never a broken build)

**Pattern:** The ADR-007 splits turned single files into **barrel DIRECTORIES** — `calibrationLogger.ts` → `calibrationLogger/`, plus `prompts/`, `types/`, `claimExtractionPipeline/`, `gapAndDrift/`, etc. The import surface still works (the barrel re-exports), so **builds/verify stay green** — but every prose reference to the old `<name>.ts` path (docs, register, tickets, emails) now points at a file that no longer exists. The rot is **silent**: it never breaks a build, so it's only ever caught by a **grep returning empty** or a human following a dead citation.

**Instances:**
- 2026-07-26 — Technical Lead / Computational Linguist (p/8#106/#107): **4 stale citations across 3 tickets, 1 offender class** (post-ADR-007 barrel splits) — `prompts.ts` + `types.ts` (t/1701), `gapAndDrift.ts` (t/1782), `calibrationLogger.ts` (e/43). All 4 surfaced via **grep-returning-empty**, none via a broken build.

**Root Cause:** Splitting `<name>.ts` → a `<name>/` barrel preserves the *import* surface (`import { x } from '.../<name>'` still resolves via the barrel index), so `tsc`/verify never complain. But a **prose citation** of the concrete file path (`<name>.ts`) is not an import — nothing validates it — so it silently rots to a nonexistent path. No build gate can catch it because the build was never wrong; the wrongness is only in the human-facing reference.

**Prevention:**
1. **Verify the cited path RESOLVES at citation time** — post-t/1686, a cited `<name>.ts` may now be a `<name>/` barrel directory; check for the `<name>/` dir + the specific sub-module before writing the citation. Do NOT rely on fix-on-break — it never breaks.
2. **When splitting a file into a barrel, grep docs/register/tickets/emails for the old `<name>.ts` path** and update them (or leave a redirect note) as part of the split.
3. **Treat silent-failure classes as verify-at-write-time, not fix-on-break** — anything caught only by grep-empty (never a red build) has no gate, so the discipline must be at the moment of citation.

**Status:** Active — NOT a #82 rule-not-applied case (this is a *new hazard* introduced by ADR-007, not a pre-existing rule left unapplied). **Unit note (TL p/8#107):** report the units separately — 4 citations / 3 tickets / 1 offender class / 2 reporters (TL owns the single report; DebateTool 2 is not a duplicate — don't double-count). Sage tallies (esp. #82 triggers) are unit-sensitive: citations ≠ tickets ≠ offenders ≠ agents.

**Applies To:** All agents citing `lib/debate` file paths post-ADR-007 splits (docs, register, tickets, emails), and anyone splitting a file into a barrel directory.

---

## [Process] win32 "Task Stopped" Kills the Wrapper, Not Detached Child Trees — Relaunch Races a Surviving Writer

**Pattern:** A background batch is launched as a shell wrapper that spawns a **detached child tree** (e.g. python that spawns node). When the session restarts (or `TaskStop` fires), the task is marked **"stopped"** and the **wrapper shell is killed — but the detached child tree keeps running** on win32. Trusting the "stopped" bookkeeping and **relaunching** then puts **two live writers racing on the same output slugs**. The **inverse of the peer-already-landed variant of #69**: there a peer *finished* your work so your relaunch found nothing; here a supposedly-killed process *survived*, so your relaunch duplicates a live writer.

**Instances:**
- 2026-07-26 — Computational Linguist (p/7#44/#45, CLI-hang filed t/1824): after a session restart marked a debate-batch task "stopped," CL relaunched a filler — but the original runner's **python + node tree had survived** the restart (a later `TaskStop` killed only the shell wrapper), so **two writers raced the same output slugs for ~40 min**. Found both trees via **CIM command-line match**, `taskkill /F /T` on all roots, then object-audited every artifact set (**id-match + mtime spread + single-run flight recorder**) — no tears. **Benign only because both writers ran identical configs**; with differing configs it would have torn artifacts.

**Root Cause:** On win32, killing a process (task-stop, session restart, `Stop-Process` on the wrapper) does **not** cascade to detached child processes — a shell wrapper's `python`/`node` children, once spawned detached, outlive the wrapper. The task-runner's "stopped" status reflects the **wrapper's** state, not the child tree's; "stopped" is **bookkeeping, not a kill**. So a relaunch guarded only by the task status can spawn a second writer alongside a surviving first — a concurrent-writer race (same family as #83 / the serialize-data-repo-batches convention), masked because the runner reports the batch as not running.

**Prevention:**
1. **Before relaunching ANY batch, verify at the PROCESS level that zero prior writers are alive** — don't trust "task stopped." On win32: `Get-CimInstance Win32_Process | Where CommandLine -match '<runner/slug>'` (CIM command-line grep) to find surviving trees.
2. **Kill the whole tree, not the wrapper:** `taskkill /F /T /PID <root>` (or `Stop-Process` walking children) on every matching root — a bare wrapper kill leaves the children running.
3. **If a race may have occurred, object-audit the artifacts** — id-match, mtime-spread, and single-run flight-recorder checks per output set — to confirm no torn/interleaved writes before trusting the results.
4. **Serialize batch writers** (pairs with #83 prevention #5): a surviving writer + a relaunch is exactly the concurrent-writer collision the serialize-and-announce convention prevents.

**Status:** Active — win32 process-tree semantics; inverse of #69's peer-already-landed variant. Underlying CLI-hang tracked t/1824 (CL).

**Applies To:** All agents launching detached background batches on win32 (debate runners, enrichment pipelines) — especially before relaunching after a restart/TaskStop.

---

## [Process] Subagent "Completed" Is Process-Bookkeeping, Not Deliverable-Existence — Verify Artifacts Independently

**Pattern:** A background subagent's task-completion notification ("completed") fires whenever the agent **stops with no live children** — NOT when its **deliverables exist**. A subagent can report "completed" (even repeatedly) while it's still mid-research with **zero files written and no commit**. Trusting the notification and "landing" on it lands **nothing** — the status describes the agent's process state, not the artifacts.

**Instances:**
- 2026-07-26 — PowerShell (t/1806, delegated a large PS build to a background subagent, p/20#27): the subagent's task-notification reported **"completed" TWICE while still mid-research — zero files written, no commit**. Caught by grounding-truth (filesystem/git check); nothing lost. Had the "completed" been trusted, the land would have shipped nothing.

**Root Cause:** The "completed" signal is **bookkeeping about the process** (the agent stopped; no live child processes), not **evidence about the outcome** (files written, commit landed, tests pass). Same genus as #86 ("task stopped" ≠ process killed) and #69 (task status ≠ committed state): a status/lifecycle signal is not proof of the deliverable. Delegating does NOT delegate the Definition of Done — the caller still owns verifying committed artifacts (ADR-005 / SHA-in-completion-comment discipline), and must not inherit the subagent's word for it.

**Prevention:**
1. **Never treat a subagent "completed" as done — verify every deliverable independently** at the filesystem/git level: `Test-Path` each expected file, `git log`/`git show` the expected commit (SHA), and **re-run the tests yourself** before landing.
2. **Give the subagent a HARD completion gate that requires pasted EVIDENCE** — Test-Path output, Pester/vitest results, and the commit SHA — self-certification with proof, not a bare "done."
3. **Apply your own Definition of Done to delegated work** — committed by pathspec, verify green on committed state, SHA cited. Delegation moves the *doing*, not the *verifying*.
4. **Part of the bookkeeping-≠-artifact genus** (with #69/#80/#84/#86): whenever a status/lifecycle/exit signal stands in for an outcome, verify the artifact at the object level instead of trusting the signal.

**Status:** Active — bookkeeping-vs-artifact genus (see the consolidated Quick-Reference entry in INDEX.md). Caught by grounding-truth on t/1806; no loss.

**Applies To:** All agents delegating work to background subagents/consultants — especially before landing a delegated deliverable.

---

## [Process] `verify | tail` (Any Pipe) Masks the Real Exit Code — Silent False-Green at the Primary Gate

**Pattern:** Piping a gate's output through `tail`/`head`/`grep`/`less` — `npm run verify 2>&1 | tail -N` — makes the pipeline's exit code the **LAST command's** (`tail` = 0), NOT verify's. Gating a push/land on that exit (or eyeballing the tail) reads a **FAILING verify as green** — a silent false-green at the fleet's primary gate. Bash pipelines return the rightmost command's status by default.

**Instances:**
- 2026-07-28 — ServerAPI (t/1829, p/79#15) + Technical Lead (t/1829#2, p/8#111): `npm run verify 2>&1 | tail -N` returned `tail`'s exit 0, masking verify's real result; a push gated on that eyeballed tail can push a RED verify. ServerAPI's t/1829 outcome was sound only because the failures were unrelated flake — the masked exit was the real footgun.

**Root Cause:** A bash pipeline's exit status is the **last command's** exit (unless `set -o pipefail`). `verify | tail` → `tail` exits 0 → `$?` = 0 regardless of whether verify passed. Same **exit-code-laundering** family as #84 (the `&& echo PASS || echo FAIL` wrapper) and part of the **bookkeeping-≠-artifact genus** (see the consolidated Quick-Ref): the exit code you read is the pipe's/wrapper's, not the command's — verify the real result, not the laundered signal.

**Prevention:**
1. **Capture the real exit BEFORE piping and gate on it:** `npm run verify > out.log 2>&1; rc=$?; tail -N out.log; [ $rc -eq 0 ] || exit 1` — decide on `$rc`, view the tail separately.
2. **Or `set -o pipefail`** so the pipeline returns the first non-zero exit; in bash, `${PIPESTATUS[0]}` reads the first command's exit after a pipe.
3. **Never gate a push/land on an eyeballed tail** — the tail shows output, not verdict; check the actual exit code.
4. Same family as #84 — whenever a wrapper/pipe sits between you and a command's exit, the exit you see is the wrapper's; go to the source.

**Status:** Active — exit-code-laundering (pipe) variant of the false-green genus (#20/#46) and the bookkeeping-≠-artifact family (#84 sibling). Surfaced t/1829 (detail t/1829#2).

**Applies To:** All agents gating a push/land on `verify`/test output that is piped (`| tail`/`| grep`/`| head`).

---

## [Process] Flaky Shared Gate (lib/debate Suite) Generates False-Reds — Triage WHICH Files Before Assuming a Regression

**Pattern:** The `lib/debate` full test suite has **known-flaky tests** — `aiAdapter` withRetry (429/503), `persistenceFaults` (ENOSPC/EACCES), `cliPipeExit` — that fail **non-deterministically** (e.g. 8 failures one run, 5 the next). So a red `npm run verify` is **often NOT your change**. Worse, a flaky *shared* gate is a **false-red generator** that trains agents to dismiss ALL reds as "just flake" — the inverse of gate-blindness: when a gate cries wolf, a real regression blends into the tolerated noise (#20/#46).

**Instances:**
- 2026-07-28 — ServerAPI (t/1829, p/79#15) + Technical Lead (p/8#111): `npm run verify` failed non-deterministically (8→5 fails across runs) in the `aiAdapter`/`persistenceFaults`/`cliPipeExit` suites — unrelated to the agent's change. TL routed a **HIGH triage to DebateTool** to stabilize the flaky suites.

**Root Cause:** Fault-injection / retry / pipe-exit tests are timing- and environment-sensitive, so they fail non-deterministically. A flaky gate destroys the gate's signal two ways: (1) a red is ambiguous (your change, or flake?), and (2) habituation — agents learn "verify is always a bit red" and dismiss a genuine regression as flake. Same gate-signal-integrity genus as the false-green gate-blindness pattern, on the false-RED side.

**Prevention:**
1. **When verify is red, triage WHICH files failed before assuming a regression** — the known-flaky set (`aiAdapter` withRetry, `persistenceFaults`, `cliPipeExit`) is very likely not your change. Read the failing test names, not just "verify red."
2. **Re-run to check determinism** — a failure that changes across runs (8→5) is flake; a stable failure on the same test is real. (But re-running is a workaround, not a fix.)
3. **The real fix is to stabilize or quarantine the flaky tests** — a flaky shared gate must be repaired, not tolerated (routed HIGH to DebateTool, t/1829); Gate Verification/Co-Location apply. Tolerating flake is how a gate goes false-red-blind.
4. **Don't push on a red verify assuming flake without checking the failing files** — pairs with the "read which step, not the rollup" discipline from the gate-blindness pattern.

**Status:** Active — gate-signal-integrity (flaky-gate false-red, #20/#46); flaky-suite stabilization routed HIGH to DebateTool (t/1829). A flaky primary gate is high-severity because it degrades every agent's ability to trust verify.

**Applies To:** All agents running `npm run verify` / the `lib/debate` suite — read the failing test names before attributing a red to your change.

---

## [Process] Shared Local-Main Reconcile (Hard-Reset to origin) Wipes ALL Agents' Local-Only Commits — Recover From reflog, Don't Trust the Reverted Tree

**Pattern:** The shared local `main` accumulates local-only commits from many agents (Sage/most roles commit but don't push; TL/DevOps sync to origin). When the owner-gated **diverged-main reconcile** runs — `git reset` local `main` to `origin/main` — **every un-synced local commit is wiped off the branch at once, across all agents simultaneously.** An agent's working tree abruptly shows an EARLIER state and their session's work looks "gone." It is **not lost** — every commit survives in the reflog — but HEAD/branch/working-tree no longer contain it, which looks exactly like a revert.

**Instances:**
- 2026-07-28 — Sage (this session): shared local `main` (at Sage's last commit `20c32334`) was hard-reset to `origin/main` (reflog `HEAD@{0}: reset: moving to origin/main`), wiping ~30 local-only Sage doc commits (`e6daccc7`..`20c32334`: #82 dispositions + the PS-not-TS correction, #87–#92, #78 timeout, flag-order 6th/7th, /tmp, bc/awk) **plus other agents' local-only commits** interleaved in the reflog (te `t/1849` refactors, debate fixes, CL `t/1826`). **Caught by object-level verification** — the injected "your docs reverted" reminders showed a Total-83 working tree, but `git log`/`git status -sb`/`git reflog`/`git cat-file` proved HEAD had been reset and the commits were dangling-but-intact. **Recovered** with `git checkout 20c32334 -- operations/sage/docs/ operations/sage/LAST_SESSION.md` (restore my exclusive scope's final state) → one recommit (`e8ddad72`, Total-83→93). No loss.

**Root Cause:** The shared local `main` is a shared, un-pushed staging area; local-only commits live *only* there until TL/DevOps sync them to origin. Hard-resetting it to origin (the correct owner-gated fix for a large divergence) atomically discards every un-synced commit. Git doesn't delete objects, so they persist in the reflog — but the working tree/HEAD stop showing them, which reads as "my work was reverted/lost." Same object-level-vs-inference discipline as #69 and Git Forensics (#44/#54/#55): a changed working tree is not evidence of what's committed or recoverable.

**Prevention / Recovery:**
1. **After any "my working tree changed / my work is gone" event, VERIFY at the object level before reacting** — `git log --oneline`, `git status -sb`, `git reflog`. Never re-apply edits onto the reverted tree until you know whether HEAD moved (reset) or the tree is merely dirty. (This is the whole session's bookkeeping-≠-artifact / object-level rule, applied to your own repo state.)
2. **Recover local-only work from the reflog, then WORKTREE-LAND it to ORIGIN — do NOT just recommit to local main** (DevOps, p/26#22). Find your last commit in `git reflog`; for a whole scope, `git checkout <sha> -- <your-paths>` restores its final state in one shot (cleaner than cherry-picking N commits). **Then land it to origin via a worktree** — recommitting only to local `main` leaves it local-only and the *next* reconcile RE-WIPES it. The individual commits stay in the reflog with full attribution; the recovered snapshot must reach origin to be durable.
3. **Don't re-litigate the reconcile** — it's owner-gated and the correct fix for a large divergence ([memory: local-main reconcile is owner-gated]). Recover your work and move on; don't propose/flag another reset.
4. **Systemic:** hold the push-cadence ceiling (fewer local-only commits → a reconcile wipes less) and sync approved work to origin promptly (TL/DevOps), so it survives a reset. Ties to the push-contention LARGE-divergence variant.
5. **Fleet awareness:** a reconcile wipes EVERY agent's local-only commits — surface it so others recover theirs from reflog too.

**Status:** Active — recovery playbook; **validated the session's object-level discipline** (used it to recover Sage's own work). Sage recovered to local main (`e8ddad72`/`697fc5a2`) then **worktree-landed to origin** (per DevOps p/26#22 + PM t/1872 — a local-main recommit is NOT durable; the next reconcile re-wipes it). Other agents' local-only commits (te/debate/CL) are also in the reflog (~30d window) and need the same reflog→checkout→worktree-land-to-origin recovery — DevOps/PM amplifying the fleet note (t/1872).

**Applies To:** All agents whose work lives on the shared local `main` until synced — i.e. everyone who commits but doesn't push.

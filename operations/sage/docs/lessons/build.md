# Build Patterns

Failure patterns related to builds, CI, tooling, environment, and git operations.

---

## [Build] Bash Dollar-Sign Variable Substitution Corrupts Code

**Pattern:** Bash interprets dollar-sign expressions in commands as variable substitution, corrupting code that uses dollar-sign syntax (JS template literals, PowerShell variables like `$_`).

**Instances:**
- 2026-05-21 — Shared Lib agent: sed commands with JS `${activePovers.length}` caused "bad substitution" (p/5#1).
- 2026-05-21 — Technical Lead: PowerShell `$_.ToString()` mangled by bash string interpolation. Resolved by restructuring the command to avoid `$_` in bash context (p/8#5).

**Root Cause:** Bash expands dollar-sign expressions (`${...}`, `$_`, `$var`) before passing them to the target command. This silently corrupts or errors on code from languages that also use dollar-sign syntax (JS/TS template literals, PowerShell variables).

**Prevention:**
1. Prefer line-number addressing for sed over pattern matching when patterns contain dollar-sign syntax.
2. Use the dedicated Edit/Write tools instead of Bash sed/heredoc when target code contains dollar-sign expressions.
3. If Bash is unavoidable, restructure commands to avoid dollar-sign segments, or write a temp script and execute it.
4. Root AGENTS.md File Editing Rule now codifies this (q/4 approved, p/8#7).

**Status:** Resolved — systemic prevention via AGENTS.md rule.

**Applies To:** All agents using Bash to edit/run TypeScript, JavaScript, PowerShell, or any code with dollar-sign syntax.

---

## [Build] Bash Heredoc Failures with Nested Quotes

**Pattern:** Bash heredocs and `bash -c`/`pwsh -Command` wrappers fail when the embedded code contains nested single quotes — common across Python, PowerShell, and TSX/JSX string literals.

**Instances:**
- 2026-05-21 — Taxonomy Editor agent hit heredoc failures twice when running Python code containing TSX string literals with nested single quotes (p/6#1).
- 2026-05-24 — PowerShell agent: `pwsh -Command '...'` with embedded PowerShell single-quoted strings caused `unexpected EOF while looking for matching backtick`. Fixed by replacing inner single-quoted strings with double-quoted strings (p/20#3).
- 2026-05-24 — Computational Linguist: Bash heredoc failed again on a large Python analysis script with apostrophes in f-strings. Fixed by splitting into two scripts (data collection to `/tmp/belief_signals.json`, then analysis) and using %-formatting instead of f-strings to avoid apostrophes (p/7#7).
- 2026-06-17 — Sync: `git commit -m @'...'@` in Bash tool errored — `@'...'@` is PowerShell here-string syntax, Bash split the multi-line message into stray pathspec args. Fixed by writing commit message to temp file and using `git commit -F <file>` (p/77#1).
- 2026-06-17 — ServerAPI: same `@'...'@` in Bash issue, compounded by placing `-m` after `--` separator — everything after `--` is treated as pathspecs, so the message flag was ignored entirely. Fixed with `git commit -F <file> -- <paths>` (message flag before `--`) (p/79#1).
- 2026-06-17 — DebateUI: `@'...'@` in Bash tool leaked a literal `@` into a commit subject on shared branch. Part of a larger incident where amend clobbered another agent's commit (p/83#1).
- 2026-07-15 — Computational Linguist (t/1586): inline PowerShell in Bash heredoc with backtick-escaped variables hit "unexpected EOF while looking for matching backtick" — twice in the same session. Fixed by writing script to temp file with Write tool (p/7#30).
- 2026-07-17 — PowerShell (t/1712, p/20#23): an inline `pwsh -Command` containing a PowerShell `-split "`n"` (backtick-n) plus nested single/double quotes broke **bash's own parser** (`unexpected EOF while looking for matching quote`) before pwsh ran at all. Fixed by writing the PS snippet to a temp `.ps1` and running `pwsh -File` — the ADR-004 remedy. Reinforces that once inlined PS carries backtick escapes AND nested quotes, `-File` beats fighting the quoting.
- 2026-08-03 — Computational Linguist (p/7#53): inline Python in a `bash -c` heredoc during a prose-measurement session contained **backtick characters** (used in the Python code itself). Bash interpreted them as command substitution delimiters → `unexpected EOF` parse error. Fixed by switching to the **PowerShell tool with a `@'...'@` here-string** — the PowerShell tool parses the here-string natively, so backticks are literal; no bash parser involved. Alternative: Write tool → temp `.py` file → Bash execute (prevention #1).

**Root Cause:** Heredocs (even quoted `<< 'EOF'` which disable variable expansion) still cannot contain the same quote delimiter used by the inner language. The `bash -c` and `pwsh -Command` wrappers compound this by adding another quoting layer. Additionally, PowerShell-specific syntax (`@'...'@` here-strings) is silently misinterpreted by Bash, not rejected — leading to confusing errors. The `--` separator compounds commit message issues: all flags must come before `--`, or git treats them as pathspecs.

**Prevention:**
1. **First choice:** Use the Write tool to create a temp `.py` script file, then execute it with Bash — avoids all quoting issues.
2. Split complex scripts into smaller pieces that each avoid quote conflicts, passing data via temp files (e.g., JSON to `/tmp/`).
3. In Python, use %-formatting or `.format()` instead of f-strings when the content will pass through Bash.
4. For PowerShell via Bash, use double-quoted strings inside the command to avoid single-quote nesting.
5. Prefer the Edit/Write tools over Bash heredocs for file creation/modification.
6. For git commits: use `git commit -F <tmpfile> -- <paths>` — write message to temp file, and always place flags before the `--` separator.
7. **For any non-trivial PowerShell, prefer `pwsh -File <script.ps1>` over inline `pwsh -Command "..."`** (p/20#23). The moment the PS carries backtick escapes (`` `n ``, `` `t ``), nested quotes, or `$` refs, the inline form fights two parsers (bash then pwsh); a temp `.ps1` + `-File` sidesteps both. This is the ADR-004 "write to a file, then run it" remedy applied to PS specifically.
8. **On win32 with backtick-containing code, use the PowerShell tool directly with `@'...'@`** — the PowerShell tool's native single-quoted here-string handles backticks as literals; no Bash parser is involved. Simpler than a temp file when the code is short and self-contained (p/7#53).

**Status:** Resolved — AGENTS.md rule broadened to cover both file editing and script execution (p/8#14). Original rule from q/4 now includes: write scripts to temp files with Write tool, then execute via Bash. Prevention #7 (`pwsh -File` over inline `-Command` for non-trivial PS) added 2026-07-17 (p/20#23) — a durable instance-triggered refinement, already covered by ADR-004/Shell Quoting Rule so no new root rule needed.

**Applies To:** All agents using Bash heredocs to run or generate code with nested quoting across languages.

---

## [Build] Git Commit Fails Without user.name/user.email

**Pattern:** `git commit` fails on fresh clones or new machines when global git config lacks `user.name` and `user.email`.

**Instances:**
- 2026-05-21 — Orca Support hit commit failure on a fresh clone without global git config (p/13#6).

**Root Cause:** Git requires `user.name` and `user.email` to create commits. Fresh environments (new machines, containers, CI without config) lack these by default.

**Prevention:**
1. Set repo-local config: `git config user.name "Name"` and `git config user.email "email"`.
2. Consider adding git config setup to post-create scripts (e.g., `.devcontainer/post-create.sh`) for containerized environments.
3. Agents should check for git config before attempting commits in unfamiliar environments.

**Status:** Active

**Applies To:** All agents making git commits, especially in fresh or containerized environments.

---

## [Build] Missing or Unavailable CLI Tools/Services in Dev Environment

**Pattern:** Commands fail because CLI tools are not installed or required background services are not running.

**Instances:**
- 2026-05-23 — DevOps: `az` CLI not found in bash or PowerShell. Used `gh` CLI as fallback for workflow checks (p/26#1).
- 2026-05-28 — Taxonomy Editor: `docker image ls` returned exit code 1 with no output because Docker Desktop daemon was not running. Fixed by starting Docker Desktop and waiting for initialization (p/6#9).
- 2026-07-17 — PowerShell (verifying t/1699 `check-quality-gates.sh`, p/20#21): `jq` is not on PATH in the dev Bash/pwsh shell, but the script hard-depends on it (CI runners DO have jq), so a local run of the real script failed. Resolved by running the script end-to-end behind a **minimal python `jq` shim** on PATH — verifying the actual script rather than skipping/mocking the jq calls. Technique worth reusing: shim a missing CI-only tool so the real gate script still runs locally.
- 2026-07-28 — Taxonomy Editor (p/6#24): **`bc` is not installed** in this Windows git-bash — a `git grep -c … | paste -sd+ | bc` pipeline failed with "bc: command not found". Resolved by summing with **`awk '{s+=$1} END{print s}'`** instead. `awk` is present in git-bash where `bc` isn't — use it for arithmetic in Bash-tool pipelines.
- 2026-08-01 — Technical Lead (p/8#158): **2nd `jq` instance** — a Bash `jq` command parsing `~/.claude` JSON (a `/doctor` health-check) exited **127 "command not found"**; `jq` isn't installed in the Bash tool's Git Bash env on this host. Resolved by moving the JSON reads to the **PowerShell tool (`ConvertFrom-Json`)** + native git. Distinct from the p/20#21 python-`jq`-shim (that was to run a CI gate script that *hard-depends* on jq); for **ad-hoc JSON reads, don't shim — read in PowerShell** (`Get-Content x.json | ConvertFrom-Json`), per the win32 "host/file/JSON ops belong in the PowerShell tool" rule.

**Root Cause:** Dev environment may lack CLI tools (Azure CLI not installed, `jq` not on PATH, `bc` not in git-bash) or required background services (Docker Desktop daemon not running). CI runners often have tools the dev shell doesn't, so a script that passes in CI fails locally. Both fail silently or with unhelpful exit codes.

**Prevention:**
1. Before using a CLI tool, check availability with `command -v <tool>` or `Get-Command <tool>` and fall back gracefully if missing.
2. For Docker commands, first verify the daemon is running: `docker info > /dev/null 2>&1`. If it fails, start Docker Desktop and wait for initialization.
3. When a tool is unavailable, prefer alternative tools already installed (`gh` instead of `az`) over blocking.
4. When a command returns exit code 1 with no output, suspect a missing tool or stopped service before debugging the command itself.
5. To verify a CI gate script locally when it depends on a CI-only tool (`jq`), **shim the tool** (e.g. a minimal python `jq` on PATH) and run the REAL script end-to-end — don't skip its calls or reimplement its logic, which defeats the verification.
6. **For arithmetic in Bash-tool pipelines, use `awk`, not `bc`** — `bc` is not installed in this Windows git-bash. Sum a column with `awk '{s+=$1} END{print s}'`; `awk` (and `python3`) are present where `bc` isn't.
7. **For ad-hoc JSON reads, use the PowerShell tool (`Get-Content x.json | ConvertFrom-Json`), not Bash `jq`** — `jq` is NOT installed in this host's Git Bash (exits 127). Shimming (prevention #5) is only for running a CI script that hard-depends on jq; for your own JSON parsing, read it in PowerShell. Fits the win32 "host/file/JSON ops belong in the PowerShell tool, Bash is POSIX-sh-only" rule.

**Status:** Active

**Applies To:** All agents running CLI commands, especially DevOps, Docker, and CI-related work.

---

## [Build] Node.js Cannot Directly Execute TypeScript Source Files

**Pattern:** `node -e` or `node <file>` fails when importing TypeScript `.ts` files or referencing `.js` extensions for files that only exist as `.ts` — there are no compiled `.js` outputs.

**Instances:**
- 2026-05-23 — Shared Lib: `node -e` with ESM import of `.js` extension failed because the TypeScript source files aren't compiled to `.js`. Vitest handles transpilation internally but raw Node.js doesn't (p/5#5).

**Root Cause:** This project uses vitest for testing, which transpiles TypeScript on the fly. There is no build step that produces `.js` files. Raw `node` commands cannot import `.ts` files or resolve `.js` imports that don't exist on disk.

**Prevention:**
1. Use `npx tsx <file>` or `npx ts-node <file>` to execute TypeScript files directly.
2. For debugging, read the source code with the Read tool rather than trying to execute it with `node -e`.
3. Run tests through vitest (`npm test`), not by invoking node directly on test files.
4. Do not assume `.js` files exist — check for a build/dist directory first.

**Status:** Active

**Applies To:** All agents working with TypeScript source in the Electron apps or debate engine.

---

## [Build] Unix Paths in Node.js Fail on Windows

**Pattern:** Node.js commands using Unix-specific paths like `/dev/stdin` fail on Windows because Node resolves them as Windows paths (e.g., `C:\dev\stdin` → ENOENT).

**Instances:**
- 2026-05-24 — Taxonomy Editor: `node -e` with `/dev/stdin` pipe failed on Windows. Node resolved `/dev/stdin` as `C:\dev\stdin` which doesn't exist. Fixed by writing a temp `.mjs` script file instead of piping (p/6#5).

**Root Cause:** `/dev/stdin`, `/dev/stdout`, `/dev/null` and other Unix device paths don't exist on Windows. Node.js on Windows doesn't translate these — it treats them as literal file paths under the current drive root.

**Prevention:**
1. Avoid `/dev/stdin` piping patterns — write temp script files (`.mjs` or `.js`) and execute them directly.
2. Use platform-agnostic alternatives: `process.stdin` in Node.js code instead of `/dev/stdin` file paths.
3. For `/dev/null`, use `NUL` on Windows or use cross-platform libraries.
4. When writing Bash commands that run Node.js, remember the dev environment is Windows — test Unix-isms mentally before using them.

**Status:** Active

**Applies To:** All agents running Node.js commands on this Windows dev environment.

---

## [Build] Bash grep Features Fail Silently on Windows/Git Bash

**Pattern:** `grep -P` (Perl regex) and `grep -o` with complex patterns fail silently (exit code 1, no output) on Windows Git Bash, with no error message indicating the feature is unsupported.

**Instances:**
- 2026-05-27 — Computational Linguist sub-agent: both `grep -P` and `grep -o` with quoted JSON patterns produced no output on Windows/Git Bash. Resolved by using the Read tool instead of Bash grep for JSON field extraction (p/40#1).

**Root Cause:** Git Bash ships a minimal GNU grep that may lack PCRE (`-P`) support and handles complex patterns (especially with JSON special characters) differently than Linux grep. Failures are silent — no stderr, just exit code 1 — making them hard to diagnose.

**Prevention:**
1. Use the dedicated Read and Grep tools instead of Bash `grep` for file content inspection — especially for structured data like JSON.
2. For JSON field extraction specifically, use `python3 -c "import json; ..."` or `jq` instead of grep with regex.
3. Avoid `grep -P` entirely on this platform — PCRE support is not guaranteed in Git Bash.
4. When grep returns no output, suspect platform incompatibility before assuming the pattern doesn't match.

**Status:** Active

**Applies To:** All agents using Bash grep on this Windows/Git Bash environment.

---

## [Build] Push Rejected Due to Stale Local (Multi-Agent Contention)

**Pattern:** `git push` rejected (non-fast-forward) because remote has newer commits from other agents working in parallel.

**Instances:**
- 2026-05-24 — Project Manager: push to `ai-triad-data` rejected after `embeddings.json` modified both locally and remotely. Resolved with stash/pull --rebase/take theirs/push (p/31#1).
- 2026-05-24 — Technical Lead: push to code repo main rejected with 3 unpushed CI fixes. Resolved with stash/pull --rebase, merge conflict in `logger.ts` (kept cached `usePretty` approach), rebase --continue/stash pop/push (p/8#11).
- 2026-06-25 — DebateWorkspace: push to main rejected (non-fast-forward) due to remote having commits not in local. Resolved by stashing overlay files, `git pull --rebase`, restoring stash, then pushing (p/124#1).
- 2026-07-04 — Server Community: push rejected after committing flight-recorder fix. Remote main had new commits from other agents. Resolved with `git stash && git pull --rebase && git stash pop` then push (p/160#1).
- 2026-07-17 — Diagnostics (p/9#36, **LARGE-divergence variant — NOT self-correcting**): push rejected with local main **46 commits ahead** of origin while origin was **52 ahead** — a genuine divergence, not a small window. The standard `git stash && merge/rebase` flow **aborted on conflicts in out-of-scope files** the agent didn't own, so it couldn't be resolved independently — **routed to TL**. The 46 unpushed local commits are themselves a **push-cadence breach** (root AGENTS.md ceiling is ~10 approved commits before syncing); once the pile grows that large, a divergence tangles many agents' work and the routine resolution stops working.

**Root Cause:** Multiple agents work in parallel on the same branches. The window between local commits and push allows remote to advance, causing non-fast-forward rejections. More agents = more contention. **At small scale this is self-correcting** (stash/pull --rebase/pop/push). **At large scale it is not:** when approved commits accumulate far past the push-cadence ceiling (~10), the shared local main drifts tens of commits from origin; a rebase/merge then spans many agents' out-of-scope changes and hits conflicts no single agent can adjudicate — so it must go to TL/DevOps, who own push/sync. The large divergence is a *symptom of a cadence breach*, not just bad luck in the commit-to-push window.

**Prevention:**
1. Pull immediately before committing: `git pull --rebase` then commit and push without delay.
2. For generated data files (`embeddings.json`, `policy_actions.json`), prefer "take theirs" conflict resolution unless your changes are the authoritative regeneration.
3. For code conflicts, understand the intent of both changes before resolving — don't blindly take either side.
4. Minimize the commit-to-push window — do both in quick succession.
5. Standard resolution flow: `git stash && git pull --rebase origin main` → resolve conflicts → `git rebase --continue && git stash pop && git push`.

**Prevention (added for the large-divergence variant):**
6. **Bound the divergence via push cadence** — don't let approved commits pile past the ~10 ceiling (root AGENTS.md "Commit & Push Cadence"). A small stale-local is self-correcting; a 40+/50+ divergence is not, because the rebase spans many agents' out-of-scope files.
7. **A large divergence is a TL/DevOps event, not a solo fix** — if `git stash && pull --rebase` hits conflicts in files you don't own, STOP and route to TL/DevOps (who own push/sync). Do not force-resolve out-of-scope conflicts.

**Status:** Active — **6 instances / 5 agents; now split by scale.** SMALL contention (commit-to-push window) remains self-correcting and NOT escalating — git rejects (no silent corruption), stash/pull --rebase/pop/push resolves it independently. The **LARGE-divergence variant (p/9#36: 46 ahead / 52 ahead) IS a signal** — it's a push-cadence-ceiling breach that produces out-of-scope conflicts and requires TL/DevOps. The systemic fix is not a new push-mechanics rule but *holding the existing cadence ceiling*; flagged to TL/DevOps that a fleet sync sweep + cadence discipline is the lever, not per-agent resolution.

**Applies To:** All agents pushing to shared branches in either repo — and TL/DevOps for the large-divergence/cadence-breach variant.

---

## [Build] Git Amend on Shared Branch Clobbers Other Agents' Commits

**Pattern:** `git commit --amend` on a branch with multiple concurrent committers rewrites another agent's commit when HEAD advances between the original commit and the amend.

**Instances:**
- 2026-06-17 — DebateUI: ran `git commit --amend` on `feat/phase-5c-diff-view` to fix a commit message. Between the original commit and the amend, another agent committed (t/651), moving HEAD. The amend rewrote that agent's commit with DebateUI's message, clobbering their work. Recovered via `git reflog` to find the original SHA, then `git reset --soft <sha>` to restore it (p/83#1).

**Root Cause:** `git commit --amend` rewrites the commit at HEAD. On a shared branch, HEAD can move between your commit and your amend if another agent commits in that window. The amend then targets the wrong commit — the other agent's — replacing their message and potentially their changes.

**Prevention:**
1. **NEVER use `git commit --amend` on a shared branch.** Create a new commit instead.
2. If a commit message needs fixing, use `git commit --allow-empty -m "corrected message"` or create a fixup commit.
3. `--amend` is only safe on personal/feature branches with a single committer.
4. Recovery: `git reflog` to find the clobbered commit's SHA, then `git reset --soft <sha>` to restore it (preserves index and worktree).

**Status:** Resolved — "Git Commit Rule (Multi-Agent)" added to root AGENTS.md covering amend and rebase on shared branches (p/8#25).

**Applies To:** All agents committing to shared branches (especially `main` and shared feature branches).

---

## [Build] Overlay Repo (ogit) Requires Special Git Handling

**Pattern:** The Orca overlay repo (`ogit`) has four recurring git pitfalls: (1) `ogit` is a shell alias unavailable in non-interactive shells (Bash tool), (2) `git add` rejects files that match the main repo's `.gitignore` — negation patterns can't re-include files under already-excluded parent dirs, (3) push contention occurs just like the main repo, (4) git flag ordering — `-- <pathspec>` must come AFTER all flags like `-m`.

**Instances:**
- 2026-05-27 — Taxonomy Editor: `ogit add` rejected paths ignored by main repo's `.gitignore`. Fixed with `git add -f` since the overlay intentionally tracks files like `.orca.yaml` and `AGENTS.md` that the main repo ignores (p/6#7).
- 2026-05-27 — Taxonomy Editor: `ogit push` rejected due to remote having newer commits. Fixed with `git pull --rebase` then push (p/6#7).
- 2026-06-19 — ElectronMain: (a) `ogit` failed with "command not found" in Bash tool — it's a shell alias only available in interactive shells. Fixed by expanding to `git --git-dir=.orca-git --work-tree=.`. (b) `git add` of a new nested `AGENTS.md` rejected as "ignored by .gitignore" — `.orca-gitignore` has `!**/AGENTS.md` negation, but git can't re-include a file when its parent directory is already excluded. Fixed with `git add -f` (p/98#1).
- 2026-06-25 — Shared Lib: `ogit commit` failed with "pathspec '-m' did not match any file(s)" — `-- lib/AGENTS.md` pathspec was placed before `-m` flag, so git treated `-m` as a pathspec. Fixed by moving `-- lib/AGENTS.md` after `-m "message"` (p/5#11).
- 2026-06-25 — Conflict: `ogit add taxonomy-editor/.../conflict/AGENTS.md` failed ("paths are ignored by .gitignore") — same parent-dir exclusion issue as p/98#1, this time for a per-directory AGENTS.md under `taxonomy-editor/`. Fixed with `ogit add -f` (p/122#1).
- 2026-07-06 — Orca Support: `git --git-dir=.orca-git --work-tree=. add -f ...` failed from `orca-support/` subdirectory — Bash tool cwd is the role's scope directory, not the repo root, so `.orca-git` wasn't found. Fixed by switching to PowerShell with explicit `cd` to repo root (p/13#10).
- 2026-07-17 — Computational Linguist: `git --git-dir=.orca-git add research/comp-linguist/AGENTS.md` failed "paths ignored by .gitignore" even though the file was **already tracked AND already staged** (the `research/` exclusion still blocks a re-`add`). Resolved by **skipping `add` entirely and committing the staged pathspec directly** — `commit -- <path>`. Refines the rule: `-f` is for the *first* stage of a not-yet-tracked file; an already-tracked/staged overlay file needs no re-add at all (p/7#39).
- 2026-08-01 — Orca Support (p/13#24, e2bfe23): **RECURRENCE of the run-from-subdir facet (pitfall #4 / prevention #4)** — `git --git-dir=.orca-git … commit` from the `orca-support/` subdir failed (`.orca-git` not visible from subdirs, because the Bash-tool cwd is the role's scope dir, not the repo root); re-ran from the repo root `C:\…\ai-triad-research` → committed `e2bfe23`. **Same agent, same facet ~1 month after p/13#10** — the root-run rule + `overlay-repo-guard` hook exist, but the facet still bites from a role subdir; loud + self-correcting (fails immediately, re-run from root), so not escalating.

**Root Cause:** (1) `ogit` is defined as a shell alias (`alias ogit='git --git-dir=.orca-git --work-tree=.'`), which is only loaded in interactive shell sessions — the Bash tool runs non-interactive. (2) The overlay repo shares the working tree with the main repo, so `.gitignore` affects `ogit add`. Negation patterns (`!**/AGENTS.md`) cannot re-include files when a parent directory is already excluded by a broader rule — this bites on every new per-directory AGENTS.md. (3) Multiple agents update overlay files in parallel, causing push contention. (4) Git argument ordering: `-- <pathspec>` must come last — placing it before flags like `-m` causes git to treat the flag as a pathspec.

**Prevention:**
1. **Never use `ogit` in the Bash tool** — expand it to `git --git-dir=.orca-git --work-tree=.` since shell aliases aren't available in non-interactive shells.
2. Use `-f` (force) when **first staging** a not-yet-tracked overlay file — they are gitignored by the main repo by design, especially nested `AGENTS.md` files under already-excluded parent directories. But if the file is **already tracked/staged**, don't re-`add` at all (the parent-dir ignore still rejects a bare `add`, even with the change staged) — just `commit -- <path>` the pathspec directly (p/7#39).
3. Before pushing, run `git --git-dir=.orca-git --work-tree=. pull --rebase` to incorporate remote changes.
4. Must be run from the repo root — `.orca-git` is not visible from subdirectories.
5. Never use `git add` or `git commit` for overlay-tracked files — always use the expanded overlay git command.
6. **Git flag ordering:** `-- <pathspec>` must be the LAST argument — `git commit -m "msg" -- path`, never `git commit -- path -m "msg"` (git treats `-m` as a pathspec).

**Status:** Resolved — root AGENTS.md rule (p/8#28) + `overlay-repo-guard` PreToolUse hook extended to catch both wrong-repo commits and missing `-f` on nested overlay files (p/9#13).

**Applies To:** All agents committing to the overlay repo (AGENTS.md, .orca.yaml, .orca/ directory).

---

## [Build] Docker Build Fails Due to Wrong Relative Import Path Depth

**Pattern:** TypeScript relative import paths that work in the source tree break inside Docker build contexts when the file's depth relative to the imported module differs from the source layout.

**Instances:**
- 2026-05-28 — Taxonomy Editor: Docker build failed with TS2307 `Cannot find module '../../lib/debate/types.js'` in `server.ts`. The inline `import()` type had wrong relative path depth (2 levels instead of 3). Fixed by changing to `../../../lib/debate/types.js`. Commit 25a1e15 (p/6#11).

**Root Cause:** Docker COPY commands and build context can change the relative directory structure compared to the source tree. Relative import paths must account for the file's position within the Docker build context, not just the source repo layout.

**Prevention:**
1. When adding cross-directory imports in Dockerized code, count path depth from the file's location in the build context, not the source repo.
2. After modifying imports in Docker-built code, verify with `tsc --noEmit` inside the Docker build (or a local dry run) before pushing.
3. Consider using tsconfig path aliases to avoid fragile relative paths in Docker builds.

**Status:** Active

**Applies To:** All agents working on Docker builds that include TypeScript with cross-directory imports.

---

## [Build] CI Workflow Lacks workflow_dispatch Trigger

**Pattern:** `gh workflow run ci.yml` fails because the CI workflow only has `push` and `pull_request` triggers — no `workflow_dispatch` for manual runs.

**Instances:**
- 2026-05-28 — Diagnostics: attempted `gh workflow run ci.yml` but the workflow doesn't have `workflow_dispatch`. Resolved with an empty commit to trigger the push event (p/9#10).

**Root Cause:** The CI pipeline (`.github/workflows/ci.yml`) is configured with `push` and `pull_request` triggers only. There's no `workflow_dispatch` trigger to allow manual or programmatic runs via `gh workflow run`.

**Prevention:**
1. To trigger CI without code changes, use `git commit --allow-empty -m "trigger CI" && git push`.
2. Consider adding `workflow_dispatch:` to `ci.yml` triggers for manual/programmatic runs.
3. Check workflow triggers before assuming `gh workflow run` will work: `gh workflow view ci.yml`.

**Status:** Active

**Applies To:** All agents attempting to manually trigger CI workflows.

---

## [Build] Python Windows Encoding Default

**Pattern:** Python on Windows defaults to cp1252 encoding for both file I/O and stdout. Any operation involving non-ASCII characters (em dashes, arrows, accented names, Unicode quotes) fails or silently corrupts.

**Instances:**
- 2026-05-22 — Technical Lead: `json.load()` failed on debate JSON files with UTF-8 characters because `open()` defaulted to cp1252 on Windows (p/8#9).
- 2026-05-25 — Computational Linguist: stdout encoding error — cp1252 can't encode Unicode arrow U+2192. Fixed by wrapping stdout with `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` (p/7#9).
- 2026-07-12 — Computational Linguist: prose-audit Python script crashed printing match context containing U+2264 (≤). Windows console cp1252 can't encode it. Fixed with `sys.stdout.reconfigure(encoding="utf-8")` at script top (p/40#5).
- 2026-07-15 — Computational Linguist: `open()` on a project JSON file without `encoding='utf-8'` raised UnicodeDecodeError (cp1252 can't decode 0x90). Em dashes and non-ASCII chars in debate transcripts triggered it. Fixed by adding `encoding='utf-8'` (p/7#32).
- 2026-07-16 — Computational Linguist: a `python -c` one-liner printing doc excerpts crashed with UnicodeEncodeError — Windows console stdout defaults to cp1252 and the doc contained '→' (U+2192). Recovered from partial output + a full-file Read. Prevention adopted: write analysis scripts to a file (never `python -c`), run with `python -X utf8`, avoid printing raw doc text (p/7#34).
- 2026-07-26 — Technical Lead (p/8#89): `python -c "print(open(file).read()[...])"` exited 1 with UnicodeEncodeError — Windows Python stdout defaults to cp1252 and the data contained '↔' (U+2194). Fixed by NOT printing unicode file contents to the console — parse in-memory and write results to a UTF-8 file (or set `PYTHONIOENCODING=utf-8`), then Read that file. Textbook repeat of the p/7#34 instance (different char, same `python -c` print-to-stdout exposure); the standing prevention (#4/#5) already prescribes exactly this.
- 2026-07-30 — Computational Linguist (p/7#51): a prose-lint Python script crashed printing '→' (U+2192) to a cp1252 console (UnicodeEncodeError) **after** successfully computing its counts; rerun with `PYTHONIOENCODING=utf-8` fixed it — the data was fine, only the console encode failed. **7th instance — and notable because it was a proper FILE-SCRIPT, not a `python -c` one-liner**, so behavioral prevention #5 ("prefer file-scripts over `-c`") did NOT prevent it: a file-script still prints to a cp1252 console unless it sets encoding UP FRONT. Shifts the durable lever from "avoid `-c`" to "**force UTF-8 up front, regardless of `-c` vs file**" (prevention #2/#4) — or set it globally (see Status escalation).

**Root Cause:** Python's `open()` and `sys.stdout` use `locale.getpreferredencoding()` which is cp1252 on most Windows systems, not UTF-8. Both file I/O and subprocess stdout are affected. Ad-hoc `python -c` one-liners are especially exposed: they encourage printing raw doc text straight to a cp1252 console with no `reconfigure`/`-X utf8` safeguard.

**Prevention:**
1. Always pass `encoding='utf-8'` to `open()` when reading or writing JSON, markdown, or any text data files.
2. For stdout with Unicode content, wrap with `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` or call `sys.stdout.reconfigure(encoding='utf-8')` at script top.
3. Use `json.loads(Path(f).read_text(encoding='utf-8'))` as an alternative pattern for file reads.
4. Force UTF-8 globally: set `PYTHONUTF8=1` or `PYTHONIOENCODING=utf-8` env var, or invoke with `python -X utf8`.
5. Prefer a written-to-file analysis script over a `python -c` one-liner (avoids the console-encoding exposure), and read doc text via the Read tool rather than printing raw non-ASCII content to stdout.

**Status:** Active — **7 instances, 2 agents (CL ×5 + TL ×2).** Self-correcting (crashes loudly, data intact, rerun fixes) — but **recurring despite documented prevention = a rule-not-applied signal (#82-shaped).** The 7th (p/7#51) is the key data point: it was a **FILE-SCRIPT, not `python -c`**, so the "prefer file-scripts over `-c`" behavioral lever (prevention #5) is **insufficient** — a file-script still hits a cp1252 console unless it forces UTF-8 up front. **ESCALATION ACCEPTED → DevOps t/2046 (TL p/8#145):** the clean systemic lever is a **global env default — set `PYTHONUTF8=1` (or `PYTHONIOENCODING=utf-8`) workspace-wide** (Orca env setting / shell profile), so NO script needs to remember; converts a point-of-use rule into a point-of-environment guarantee. TL routed it to **DevOps as t/2046 (environment-management scope)** with **gate-verification ACs** (prove `utf8_mode` active + demonstrate the failure case now passes — not just "set it") and **deliberately did NOT author an AGENTS.md rule** — a point-of-use rule can't close a point-of-environment bug (the same memory-dependent lever that already failed 7×). Awaiting t/2046 resolution to close the pattern. Until it lands, the durable habit stands: **force UTF-8 up front (`sys.stdout.reconfigure` / `-X utf8` / the env var), file-script or not; don't `print()` raw non-ASCII to a cp1252 stdout.**

**Applies To:** All agents writing Python that reads/writes text files or prints Unicode, especially on Windows.

---

## [Build] Relative Paths Double When CWD Is Already the Target Directory

**Pattern:** Running a command with a relative path like `node lib/debate/script.mjs` fails with MODULE_NOT_FOUND when the CWD is already `lib/debate/`, because the path resolves to `lib/debate/lib/debate/script.mjs`.

**Instances:**
- 2026-06-16 — DebateTool: `node lib/debate/_add_stack.mjs` failed because CWD was already `lib/debate/`, doubling the path. Fixed by using absolute path (p/70#1).

**Root Cause:** Bash tool CWD may differ between calls or may have been changed by a prior `cd` command. Relative paths assume CWD is the repo root, but if a previous command changed directory, the relative path stacks on top of the current location.

**Prevention:**
1. Use absolute paths for `node`, `python3`, and other file execution commands — never rely on CWD being the repo root.
2. If using relative paths, verify CWD first with `pwd`.
3. Bash tool CWD persists between calls — a prior `cd` affects all subsequent commands in that shell session.

**Status:** Active

**Applies To:** All agents executing scripts via Bash, especially when working across subdirectories.

---

## [Build] Azure Deploy False-Red from arm-deploy failOnStdErr + Bicep Warnings

**Pattern:** Azure deploy workflow reports failure even though the ARM deployment succeeds, because `azure/arm-deploy@v2` defaults `failOnStdErr:true` and Bicep emits compile warnings to stderr.

**Instances:**
- 2026-06-20 — Infrastructure (Azure): "Deploy to Azure" workflow false-red at "Deploy Bicep template" step. Initial diagnosis blamed an unregistered `Microsoft.AlertsManagement` resource provider — this was WRONG. The stale "Failure Anomalies" deployment in `az deployment list` was from 2026-05-24, not the current run. Registering the RP did not fix the issue. Real cause (confirmed via `gh run view <id> --log-failed`): `arm-deploy@v2` with `failOnStdErr:true` (default) treats Bicep compile warnings (BCP422/BCP318 from `deploy/azure/runner/runner.bicep`) as failures. Final log line: "Error: Deployment process failed as some lines were written to stderr". The ARM deployment itself succeeded. This skipped downstream workflow steps (blue-green gate, DEPLOY_SHA/DEPLOY_TAG stamping). Tracked in t/702 (p/99#1, corrected p/99#4).

**Root Cause:** `azure/arm-deploy@v2` defaults `failOnStdErr:true`. Bicep emits non-fatal compile warnings (BCP422, BCP318) to stderr. The action treats ANY stderr output as a deploy failure, even when the ARM deployment succeeds.

**Prevention:**
1. Set `failOnStdErr: false` on the `arm-deploy` action, OR eliminate the Bicep warnings causing stderr output.
2. Don't ignore false-reds — they mask genuine failures and skip downstream workflow steps (health gates, env-var stamping, traffic shifting).
3. **Diagnosis discipline:** Read the workflow STEP log (`gh run view <id> --log-failed`) AND check the failing deployment's TIMESTAMP before concluding. `az deployment list` top-of-list can surface month-old stale failures — don't trust it without checking dates.

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** DevOps agents managing Azure deployments via arm-deploy actions.

---

## [Build] Post-Deploy Smoke-Test Aggregate Boolean False-Reds a Healthy Prod Deploy

**Pattern:** `Invoke-TaxEditorSmokeTest` reports **Overall FAIL** on a fully healthy prod deploy because the aggregate boolean folds together several orthogonal false-red classes, each of which trips independently. Trusting the top-level Overall boolean instead of the per-category breakdown reads a healthy deploy as broken.

**Instances:**
- 2026-07-16/17 — DevOps: three orthogonal false-red classes plus a CI-fold, all landing on the same Overall FAIL boolean (p/26#12):
  1. **Easy-Auth Sign-In interstitial on API routes** — the smoke hit protected API routes and got Azure Easy-Auth's HTML sign-in interstitial instead of the API response (t/1657, fixed).
  2. **Same interstitial on the `/` SPA root** (t/1657 residual, fixed **6404b682**) — the reclassify step must run **AFTER** the SPA-shell check and must match **any dash** in the title (`[-–—]`, hyphen + en/em dash), or a healthy shell reads as an auth wall.
  3. **Health-phase 15s timeout on scale-from-zero cold start** — a consumption-tier cold start exceeds the 15s health-phase timeout though the app is healthy once warm (t/1696, **open**).
  4. **CI fold:** `OverallPass` folds in the GitHub `ci.yml` conclusion, so a healthy deploy **cannot** show Overall PASS while CI is red — the deploy's health and CI's health are conflated in one boolean.

**Root Cause:** The smoke test collapses independent health dimensions (per-route auth reachability, SPA-shell rendering, health-endpoint latency, and the separate CI conclusion) into a single Overall boolean. Any one false-red — an auth interstitial mistaken for a failure, a cold-start latency blip, a red CI run unrelated to this deploy — forces Overall FAIL even when the deploy is healthy. Same gate-signal-integrity genus as the arm-deploy false-red above (#20/#46/#48/#61/#64): an aggregate signal with tolerated/orthogonal failure inputs can't cleanly report the thing it's supposed to gate.

**Prevention:**
1. **On a post-deploy smoke, read the per-category breakdown, not the Overall boolean.** The boolean is a rollup of orthogonal checks; triage from the category rows (auth, SPA-shell, health-latency, CI).
2. **Reclassify ordering + dash matching:** an auth-interstitial reclassify must run AFTER the SPA-shell check (so a healthy shell isn't reclassified as an auth wall) and must match any dash variant (`[-–—]`) in the page title.
3. **Separate cold-start latency from health failure** — a scale-from-zero cold start needs a warm-up retry or a longer health-phase budget than 15s; don't let a first-hit timeout on a consumption-tier app read as unhealthy (t/1696).
4. **Don't fold an unrelated CI conclusion into deploy health** — or if you must, surface it as its own row so a red CI doesn't mask/force the deploy verdict.

**Status:** Active — classes 1 & 2 fixed (t/1657, 6404b682); class 3 open (t/1696, cold-start health-timeout); CI-fold is by-design but must be read per-row. Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** DevOps and anyone triaging a post-deploy smoke result — read the category breakdown, never the Overall boolean alone.

---

## [Build] Array Index on Empty Array Returns undefined — Silent Until Runtime Crash

**Pattern:** Accessing `array[0]` on an empty array silently returns `undefined` in JavaScript, which propagates until a downstream API rejects it — often far from the original empty-array site.

**Instances:**
- 2026-06-20 — Infrastructure (Azure): CI test-container failed for ~4 weeks. `NODE_ENV=production` (c1cf7ba7) made `ALLOWED_ORIGINS=[]` instead of `null`. `getCorsOrigin()` returned `ALLOWED_ORIGINS[0]` → `undefined`. Node.js 22's `setHeader()` strictly validates header values and threw `TypeError` on the `undefined` value on every request — server started but never responded. Fixed with `?? ''` nullish coalescing guard (a58ec59d, t/723). (p/105#1).

**Root Cause:** Two compounding issues: (1) `array[0]` on an empty array returns `undefined` without error — unlike null-access which would throw. The `undefined` propagated silently through the CORS origin pipeline. (2) Node.js 22 added strict validation to `setHeader()` — passing `undefined` as a header value now throws `TypeError`, whereas earlier Node.js versions silently coerced or ignored it.

**Prevention:**
1. Never use bare `array[0]` to extract a value — guard with `array[0] ?? fallback` or check `array.length > 0` first.
2. When a config variable can be an empty array, treat `[]` as a distinct case from `null`/`undefined` — they behave differently (`[0]` returns `undefined` vs throwing).
3. Node.js 22+ validates `setHeader` values strictly — any `undefined` or non-string value throws. Always validate values before passing to HTTP APIs.
4. When a server starts but never responds to requests, suspect a per-request crash (unhandled exception in middleware or header setup) — check container logs, not just health probes.

**Status:** Active

**Applies To:** All agents writing server-side JavaScript/TypeScript, especially CORS and HTTP header configuration.

---

## [Build] Consumption-Tier ACA Outbound Uses Unpredictable SNAT IPs

**Pattern:** Azure Container Apps on consumption tier use Azure SNAT pool IPs for outbound traffic, not the environment's static IP. Any Deny-default firewall on dependent resources (Storage, Key Vault) blocks ACA access silently or with cryptic errors.

**Instances:**
- 2026-06-20 — DevOps: (a) Storage mount failed with error(13) — `defaultAction:'Deny'` on the Storage Account firewall blocked CIFS mount from consumption-tier ACA because outbound IPs are unpredictable SNAT pool addresses. Fixed by setting `defaultAction:'Allow'` in main.bicep. (b) Key Vault returned ForbiddenByFirewall (403) for the same reason — ACA is NOT a "trusted service" for Key Vault bypass, so the Deny-default firewall blocked it. Fixed the same way: `defaultAction:'Allow'` in main.bicep. (p/26#3).

**Root Cause:** Consumption-tier ACA does not have a fixed outbound IP — it uses Azure's SNAT pool, which rotates IPs unpredictably. Firewall rules that whitelist specific IPs or rely on "trusted Azure services" bypass don't work because ACA isn't in the trusted services list. VNet integration would fix this but exceeds cost targets for this project.

**Prevention:**
1. For consumption-tier ACA, set `defaultAction:'Allow'` on Storage Account and Key Vault firewalls in Bicep — IP-based Deny rules will break.
2. If security requires Deny-default, upgrade to Dedicated-tier ACA with VNet integration for predictable outbound IPs.
3. When a container mount fails with error(13) or Key Vault returns 403, suspect firewall + SNAT before debugging auth/permissions.
4. Test firewall rules with the actual ACA tier — what works in Dedicated (static IP) breaks in Consumption (SNAT).

**Status:** Active

**Applies To:** DevOps and infra agents managing Azure Container Apps on consumption tier with firewalled resources.

---

## [Build] AUTH_OPTIONAL Mode Serves HTML to Unauthenticated API Requests

**Pattern:** When the server runs in AUTH_OPTIONAL mode, unauthenticated API requests receive a login page (HTML) instead of JSON responses, breaking automated test suites that expect API data.

**Instances:**
- 2026-06-20 — DevOps: Acceptance tests went 9/17 → 16/17 → 17/17 across iterations. Initial failures: unauthenticated API requests got HTML login page instead of JSON. Fixed by establishing an anonymous session cookie via `/.auth/anonymous` before running tests. Final failure: sync status test regex matched `"branch"` but actual field was `"session_branch"` — fixed by matching `"enabled"` instead (p/26#3).

**Root Cause:** AUTH_OPTIONAL mode redirects or serves HTML for requests without a session. API test clients that don't establish a session first receive HTML instead of the expected JSON, causing parse failures or assertion mismatches. Additionally, test assertions matched field names that differed from the actual response schema.

**Prevention:**
1. In AUTH_OPTIONAL mode, establish a session before API testing — call `/.auth/anonymous` to get an anonymous session cookie, then include it in subsequent requests.
2. When writing acceptance tests, inspect the actual API response body before writing assertions — don't assume field names from the codebase without verifying the wire format.
3. Prefer matching stable/enum values (like `"enabled"`) over field names that may have prefixes (like `"session_branch"` vs `"branch"`).

**Status:** Active

**Applies To:** All agents writing acceptance/integration tests against the deployed server, especially in AUTH_OPTIONAL mode.

---

## [Build] Git Commit-by-Pathspec Skips Untracked (New) Files

**Pattern:** `git commit -F msg -- <paths>` fails with "pathspec did not match any file(s)" when the paths include newly created files that haven't been staged with `git add`.

**Instances:**
- 2026-06-25 — DebateUI: `git commit -F msg -- <paths>` failed for newly-created files. Fix: `git add <new-files>` first, then pathspec commit. Self-resolved (deedd783, p/83#3).
- 2026-07-06 — Technical Lead: `git commit -- <pathspec>` on a new file errored "pathspec did not match". Fixed by explicit `git add` then commit (369001bb, p/8#51).
- 2026-07-06 — Computational Linguist: same error on a newly created file. Fixed by `git add` then pathspec commit (p/7#26).
- 2026-07-13 — Taxonomy Editor 2 (t/1563): `git commit -- <existing.tsx> <new-test.tsx>` failed on the untracked test file. Fixed by `git add -- <both>` then commit. Compounding: a concurrent broad commit on shared main (8bec8f97) swept the working-tree .tsx into another agent's commit during the verify window — shared-index hazard (p/195#1).
- 2026-07-26 — ServerAPI (t/1788, landed 95348dc8, p/79#13): `git commit -- <paths>` skipped untracked NEW files. Fixed by `git add` the new files first, then `git commit -m "msg" -- <paths>`. Self-resolved. (Same incident also hit the flag-order trap — `-m` after `--`; see "Git `--` Separator Before Flags".) 5th instance / 5 agents — still self-correcting.
- 2026-07-30 — Server AI Proxy (t/2021, p/209#2): `git commit -- <paths>` including a NEW untracked file aborted "did not match any file(s)"; fixed by `git add` the untracked file first, then committing on a branch via `git switch -c` (the branch-first flow — t/2009 now blocks detached-HEAD commits in a worktree). **6th instance / 6 agents — still self-correcting** (git errors loudly; `git add` + retry). Adjacent confirmation: the **t/2009 detached-HEAD commit-guard fired correctly** on the same land.

**Root Cause:** `git commit -- <paths>` only commits changes to already-tracked files (modified or staged). Untracked (newly created) files are invisible to the pathspec — git doesn't auto-stage them. This is the expected git behavior but surprises agents accustomed to `git add -A` workflows.

**Prevention:**
1. Before `git commit -- <paths>`, check if any paths are new files: `git status --porcelain <paths>` — lines starting with `??` are untracked.
2. For new files, run `git add <new-files>` before the pathspec commit.
3. Pattern: `git add <new-files> && git commit -F msg -- <all-paths>`.

**Status:** Active

**Applies To:** All agents using pathspec commits (especially on shared branches where `git commit -- <paths>` is required by ADR-005).

---

## [Build] Bare Git Commit Sweeps Shared Staging Index

**Pattern:** Running `git commit` without a pathspec on a shared branch commits everything in the staging index — including files other agents have staged but not yet committed. Attempting to undo with `git reset --soft HEAD~1` after the commit reaches the remote can rewind another agent's already-landed commit, causing local/remote divergence.

**Instances:**
- 2026-06-25 — EdgeBrowser: bare `git commit` for t/1009 (3bde76f2) swept in 41 other agents' pre-staged files and pushed to origin/main. A follow-up `git reset --soft HEAD~1` attempted to undo it but rewound a different agent's already-landed commit, causing 1/1 local/origin divergence. Stopped all git surgery, escalated to TL/DevOps. No data lost; divergence mergeable (p/123#1).
- 2026-07-17 — Diagnostics (commit 7895cbe6, p/9#36): used `git add <file> && git commit` (bare commit, no pathspec) instead of `git commit -- <file>`, sweeping other agents' pre-staged files into the commit. **2nd recorded violation** despite ADR-005 + the memory rule — the trap is that `git add <file> && git commit` *feels* scoped (you named the file to `add`) but the bare `commit` still takes the whole shared index. Surfaced alongside a large-divergence push failure the same session (see "Push Rejected — Multi-Agent Contention" large-divergence variant).

**Root Cause:** Git's staging index is shared across all processes in the working tree. When multiple agents run `git add` in parallel, they all stage into the same index. A bare `git commit` (without `-- <paths>`) commits the entire index — not just the files the committing agent staged. The follow-up `git reset --soft HEAD~1` compounds the problem: if another agent committed and pushed between the original commit and the reset, HEAD~1 points to a different commit than expected, rewinding their work.

**Prevention:**
1. **Always use `git commit -- <explicit-paths>`** on shared branches — never bare `git commit`. This is ADR-005.
2. Never use `git reset` on a shared branch to undo a pushed commit — once it's on the remote, the commit is shared history. Escalate to TL/DevOps for recovery.
3. If you discover you've swept others' files into your commit but haven't pushed yet: `git reset --soft HEAD~1`, then re-commit with explicit pathspec.
4. If already pushed: do NOT rewrite history. Escalate — the correct fix depends on what other agents have already pulled/rebased on top of it.
5. **`git add <file> && git commit` is NOT scoped** — naming a file to `add` does not scope the `commit`; the bare `commit` still takes the whole shared index. The ONLY scoped form is `git commit -- <file>` (the pathspec on the *commit*, not the *add*).

**Status:** Active — **2 violations (EdgeBrowser 3bde76f2, Diagnostics 7895cbe6)** despite the ADR-005 pathspec rule in AGENTS.md. The rule exists; the recurring mistake is the `git add <file> && git commit` idiom that *feels* scoped but isn't (prevention #5). If a 3rd appears, this pairs cleanly with a mechanical hook — the `git-commit-pathspec-flag-order` guard could be extended to flag a bare `git commit` (no `-- <paths>`) on a shared branch.

**Applies To:** All agents committing to shared branches (main, shared feature branches).

---

## [Build] Commit-by-Pathspec Is File-Granular — In a Live Working Tree It Sweeps Foreign HUNKS Inside Your File (ADR-005 Insufficient)

**Pattern:** `git commit -- <file>` (the ADR-005 defense against sweeping others' work) protects at **file granularity** — it commits *that file's entire working-tree state*, including any **foreign uncommitted hunks** other writers left INSIDE the same file. In a live working tree (the `ai-triad-data` repo, continuously written by pipelines/sessions — often 10+ files dirty), the file you edit frequently already carries someone else's in-progress edit, so per-file staging is **not isolation**: your commit sweeps their hunk AND can split their multi-file change (committing their edit to file A while their file B stays uncommitted).

**Instances:**
- 2026-07-26 — Computational Linguist (ai-triad-data, commit 21781d25, disclosed t/1808, p/7#39): committed a one-line `sit-211` fix **by explicit pathspec** — correct per ADR-005 — but the target file also held **12 foreign lines from someone's `policy_id`→`pol-*` linking pass**, which rode into the commit. It also **split that foreign multi-file change** (their `policy_actions.json` edit stayed uncommitted). Root cause: pathspec is file-granular; the data repo is a live working tree (13 files dirty). Remediation options offered to the owner on t/1808.

**Root Cause:** ADR-005 "commit by explicit pathspec" prevents the *bare-commit* hazard (sweeping other agents' STAGED files from the shared index — see "Bare Git Commit Sweeps Shared Staging Index"), but its unit is the **file**, not the **hunk**. `git commit -- <file>` snapshots the whole working-tree file, so any unrelated modification sitting in that file — common in a repo that is a live write target (debate sessions, enrichment pipelines) rather than a code repo touched only by deliberate edits — is committed too. The rule's isolation guarantee silently degrades from "only my changes" to "only my *files*", which in a shared large-JSON file is no guarantee at all. Sibling of the "Active Writers Corrupt Git Operations in Data Repo" data-repo pattern.

**Prevention:**
1. **In `ai-triad-data` (or any live-written tree), `git diff <file>` BEFORE staging/committing** — and treat **any foreign hunk as a STOP**. Only commit if every hunk in the file is yours.
2. If foreign hunks are present, **stage by hunk** (`git add -p`) to commit only your lines, or wait/coordinate — never `git commit -- <file>` a file that carries someone else's in-progress edit.
3. **The shared-branch pathspec rule (ADR-005) is necessary but NOT sufficient for large shared JSON** — pathspec isolates files, not hunks. Say so explicitly when the target is a live-written data file.
4. If you discover you swept a foreign hunk, **disclose immediately** (ticket + owner) and offer remediation — a split multi-file change may need the owner to reconstruct it (as on t/1808).
5. **Upstream fix — serialize data-repo-writing batches and announce before starting** (TL/CL, p/8#106): the surest prevention is to not have concurrent writers to `../ai-triad-data` at all. Queue a data-repo-writing batch behind any in-flight one (CL deliberately queued the t/1676 LLM batch behind in-flight t/1670 debates after concurrent batches caused today's revert), and post a "starting a data-repo batch" note so others hold off. This removes the foreign-hunk collision at the source rather than catching it at commit time.

**Status:** Active — **defeats/qualifies ADR-005** (pathspec is file-granular, not hunk-granular) in the live data repo specifically. NOT a rule-not-applied (#82) case: the agent correctly applied the pathspec rule; the rule's granularity was insufficient for the context. Data-repo-specific; disclosed t/1808. Upstream coordination convention (serialize + announce data-repo batches) added from p/8#106.

**Applies To:** All agents committing to `ai-triad-data` or any working tree that is a live write target (pipeline/session output) — where a file you edit may carry other writers' uncommitted hunks.

---

## [Build] Bare `git restore <file>` During an origin/main Divergence Silently Reverts to Local HEAD

**Pattern:** During an active origin/main divergence, a file's working-tree content may legitimately hold the **origin-side** version (e.g. picked up mid-rebase/mid-land, or deliberately staged from `origin/main`). A bare `git restore <file>` reverts the working tree to the **local index/HEAD** version, silently discarding that origin-side content — a data-loss surprise, because `git restore` defaults its source to local state, not the ref the content actually came from.

**Instances:**
- 2026-07-17 — PowerShell (verifying t/1699, p/20#21): a plain `git restore quality-gates.json` reverted the working tree to local HEAD, wiping the origin-side content the file was holding during an active origin/main divergence. Recovered with `git restore --source=origin/main --worktree quality-gates.json` — explicitly naming the ref the content belonged to.

**Root Cause:** `git restore <file>` (and legacy `git checkout -- <file>`) restore from a **default source** — the index, falling back to HEAD — not from wherever the working-tree content originated. That default is silent: the command names no ref, so it looks like a neutral "undo my edits" when it is actually "throw away whatever is here and take local HEAD's copy." During a divergence the working-tree copy and local HEAD's copy differ by exactly the origin-side changes, so the restore destroys them. Same object-level-discipline family as Git Forensics (#44/#54/#55) and the landing-worktree friction pattern (#72, where `git diff HEAD..origin/main` false-flags your own files): during a divergence, never assume a file's working-tree content belongs to local HEAD.

**Prevention:**
1. **During an origin/main divergence, never bare-`git restore` (or `git checkout -- `) a file** without first checking which ref its working-tree content belongs to — `git diff <file>`, `git diff origin/main -- <file>`, or `git status` to see whether the content is local or origin-side.
2. **Restore from the explicit source:** `git restore --source=<ref> --worktree <file>` (e.g. `--source=origin/main`) — name the ref you actually want rather than relying on the silent index/HEAD default.
3. **If you've already clobbered it:** the origin-side content is still recoverable from the ref — `git restore --source=origin/main --worktree <file>` (or `git show origin/main:<file>`), since divergence means origin still has it. Recover before making further edits.

**Status:** Active

**Applies To:** All agents running `git restore` / `git checkout -- <file>` during any origin/main divergence or active land/rebase window.

---

## [Build] `git checkout -- .` / `git restore .` Reverts ALL Unstaged Tracked Edits — Untracked Survivors Mask the Loss

**Pattern:** To clean ONE verify-dirtied file, an agent runs the **whole-tree** form `git checkout -- .` (or `git restore .`). It reverts **every** unstaged tracked edit in the tree — not just the stray file — silently wiping other tracked changes the current work depends on. Newly-created files are **untracked**, so they survive the revert, which **masks** the loss: the surviving new files make the change look intact while its tracked-file half is gone. The truncated change then lands.

**Instances:**
- 2026-07-17 — DebateTool (t/1686, ADR-007 worktree land, p/70#9): to drop a verify-dirtied snapshot, ran `git checkout -- .`, which reverted ALL unstaged tracked edits — wiping the **barrel-conversion of the original file** and the **eslint-baseline edit** the split depended on. The new module files were untracked, so they survived and masked the loss; the commit landed with ONLY the new files. Caught via the commit's file-count/stat (expected 8, saw fewer). Resolved: `git reset --soft HEAD~1`, rebuilt the barrel + eslint edit, re-verified, recommitted (8 files).

**Root Cause:** The `.` pathspec on `git checkout --` / `git restore` means "the whole working tree," so the command's blast radius is every unstaged tracked modification, not the one file the agent meant to clean. The tracked/untracked asymmetry is what makes it dangerous *and* invisible: `checkout -- .` only touches **tracked** files, so brand-new (untracked) files are untouched and remain in the tree — a partial change where the visible half (new files) survives and the invisible half (edits to existing tracked files) is gone. Sibling of #74 (bare restore takes the wrong *ref*); here the error is the wrong *scope* (`.` = everything) compounded by untracked survivors hiding the damage. Same worktree-land footgun family as #72.

**Prevention:**
1. **Never `git checkout -- .` / `git restore .` (whole-tree) to clean one stray file** — target it by path: `git restore <path>` / `git checkout -- <path>`. Scope the blast radius to exactly the file you mean.
2. **Sanity-check the commit's file count/stat before pushing** — `git show --stat HEAD` and compare against the expected number of touched files. A split/refactor that touches N files but commits fewer is a lost-half signal (untracked survivors won't show as missing any other way).
3. **When a clean-up reverts more than expected, `git reset --soft HEAD~1` and rebuild** the missing tracked edits before re-verifying — don't push the truncated change.

**Status:** Active — sibling of #74; 4th worktree-land/divergence git footgun in the cluster (#72, #74, this, + the #73 facet-B signature). See the consolidated Quick-Reference entry in INDEX.md.

**Applies To:** All agents cleaning a dirtied working tree during a worktree land or any multi-file change — especially splits/refactors that mix edits to tracked files with new untracked files.

---

## [Build] `git commit -- <explicit list>` Silently Omits a Glob-Staged File — Broken Tree Pushed to Origin

**Pattern:** Files are staged with `git add <glob>` (or `git add <dir>`), then committed with `git commit -- <explicit file list>` per the ADR-005 pathspec rule. The explicit list is a **subset** of what the glob staged, so a staged file is silently left **staged-but-uncommitted** — the commit succeeds with no warning. The omitted file (e.g. a module the committed code imports) never reaches origin, so the pushed tree is broken even though local verify was green (verify reads the working tree, where the file exists).

**Instances:**
- 2026-07-17 — ElectronMain (worktree landing, p/98#6/#7): `git add <glob>` staged a set of files; `git commit -- <explicit list>` dropped one of them, leaving it staged-uncommitted. Pushed a broken tree to origin — the registrar imported a module that was never committed. Local verify passed (working tree had the file); CI/committed state did not. Detection after the fact: `git ls-tree origin/main <dir>` file-count vs expected.

**Root Cause:** The ADR-005 "commit by explicit pathspec" rule (which correctly prevents sweeping other agents' staged files) has a failure mode when the explicit list is hand-maintained: it can drift out of sync with what was actually staged by a glob/dir `add`. `git commit -- <paths>` commits **exactly** those paths and silently ignores other staged changes — no error, no "you have staged files not in this commit" warning. Combined with the committed-vs-working-tree trap (verify reads the working tree, not the index/HEAD), the gap is invisible until CI or another agent hits the missing file on origin. Same family as "Uncommitted Fixes Mask Committed Breakage" and the worktree-land footgun cluster (#72/#74/#75) — the commit contains fewer files than intended and the file-count is the reliable tell.

**Prevention:**
1. **Reconcile the commit pathspec against what's staged.** Before pushing, run `git status` / `git diff --cached --name-only` and confirm NOTHING you intended is left staged-uncommitted. A non-empty "Changes staged but not committed" after your commit is the signal.
2. **Verify the commit's file set at the object level, before AND after push** — `git show --stat HEAD` (does the commit contain every file the change needs?) and `git ls-tree origin/main <dir>` file-count after push (does origin have them all?). A commit/tree with fewer files than expected is a dropped-file signal (same file-count defense as #75).
3. **When you staged with a glob but must commit by explicit pathspec (ADR-005), derive the list from the staged set** — e.g. commit the reconciled `git diff --cached --name-only` output — rather than hand-typing a list that can omit a file. Keep ADR-005's protection (don't sweep others' files) without dropping your own.

**Status:** Active — 5th hazard in the worktree-land cluster (#72/#74/#75/#76 + #73 facet-B). **Two-track defense landed 2026-07-17:** (1) mechanical — Diagnostics shipped the `staged-files-after-commit` PostToolUse/Bash hook (`operations/diagnostics/check-staged-after-commit.cjs`): after any Bash `git commit` it runs `git diff --cached --name-only` and injects a warning listing anything left staged-uncommitted; silent on non-commit / non-git-repo calls (p/9#33). Inert until the next Orca sync per the manifest-lag trap (#68) — verify live via manifest presence, not audit counters. **⚠ Windows path-crash FIXED (p/9#41):** the audit found this hook among the two using `{workspace_root}`; Diagnostics **re-inlined it via `node -e`** (no external path → no empty-`{workspace_root}` crash) and matched the overlay form. Residual caveat: the runner still silent-suppresses a non-zero exit (Orca Support's fix), so confirm the guard emits guidance rather than assuming installed = guarding (see "Feedback Hook Silently Dead on Windows" in process.md). (2) behavioral — TL folded #76 into the worktree-land cluster of the AGENTS.md/`/land-from-worktree` batch (p/8#86), owner-gated.

**Applies To:** All agents committing by explicit pathspec after a glob/dir `git add` — especially multi-file worktree lands where a dropped file breaks origin.

---

## [Build] Copying a Whole File From the Shared Tree Into a Worktree Sweeps In Its Uncommitted WIP

**Pattern:** In the `/land-from-worktree` flow you "copy your changed files into the worktree" (step 3). If you `cp` the **whole file from the shared working tree**, you also copy any **pre-existing uncommitted WIP** on that file — other agents' edits, an accidental BOM, an unrelated config bump — which then rides into your commit. The commit silently carries changes you didn't make. `git diff --stat` shows a line-count larger than your edit (the gap is a tell), but `--stat` alone hides **what** the extra lines are, so the sweep-in can pass a quick glance. **Variant (same root, different payload):** if the copied file is *stale* — behind origin — you don't sweep in WIP, you **clobber peers' newer committed additions** to that file and reintroduce an out-of-date baseline.

**Instances:**
- 2026-07-26 — PowerShell (t/1726, caught in TL review, p/20#25): `cp`-ing a whole file from the shared tree into the landing worktree swept in an **accidental BOM** and an **unrelated gemini model-default bump** that were sitting uncommitted on that file. `git diff --stat` showed **24 lines vs the ~6 guard lines** the change actually needed — the gap flagged it, but `--stat` didn't reveal the BOM/model-bump; only the content diff did. Same family as the branch-off-origin / dirty-tree-false-witness cluster.
- 2026-07-28 — PowerShell 2 (t/1899, resolved 21fc09fd, p/228#5): the **stale** facet — copied a whole test file whose working copy was **118 commits behind origin** instead of re-applying the targeted edit onto a fresh base. No WIP was swept, but the stale copy risked clobbering peers' newer committed additions to that file. Same fix as the WIP case: re-apply targeted edits onto an origin-clean file; never copy a whole file, WIP-dirty **or** stale. (This set up but did not itself cause the CI-red — the red came from a repo-wide lint; see "A New Test Can Trip a Cross-File / Repo-Wide Lint.")

**Root Cause:** The shared working tree is every agent's live scratch space — a file there is whatever anyone last wrote, committed or not (the "dirty tree as false witness" premise). Copying that file wholesale imports its entire current content, not just your intended edit, so uncommitted WIP hitchhikes into your commit. `git diff --stat` summarizes magnitude (line counts) but not content, so it confirms "more changed than I expected" without showing the smuggled BOM/config change — you have to read the actual diff against a clean baseline to see it. Companion to #76 (there a commit had *fewer* files than intended; here a file has *more* content than intended — both caught by comparing count-vs-expectation, both needing an object-level content check to confirm).

**Prevention:**
1. **Don't `cp` whole files from the shared tree into a worktree — re-apply your edits onto origin-clean files.** In the worktree (branched off fresh `origin/main`), the file is already clean; make your change there rather than importing the shared-tree copy with its WIP.
2. **If you must copy, read the CONTENT diff vs origin before committing — not just `--stat`.** `git diff origin/main -- <file>` (or `git diff --cached` after staging) and confirm every hunk is yours. A line-count larger than your edit is the tell; the content diff is what identifies the smuggled change.
3. **Line-count vs expectation is a cheap tripwire** — if `git diff --stat` shows materially more lines than your edit touched, STOP and read the full diff before committing. (Pairs with #76's file-count check — same "count vs expectation" discipline, applied to line content.)

**Status:** Active — 7th hazard in the worktree-land cluster; a `/land-from-worktree` step-3 refinement ("copy changed files" → "re-apply edits onto origin-clean files, or content-diff vs origin before commit"). Handed to TL for the owner-gated batch.

**Applies To:** All agents landing edits to *existing* files via a worktree — especially copying from a shared tree that may carry other agents' uncommitted WIP.

---

## [Build] `/land-from-worktree` Sync-Back Leaves Files Staged in the Shared Index — Manufactures ADR-005 Sweep-Bait

**Pattern:** During the `/land-from-worktree` sync-back, using `git checkout origin/main -- <files>` to refresh the shared tree **leaves those files STAGED in the shared index**, so any other agent's later bare `git commit` sweeps them into an unrelated commit (ADR-005). It manufactures sweep-bait *even for a correctly-landed file*. **Not a procedure gap — a procedure-not-followed case:** the skill's **step 7 already mandates the safe form** `git restore --source=origin/main --worktree -- <files>` (working-tree only, no staging) and **explicitly warns "do NOT use `git checkout origin/main -- <files>` — it stages them."** The hazard materializes only when an agent deviates to the forbidden `checkout` form.

**Instances:**
- 2026-07-26 — ServerAPI (`/land-from-worktree`, p/79#10/#11): used `git checkout origin/main -- <files>` for sync-back — **the exact anti-pattern step 7 warns against** (TL, p/8#93) — which left the files staged in the shared index; another agent's bare `git commit` then swept them into an unrelated commit (co-cause: the ADR-005 bare-commit violation, Diagnostics' 039f9501 commit). **Impact harmless this time** — the swept blob was identical to what was already on origin/main.

**Root Cause:** `git checkout <ref> -- <paths>` writes the files to **both the index and the working tree**, whereas the step-7-mandated `git restore --source=<ref> --worktree -- <paths>` touches the working tree ONLY. On the shared tree the checkout form leaves files staged with no owning commit — exactly the "pre-staged files" a bare `git commit` sweeps (see "Bare Git Commit Sweeps Shared Staging Index"); it's the *supply side* of the bare-commit-sweep hazard. The rule to avoid this already existed in the skill; the failure was **not following it** — the same rule-exists-but-not-applied class seen elsewhere this session (config-forensics, strict-mode property access). 8th hazard in the worktree-land cluster.

**Prevention:**
1. **Primary (already in the skill, step 7):** for sync-back use `git restore --source=origin/main --worktree -- <files>` — working-tree only, no staging. **Never `git checkout origin/main -- <files>`** (it stages, creating sweep-bait) — step 7 explicitly forbids it.
2. **Recovery (if you used `checkout` anyway):** run `git restore --staged -- <files>` to unstage — the shared tree only needs them in the working tree (already committed on origin/main), never in the index. (TL adding this as a recovery line + reinforcing #1, p/8#93.)
3. **General rule:** any `git checkout <ref> -- <paths>` / non-`--worktree` restore on the shared tree leaves staged bait; follow with `git restore --staged` unless those files are meant for the next commit.

**Status:** Active — 8th worktree-land cluster hazard; the *supply side* of the bare-commit-sweep pattern (consumption side now 2 instances). **Procedure-not-followed, not a gap** (step 7 already mandates the safe form + forbids the checkout form). TL is adding a recovery line and reinforcing the primary rule in the owner-gated `/land-from-worktree` batch (p/8#93).

**Applies To:** All agents running the worktree landing procedure's sync-back — follow step 7's `git restore --worktree` form; never the `git checkout ... -- <files>` form.

---

## [Build] Deploy Preflight Fails on CI Matrix Job Name Mismatch

**Pattern:** Deploy workflow preflight checks that match CI job names with exact string equality (`select(.name == "test-electron")`) fail when CI uses matrix strategy, which appends the matrix value to the job name (e.g., `test-electron (taxonomy-editor)`).

**Instances:**
- 2026-06-25 — DebateWorkspace: Azure deploy (run 28192219897) failed at preflight because the jq filter `select(.name == "test-electron")` didn't match the actual matrix job name `test-electron (taxonomy-editor)`. Fix: update `.github/workflows/deploy-azure.yml` to use prefix matching (`startswith("test-electron")`) or check the overall workflow conclusion instead (p/124#2).

**Root Cause:** GitHub Actions matrix jobs are named `{job-name} ({matrix-value})`, not just `{job-name}`. Preflight scripts that do exact string matching on job names silently find no match, treating it as "job not found" rather than "job succeeded." This is fragile — adding or renaming matrix dimensions breaks deploy without any CI change.

**Prevention:**
1. Use prefix matching for CI job name checks: `select(.name | startswith("test-electron"))` instead of exact equality.
2. Alternatively, check the overall workflow conclusion (`conclusion == "success"`) rather than individual job names — more resilient to CI restructuring.
3. When adding matrix dimensions to CI jobs, grep deploy workflows for exact job name references: `grep -r "test-electron" .github/workflows/`.
4. Test deploy preflight after any CI workflow restructuring (adding/removing matrix dimensions, renaming jobs).

**Status:** Active

**Applies To:** All agents modifying CI workflows or deploy preflight checks.

---

## [Build] Git `--` Separator Before Flags Turns Flags Into Pathspecs

**Pattern:** Placing `--` (end-of-options separator) before flags like `-m` causes git to interpret those flags as filenames, failing with "pathspec did not match."

**Instances:**
- 2026-06-25 — Shared Lib: `ogit commit -- lib/AGENTS.md -m "message"` failed — git treated `-m` and the message as pathspecs. Fixed by reordering: `-m "message" -- lib/AGENTS.md` (p/5#11).
- 2026-06-26 — DebateTool: `git commit -- lib/debate/prompts.ts -m "..."` — same issue on the main repo. Fixed by staging with `git add` first, then `git commit -m "..."` without `--` (p/70#3).
- 2026-06-26 — Azure: `git commit -- .github/workflows/container.yml -m "message"` — same pattern on a CI workflow file. Fixed by reordering flags before `--` (p/105#3).
- 2026-07-26 — Docker (p/217#1): overlay commit failed "pathspec '-m' did not match" — `-- <path>` placed before `-m "msg"`. Non-interactive Bash tool, **`ogit` expanded form** (`git --git-dir=.orca-git --work-tree=. commit …`). Fixed by reordering to `-m "msg" -- <path>`. **Recurred despite the `git-commit-pathspec-flag-order` hook being "live workspace-wide"** — likely a hook-coverage gap: the guard probably matches `git commit …` but not the overlay-prefixed `git --git-dir=… commit …` form, so overlay commits slip past it. Flagged to Diagnostics to extend the matcher.
- 2026-07-26 — ServerAPI (t/1788, landed 95348dc8, p/79#13): main-repo `git commit -- <paths> -m "msg"` — `-m` after `--` parsed as pathspec. Fixed by reordering to `-m "msg" -- <paths>`. Self-resolved. Recurred even after the hook fix — consistent with the hook being **warn-only** (git rejects the command regardless; the agent self-corrects) plus the manifest-lag (#68) / exit-1-suppress (#80) residuals. Same incident also hit the untracked-new-file trap (see "Git Commit-by-Pathspec Skips Untracked").
- 2026-07-28 — CL.Investigate1 (t/1767, landed aa319dd2, p/40#11): `git commit -- <paths> -m "msg"` again — flags after `--`; fixed by moving `-m` before `--` (files already staged → committed the staged set). 6th instance / 6 agents. Still self-correcting — git rejects immediately, no cost beyond a retry; git's own rejection is the effective enforcement, the warn-only hook can't prevent it.
- 2026-07-28 — Taxonomy Editor (p/6#22): same `git commit -- <paths> -m "msg"` flag-order failure; resolved with `git commit -F msgfile -- <paths>` (flags before `--`). **7th instance / 7 agents.** At this recurrence the useful lever isn't blocking (git already rejects it harmlessly) but **corrective GUIDANCE at the moment of failure** — git's error (`pathspec '-m' did not match`) is cryptic; the `git-commit-pathspec-flag-order` hook should emit the corrective form (`git commit -m "msg" -- <paths>`). The flag-order violation IS a crisp syntactic signal (a `git commit` with `-m`/`-F` after `--`) — it passes TL's #82 hookability criterion — but the hook can't deliver that guidance while it's exit-1-noisy on every call (#80 Part 3). So the real fix for this recurrence rides on the #80 Part-3 fix (guard exits 0 on clean, emits targeted guidance on violation).
- 2026-07-28 — Taxonomy Editor 2 (p/195#7): `git commit -q -- <pathspec> -m "msg"` — same flag-order failure. **8th instance / 8 agents.** Fix already queued (Diagnostics accepted p/9#47 — corrective-guidance emit folds into the #80 Part-3 fix); no further per-instance action, the count just reinforces the guidance fix is warranted.
- 2026-07-28 — ServerAPI (t/1883, landed d9c3207e, p/79#17): `git commit -q -- <files> -m "msg"` — same `-m`-after-`--` failure ("pathspec '-m' did not match"). Reordered to `-m "msg" -- <files>`. **9th instance / 8 agents — ServerAPI's 2nd (first REPEAT offender on this pattern; earlier t/1788).** Self-corrected on git's rejection, as designed. No new action: recurrence continuing under the warn-only hook — including a repeat by an agent who already hit it — is exactly the evidence that the queued corrective-guidance emit (#80 Part-3) is the warranted improvement, since prevention isn't the lever (git already rejects harmlessly) but faster recognition of the cryptic error is.
- 2026-07-29 — DebateUI (t/1915, p/83#4): `git commit -- <paths> -m "msg"` — flags after `--`; reordered to `-m "msg" -- <paths>`. **10th instance / 9 agents** (DebateUI joins the flag-order roster; self-corrected on git's rejection). No new per-instance action — corrective-guidance emit still rides on the #80 Part-3 fix.

**Root Cause:** `--` signals end-of-options to git. Everything after `--` is treated as a literal filename/pathspec — including `-m`, `-F`, and any other flag. This is standard POSIX behavior but surprises agents who think of `--` as "here come the paths" without realizing it also disables all subsequent flag parsing.

**Prevention:**
1. **All flags must come BEFORE `--`:** `git commit -m "msg" -- <paths>`, never `git commit -- <paths> -m "msg"`.
2. Alternative: stage files first with `git add <paths>`, then `git commit -m "msg"` (no `--` needed if the index is already correct).
3. Same rule applies to all git commands: `git diff`, `git log`, `git checkout` — `--` always terminates option parsing.

**Status:** Resolved for main-repo commits (AGENTS.md rule overlay 95e9c3b, p/8#30 + `git-commit-pathspec-flag-order` PreToolUse hook live workspace-wide, p/9#16) — **but recurred 2026-07-26 on an overlay `ogit` commit (Docker, p/217#1), a suspected hook-coverage gap:** the guard likely matches `git commit …` but not the overlay-prefixed `git --git-dir=.orca-git --work-tree=. commit …` form. 4 instances / 4 agents. Diagnostics extended the matcher to the overlay form (`/\bgit\b.*\bcommit\b/`, commit 039f9501, p/9#39) and, in the p/9#41 audit, **re-inlined the hook via `node -e`** so it no longer depends on `{workspace_root}` (Windows path-crash resolved — see "Feedback Hook Silently Dead on Windows" in process.md). Caveat: the runner still treats a non-zero exit as silent-suppress (Orca Support's platform fix), so verify the guard actually emits guidance, not just that it's installed. **10 instances / 9 agents** (+DebateUI t/1915, +ServerAPI ×2 [first repeat offender, t/1788 then t/1883], +CL.Investigate1, +Taxonomy Editor, +Taxonomy Editor 2 p/195#7) — the hook is **warn-only**: it can't prevent the mistake (git rejects the command regardless), so recurrences self-correct on git's own error rather than being blocked. Zero-cost/self-correcting, so NOT a #82 escalation — git IS the point-of-use enforcement. **But at 7×, the improvement worth making is corrective GUIDANCE:** the violation is a crisp syntactic signal, so the flag-order hook should emit the correct form (`-m "msg" -- <paths>`) on a violation. **Diagnostics ACCEPTED this (p/9#47)** — folding into the #80 Part-3 fix: on a real flag-order violation, emit "flags before --: git commit -m 'msg' -- <paths>" alongside the exit. Turns git's cryptic pathspec error into a one-line fix; rides on the Part-3 work. The hook's value is the *guidance*, not prevention; the durable fix remains the rule + habit.

**Applies To:** All agents using git commit with pathspec on any repo — including the overlay expanded form, which the hook may not yet cover.

---

## [Build] Vitest Dynamic Import Misses Exports From vi.mock Factory

**Pattern:** Using `await import()` on a module that has a `vi.mock` registration only sees exports defined in the mock factory — not the real module's exports. Missing exports throw "No X export on mock" at runtime, not at compile time.

**Instances:**
- 2026-07-01 — DebateWorkspace: vitest errored with "No markAsPopout export on mock" when using `await import()` against a `vi.mock`'d `helpers.ts`. The mock factory didn't include `markAsPopout`. Fixed by adding the missing export to the `vi.mock` factory and using the mock reference directly instead of dynamic import (p/124#3).

**Root Cause:** `vi.mock` hoists to the top of the test file and intercepts all imports of the target module — including dynamic `import()`. If the mock factory doesn't export a symbol that exists on the real module, `import()` returns the mock (missing the symbol), not the real module. This fails at runtime with an unhelpful error, not at the `vi.mock` declaration.

**Prevention:**
1. Before using `await import()` on a mocked module, check that the `vi.mock` factory exports all symbols the importing code needs — not just the ones the test explicitly stubs.
2. Prefer using the mock reference directly (from `vi.mocked()` or the mock variable) rather than dynamic `import()` on mocked modules.
3. When adding new exports to a module, grep for `vi.mock` registrations on that module and update them: `grep -r "vi.mock.*helpers" --include='*.test.ts'`.

**Status:** Active

**Applies To:** All agents writing or modifying vitest tests that use `vi.mock` with dynamic imports.

---

## [Build] Vitest Mock Harness — Re-Exporting a Mocked Module Through the Harness Resolves to `undefined`

**Pattern:** When splitting a vitest file that shares a mock harness, re-exporting a mock-dependent module (e.g. the zustand store) **through** the harness — so split files do `import { useStore } from './storeTestHarness'` — resolves to `undefined` in the importing test file. `vi.mock`'s hoisting applies only to the module graph the harness itself imports; the cross-file re-export binding breaks, so the store the split file receives is undefined (tests fail with "cannot read property of undefined," not a mock error).

**Instances:**
- 2026-07-17 — Taxonomy Editor (t/1690, ADR-007 Phase-2 test split): splitting a `useDebateStore` vitest file with a shared mock harness. Re-exporting the store through the harness gave `undefined` in the split test files. Fix: each split file imports the **harness FIRST** (for its hoisted `vi.mock` side-effects) then imports the store **DIRECTLY from its own module** — never through the harness. Verified with a one-block throwaway experiment before committing the full split (p/6#21).

**Root Cause:** `vi.mock` is hoisted and scoped to the file/module graph where it is declared. A shared harness that declares the mocks and then re-exports a mock-dependent module does NOT extend the mock's interception across a re-export boundary into a *sibling* test file cleanly — the re-exported binding resolves before/around the hoisted mock and comes back `undefined`. The harness's value is its **side-effect** (registering the mocks), not its role as a re-export hub. Same genus as the sibling pattern above (vi.mock hoisting has non-obvious module-resolution effects), different failure mode: static re-export vs dynamic `import()`.

**Prevention:**
1. **A mock harness is imported for side-effects, not for re-exports.** In each split file: `import './storeTestHarness'` (or a named setup) FIRST to register the hoisted `vi.mock`s, THEN `import { useStore } from '<store's own module>'` directly.
2. **Never route a mock-dependent module through the harness as a re-export** — the store/module must be imported from its own path in every file that uses it.
3. **Prove the split with a one-block throwaway experiment before committing** — a single test importing the harness + store directly confirms the store resolves non-`undefined` before you fan the split out across many files (the object-level verify-before-commit discipline).

**Status:** Active

**Applies To:** All agents splitting or authoring vitest files that share a mock harness — especially the ADR-007 Phase-2 test-file splits (large `*.test.ts` broken into `__tests__/` modules around a shared harness).

---

## [Build] `rg` Is a Shell Function, Not a Binary — Unavailable in Subshells

**Pattern:** `rg` (ripgrep) in the Claude Code Bash tool is a shell function wrapping claude.exe's bundled ripgrep, not an executable on PATH. Scripts run as subprocesses (`bash script.sh`) cannot access it — only the top-level shell sees the function.

**Instances:**
- 2026-07-01 — Technical Lead: `command -v rg; where.exe rg` exited 1 during transcript friction analysis — no `rg` binary on PATH. Scripts run via `bash script.sh` got "rg: command not found". Fixed by sourcing the script in the top shell instead of running it as a subprocess (p/8#31).

**Root Cause:** Claude Code exposes `rg` as a shell function (not a standalone binary) in the interactive Bash tool shell. Shell functions are not inherited by child processes — `bash script.sh` starts a new shell that doesn't have the function defined. `command -v rg` and `which rg` both fail because there's no binary to find.

**Prevention:**
1. **Use the Grep tool** instead of `rg` in scripts — the Grep tool is the native search interface and always available.
2. If `rg` is needed in a script, source it (`. script.sh` or `source script.sh`) instead of running it as a subprocess (`bash script.sh`).
3. Do not assume CLI tools available in the top-level Bash tool shell are binaries — some (like `rg`) are shell functions that vanish in subshells.
4. For portable scripts, use `grep -r` as a fallback when `rg` is unavailable: `command -v rg >/dev/null && rg ... || grep -r ...`.

**Status:** Active

**Applies To:** All agents writing Bash scripts that use `rg` or other Claude Code shell functions.

---

## [Build] Ad-Hoc `tsc` Produces Phantom Errors vs Real Build Gate

**Pattern:** Running bare `tsc` or `tsc -p tsconfig.*.json` outside the project's actual build gate produces misleading errors — missing `@types/node` (no `node_modules`), TS5101 baseUrl deprecation, TS2882 CSS shims — that the real build (`npm run build`) never hits.

**Instances:**
- 2026-07-04 — ElectronMain (workflow-app, t/1333): `tsc -p tsconfig.main.json` errored TS2688 "Cannot find type definition file for 'node'" because deps were never installed (`@types/node` comes transitively via electron). Bare `tsc` on renderer errored TS5101 (baseUrl deprecation) and TS2882 (App.css shim) — both are non-issues because renderer is type-checked via `vite build`, not bare `tsc`. Fixed by `npm install` + verifying via `npm run build` (the actual gate). Note: workflow-app has no verify/test gate of its own (p/98#3).

**Root Cause:** Electron apps have split type-checking: main process via `tsc -p tsconfig.main.json`, renderer via `vite build` (which uses esbuild with its own resolution). Running ad-hoc `tsc` commands that don't match the real pipeline produces false positives (renderer CSS/baseUrl errors) or catches missing-deps issues that are environment problems, not code problems. Agents waste time debugging phantom errors.

**Prevention:**
1. Always use the project's actual build gate (`npm run build`, `npm run verify`) — not ad-hoc `tsc` commands.
2. If a project has no verify gate, use `npm run build` as the minimum check.
3. Run `npm install` before any type-checking in a project where `node_modules` doesn't exist yet.
4. Know which tsconfig covers which code: `tsconfig.main.json` = main process only; renderer = `vite build`. Bare `tsc` on renderer code is not the real gate.

**Status:** Active

**Applies To:** All agents working in Electron apps (taxonomy-editor, workflow-app, poviewer, summary-viewer).

---

## [Build] Registry Credential on Public Image Turns Credential Rot into Outage

**Pattern:** A stored GHCR PAT expired, but ACA authenticates EVERY pull when a registry credential is configured — so the dead PAT broke pulls of a PUBLIC image that anonymous pulls would have served fine. Total production outage, undetected for 11+ hours.

**Instances:**
- 2026-07-05 — **PROD OUTAGE**: stored GHCR PAT expired → ACA authenticated every pull → ImagePullBackOff on the 100%-traffic revision → total outage. No alerting: ACA marked revision "Degraded" and nothing watched it. Undetected 11+ hours. Restored by routing traffic to a still-cached healthy revision, permanently fixed by removing the credential. Hardening: t/1335 (Bicep re-adds dead cred — deploy-blocking), t/1336 (Degraded-revision alert + external uptime probe), t/1337 (verify-then-promote traffic gate) (p/8#41).

**Root Cause:** Three compounding failures: (1) **Registry credentials on public images are pure downside** — they force authenticated pulls where anonymous would succeed, turning credential expiry into an outage instead of a no-op. (2) **No alerting on ACA revision health** — ACA marked the revision "Degraded" but nothing watched for that state or probed externally. (3) **Bicep re-adds the credential on deploy** — removing it via CLI is ephemeral; the next deploy from IaC restores the dead cred (same class as the ACA env var drift trap).

**Prevention:**
1. **Never configure registry credentials for public images** — authenticated pulls gain nothing and create a credential-rot time bomb.
2. Remove the credential from Bicep (t/1335), not just CLI — IaC drift will restore it otherwise.
3. Add a **Degraded-revision alert** and an **external uptime probe** (t/1336) — internal ACA health markers are insufficient if nothing watches them.
4. Implement a **verify-then-promote traffic gate** (t/1337) — new revisions should prove healthy before receiving traffic.
5. For any configured credential, set a rotation reminder or use a mechanism with auto-renewal (e.g., managed identity instead of PAT).

**Status:** Active — hardening tracked in t/1335, t/1336, t/1337.

**Applies To:** DevOps, Azure infrastructure, anyone touching container deployment or registry configuration.

---

## [Build] ACA Revision Snapshots Freeze Config at Creation + az CLI Swallows 409

**Pattern:** ACA bakes registry credentials (and other config) into each revision's snapshot at CREATION time. App-level config changes do NOT affect existing revisions — restarts still pull with the frozen credential. Only a NEW revision picks up config changes. Compounding: `az containerapp registry remove` exits 0 while ARM silently rejects with 409 ContainerAppRegistryInUse.

**Instances:**
- 2026-07-05 — During outage remediation (p/8#42): TL's "30-60 second maintenance window" estimate became ~75 minutes because the mental model ("config applies live") was wrong. `az containerapp registry remove` appeared to succeed (exit 0, no output) but ARM rejected with 409. Registry credential remained frozen in the revision snapshot. Only creating a new revision (revision copy) picked up the removal. Both facts now in t/1335 design constraints.

**Root Cause:** Two compounding ACA behaviors: (1) **Revision snapshots are immutable** — registry credentials, env vars, and other config are baked in at creation time and survive restarts. App-level changes only take effect when a new revision is created. (2) **az CLI swallows ARM 409 errors** — `az containerapp registry remove` returns exit code 0 and prints nothing when ARM responds with 409 ContainerAppRegistryInUse, giving a false impression of success.

**Prevention:**
1. After ANY registry or config change, **always read back** `properties.configuration.registries` (or the relevant config section) to verify the change actually took effect.
2. Understand that **existing revisions are immutable** — to apply config changes, you must create a new revision (revision copy or new deployment).
3. Never trust `az containerapp` exit codes alone for config mutations — read-after-write verification is mandatory.
4. Factor immutable revision snapshots into maintenance time estimates — "remove and restart" doesn't work; "remove, create new revision, route traffic" is the real sequence.

**Status:** Active — design constraints captured in t/1335.

**Applies To:** DevOps, Azure infrastructure, anyone performing ACA config changes during incidents.

---

## [Build] Multi-Agent Git — Worktree Landing Race Creates Duplicate Commits

**Pattern:** An agent's land flow commits X on the SHARED local main, then cherry-picks a copy X' inside a git worktree and pushes X'. The original X lingers unpushed on the shared ref and later sweeps to origin when another agent pushes — producing byte-identical duplicate commits on origin.

**Instances:**
- 2026-07-05 — Happened twice on t/1295 (commits 4 and 5) before root-cause was identified. Agent committed on shared local main, then cherry-picked into worktree and pushed. The original commits stayed on shared main and were pushed later by a different agent (p/8#45).

**Root Cause:** The landing flow treats local main as a scratch pad — commit there, then cherry-pick into an isolated worktree for push. But local main is SHARED across all agents on the same machine. The original commit persists on the shared ref after the cherry-pick, invisible to the agent who pushed via worktree. When any agent later pushes from local main, the orphaned commit travels to origin as a duplicate.

**Prevention (ratified fix, t/1295#15, p/8#46):**
1. Create worktree off **fresh `origin/main`** — never the shared local ref.
2. Copy only your changed files into the worktree, `add + commit + push` INSIDE it — one SHA, nothing lingers on the shared tree.
3. Sync the shared tree back with file-scoped `git checkout origin/main -- <files>` — **never a reset** that could drop other agents' commits.
4. Run verify gate inside the worktree per Definition of Done.
5. After push, verify local main has no orphaned duplicates: `git log origin/main..main`.

**Status:** Active — ratified fix in place (t/1295#15). Pairs with the shared-branch pathspec rule (Git Commit Rule in root AGENTS.md).

**Applies To:** All agents using git worktrees on shared local repos, especially multi-agent landing flows.

---

## [Build] Python 3.12 Rejects Mid-Pattern Inline Regex Flags

**Pattern:** Inline regex flags like `(?m)` placed mid-pattern (not at position 0) are a hard error in Python 3.12+ — `re.error: missing -, : or )`. Worked silently in earlier Python versions.

**Instances:**
- 2026-07-06 — Computational Linguist: inline Python regex used a mid-pattern `(?m)` flag, hard error in Python 3.12. Fixed by moving to `re.M` flag argument: `re.findall(pat, s, re.M)` (p/7#20).

**Root Cause:** Python 3.11 deprecated inline flags not at the start of the pattern; Python 3.12 made it a hard error. Agents writing inline Python snippets may use patterns from training data or older docs that place flags mid-pattern.

**Prevention:**
1. Always pass regex flags via the `flags=` argument: `re.findall(pat, s, re.M)` — never embed `(?m)` mid-pattern.
2. Inline flags (`(?m)`, `(?i)`, `(?s)`) are only valid at **position 0** of the pattern string in Python 3.12+.
3. When writing inline Python regex, prefer explicit flag arguments over inline flag syntax entirely.

**Status:** Active

**Applies To:** All agents writing inline Python regex (scripts, one-liners, data processing).

---

## [Build] Windows Junction Trap — Symlinked node_modules Blocks Worktree Cleanup

**Pattern:** `ln -s` on Windows Git Bash creates a directory JUNCTION (not a symlink). Junctions into a worktree's `node_modules` block `git worktree remove` and risk `rm -rf` following the junction into the real `node_modules`.

**Instances:**
- 2026-07-06 — ServerAPI: symlinked main tree's `node_modules` into a landing-worktree to run `npm run verify`. Windows created a junction; `git worktree remove` failed, and a naive `rm -rf` on the worktree would have destroyed the real `node_modules`. Resolved with `git worktree remove --force` + `git worktree prune`; confirmed real `node_modules` intact (906 entries). Recommendation: don't symlink `node_modules` — verify in main tree + `git diff`, or `npm ci` in worktree (p/79#5).

**Root Cause:** Git Bash `ln -s <dir>` on Windows creates an NTFS directory junction, not a POSIX symlink. Junctions are followed by `rm -rf` and `rmdir` — cleanup of the worktree risks destroying the junction target. `git worktree remove` also fails because it encounters the junction during cleanup.

**Prevention:**
1. **Never symlink `node_modules` into a landing-worktree on Windows** — the junction will block cleanup and risk the real deps.
2. To verify a worktree commit: run verify in the main tree and prove byte-identity via `git diff <worktree-sha> <main-sha>`.
3. If isolation is essential: `npm ci` inside the worktree (clean install, no junction needed).
4. If a junction is already in place: `git worktree remove --force` + `git worktree prune` cleans safely.

**Status:** Active

**Applies To:** All agents using git worktrees on Windows, especially landing flows that need `node_modules`.

---

## [Build] `npm ci` in a Fresh Worktree Can Leave an Empty Package Dir — False `tsc` TS2307

**Pattern:** `npm ci` in a fresh landing-worktree completes, but a package installs as an **empty directory** — the folder exists under `node_modules/` with no `dist/` (no built output). Type-checking then fails with a false `TS2307 Cannot find module` for that package, which reads as a real code error but is actually an incomplete install. The worktree's whole purpose (isolated, trustworthy verify) is defeated: the red is a dependency artifact, not the change.

**Instances:**
- 2026-07-17 — ElectronMain (worktree landing, p/98#6/#7): `npm ci` in a fresh worktree left `node_modules/@modelcontextprotocol/sdk` an empty dir (no `dist/`), causing a false renderer-`tsc` **TS2307**. Fixed by copying the package from a known-good `node_modules`. Cost a broken-origin window because the false red muddied the land.

**Root Cause:** `npm ci` is not guaranteed to yield a byte-complete `node_modules` in a fresh worktree — a package can land as an empty/partial dir (interrupted extraction, cache corruption, a package whose `dist/` is produced by a lifecycle/prepare step that didn't run, or a workspace/link quirk). The presence of the package *folder* makes it look installed, so `tsc`'s `TS2307` is misread as a missing import in the code rather than a missing build output in the dep. This complicates the `/land-from-worktree` "`npm ci` inside the worktree" step (see the Windows Junction pattern above): `npm ci` is necessary but not always sufficient — a fresh install can still be incomplete.

**Prevention:**
1. **When a worktree `tsc` reports TS2307 for a third-party package, suspect the install before the code** — check the package actually has its built output: `ls node_modules/<pkg>/dist` (or its `main`/`exports` target). An empty dir = incomplete install, not a code error.
2. **Repair the dep, don't chase the code:** copy the package from a known-good `node_modules`, or re-run `npm ci` (optionally `npm cache verify` / clean and reinstall). Do NOT edit imports to work around a TS2307 that's really a missing `dist/`.
3. **Prefer verifying in the main tree** (byte-identity via `git diff <worktree-sha> <main-sha>`) when worktree dep-install reliability is in doubt — a false red from an incomplete worktree install is a known red-herring class (pairs with #72's "verify against stale deps" and the Windows Junction pattern).

**Status:** Active — worktree-land environment hazard (companion to the git-footgun cluster #72/#74/#75/#76). Handed to TL for the `/land-from-worktree` proposal batch: the "`npm ci` in worktree" step needs a completeness check.

**Applies To:** All agents running `npm ci` in a fresh landing-worktree before verify — especially when `tsc` reports TS2307 for an installed package.

---

## [Build] `git worktree remove` vs In-Worktree node_modules — Refuses Without `--force`, Then TIMES OUT on the rm (Windows)

**Pattern:** Cleaning up a worktree that ran an in-worktree `npm ci` fails **two** ways on Windows: **(A) refusal** — plain `git worktree remove ../wt-X` exits 128 ("contains modified or untracked files") because the installed `node_modules`/`dist` are untracked; **(B) timeout** — adding `--force` makes it proceed, but `remove` then **synchronously `rm -rf`s the huge node_modules**, which is slow on Windows (AV/indexing scanning every file) and **times out** (2min). So the naive fixes chain into each other: remove → add `--force` → `--force` hangs on the delete.

**Instances:**
- 2026-07-17 — Shared Lib (`/land-from-worktree` step 8, p/5#13): plain `git worktree remove` exited 128 on untracked `node_modules`; resolved with `--force` (work already pushed, so no loss). (Facet A.)
- 2026-07-28 — DebateDiagnostics (p/245#1): `git worktree remove <wt>` **timed out at 2min** — it synchronously `rm -rf`s the worktree's large `node_modules` (slow on Windows/AV). Resolved by **detaching git metadata fast, then backgrounding the physical delete**: `git worktree prune` + `git branch -D <branch>`, then `rm -rf <wt-dir>` as a backgrounded task. (Facet B — supersedes the `--force` remedy for deps-installed worktrees.)
- 2026-07-29 — Chat (p/270#1): `git worktree remove` **timed out at 2min** on a **double-`npm ci`'d** worktree (root **and** `taxonomy-editor/` → *tens of thousands* of node_modules files — the Windows worst case). git had already marked the worktree **`prunable`**, so a **backgrounded `rm -rf` + `git worktree prune`** finished cleanup with **no `branch -D` needed**. 3rd instance — Facet B recurrence; the **double-`npm ci` is the amplifier** (two `node_modules` trees to delete). Confirms the prevention: never foreground-`remove` a deps-installed worktree.
- 2026-07-29 — Server Storage (t/1921 Batch B/C, p/206#5): `git worktree remove --force` failed **"`.git` does not exist"** — the OS/AV had **already deleted the physical worktree dir**, leaving only a stale administrative ref. Resolved with **`git worktree prune`**. (**Facet C** — the delete already happened out-of-band; `prune` is the whole fix, `remove` is the wrong verb.)

**Root Cause:** `git worktree remove` (A) is conservative — it aborts on untracked files, and an in-worktree `npm ci` (required by `/land-from-worktree` step 2) always leaves a large untracked `node_modules`. Adding `--force` clears the refusal but (B) `remove` does the `node_modules` deletion **synchronously in the foreground**, and deleting tens of thousands of small files is pathologically slow on Windows (each unlink hits AV/indexing), so it blows the 2-minute tool timeout. (C) Once the physical dir is **already gone** (OS/AV deleted it), `remove` fails "`.git` does not exist" — only the stale ref remains, which `prune` clears. The through-line: `remove` couples git-metadata detach (instant) with the physical delete (slow, or possibly already done); decouple them — `prune` owns the ref, a backgrounded `rm -rf` owns the files. Companion to #77 (same in-worktree `npm ci`) and the Windows Junction pattern.

**Prevention:**
1. **For a deps-installed worktree, don't `git worktree remove` at all — detach fast, delete in the background** (DebateDiagnostics, p/245#1): `git worktree prune` + `git branch -D <branch>` (instant, frees the git metadata + branch), then `rm -rf <wt-dir>` as a **backgrounded** task. This avoids BOTH the refusal (A) and the foreground-rm timeout (B). **If git already reports the worktree `prunable`** (its branch is gone/detached — check `git worktree list`), a backgrounded `rm -rf <wt-dir>` + `git worktree prune` alone suffices; skip `branch -D` (Chat, p/270#1). Note a `/land-from-worktree` that builds **both** root and `taxonomy-editor/` leaves **two** `node_modules` trees — double the delete, so foreground `remove` is doubly certain to time out.
2. **`git worktree remove --force` is the fallback only for small/no-deps worktrees** — where the synchronous rm is fast. With a full `node_modules` on Windows it will time out; use #1 instead.
3. **`--force`/rm is only safe after your commit is pushed** — confirm the worktree's work is on `origin/main` before removing; the sole casualty is `node_modules`. Never remove with uncommitted deliverable work in the worktree.
4. `git worktree prune` also clears stale administrative refs (same follow-up as the Junction pattern).

**Status:** Active — worktree-land cluster; the `/land-from-worktree` step-8 guidance updated from "`remove --force`" to "**prune + `branch -D` + background rm**" for deps-installed worktrees (supersedes the earlier `--force` wording; both refusal and timeout now covered). Handed to TL for the owner-gated batch.

**Applies To:** All agents cleaning up a worktree that ran an in-worktree `npm ci` on Windows — i.e. every deps-installing land.

---

## [Build] Foreground `git push` of a Large Data-Repo File Set Exceeds the 120s Bash Timeout — Background It, Then Verify the Ref on origin

**Pattern:** A plain foreground `git push` of many/large files (e.g. 70 debate JSONL + flight-recorder dumps to `ai-triad-data` over SSH) routinely takes longer than the **Bash tool's 120s default timeout** and gets **killed mid-upload (exit 143 / SIGTERM)**. The local **commit has already landed**, but the **push has not completed** — so the SHA is on local `HEAD` but NOT on origin. Any dependent action taken on the assumption "push succeeded" (a prune, a downstream job, telling a peer the data is available) then operates on a ref that was never published.

**Instances:**
- 2026-07-28 — Technical Lead (p/8#113): foreground `git push` of **70 large data-repo files** (debate JSONL / flight-recorders) to `ai-triad-data` over SSH was **killed at 2 min (exit 143)** mid-upload — the commit had landed but the push hadn't. Resolved by **re-running via `run_in_background`** (push is idempotent — a partial upload corrupts nothing; the retry completed **exit 0**) and **verifying the ref on origin (`git ls-remote`) before any dependent prune/action**. No data lost, and not a broken remote — a timeout-kill ≠ a broken push (ties to the "data-repo push works, HTTP-408 era ended" correction).

**Root Cause:** The Bash tool's default 120s timeout is shorter than a large multi-file SSH push. SIGTERM at the boundary kills the client mid-transfer, but `git commit` already completed locally — so the failure leaves a **split state**: local commit present, origin ref absent. Because the kill looks like a hard error, it's easy to either (a) misdiagnose the remote as broken, or (b) assume nothing landed and redo the work — when in fact the commit is fine and only the push needs re-running. Same **"foreground long git/fs op exceeds 120s → gets killed → background it"** genus as #78 (worktree-remove rm timeout on Windows); this is the push-side sibling.

**Prevention:**
1. **Push large data-repo file sets in the background** (`run_in_background`) or with an extended Bash `timeout` — never a plain foreground push. `git push` is idempotent, so a backgrounded retry after a killed foreground attempt is safe.
2. **Verify the ref is actually on origin before any dependent action** — `git ls-remote origin <branch>` and confirm the pushed SHA is published BEFORE a prune, a downstream job, or announcing availability. "The push command returned (or was killed)" is bookkeeping; the ref on origin is the artifact (**bookkeeping ≠ artifact** genus).
3. **A killed push (exit 143) is NOT a broken remote** — check `git ls-remote` first; don't file "data-repo push broken." The SSH data-repo push works, it's just slow for large sets.

**Status:** Active — push-side sibling of #78 in the **"foreground long git/fs op > 120s Bash default → background it"** genus, combined with a bookkeeping≠artifact verify step (the killed push left a commit-landed / ref-absent split state).

**Applies To:** All agents pushing large or many-file changes — especially data-repo (`ai-triad-data`) debate JSONL / flight-recorder / embeddings batches over SSH.

---

## [Build] Uncommitted Fixes Mask Committed Breakage — Dirty Working Tree as False Witness

**Pattern:** A multi-step refactor deletes a module and fixes its importers, but only the deletion is committed — the importer fixes remain uncommitted in the shared working tree. Local verify passes (reads dirty tree), committed state is broken. Compounding: diagnosing "is main green?" by building the dirty shared tree produces a false-green that overrules a clean-worktree agent who was correct.

**Instances:**
- 2026-07-06 — Technical Lead (t/1303 Phase C): deleted a module and fixed 2 importers but left the importer fixes uncommitted. Local verify green, committed state red for hours. TL then "verified main is green" using the dirty shared tree, contradicting a clean-worktree agent who was correctly seeing the breakage. Diagnostic standard established in t/1303#7 (p/8#49).
- 2026-07-12 — Computational Linguist (t/1553): an uncommitted enrichment UsageID appeared in the shared working tree; another agent read its presence as "CL authored and approved this" and nearly built Stage 1 on it. CL never authored it and activity telemetry had no event for the edit — authorship unestablishable. Resolved by reviewing on merits + delivering the real prompt (t/1553#5). **Variant:** working-tree presence read as AUTHORSHIP/authority, not just build state (p/40#7).
- 2026-07-16 — Technical Lead (t/1618 Z.AI outage, resolved c51018af): committed `ai-models.json` was never broken, but an uncommitted 2026-07-16 "refresh" of it dropped 36 models. Because the user runs uncommitted local builds, the local runtime hit a broken state that committed CI would never have produced. Settled at the object level with `git show origin/main:ai-models.json` (committed = clean). **Inverse variant:** here the dirty tree *introduced* breakage into the local runtime while committed state stayed clean — the mirror of the cases above where the dirty tree HID committed breakage. Same forensic resolution, opposite direction (p/8#69).
- 2026-07-26 — Technical Lead (t/1808, p/8#104): an ontology **referential-integrity check** *passed* — but it ran against the **DIRTY worktree**, so it validated on-disk state that included uncommitted edits, masking a break relative to committed HEAD. **Check-layer variant:** the false witness here is a *validator/check* (not `tsc`/`npm run verify`) — same failure as the build cases, one layer up: any check that reads the working tree inherits the dirty-tree-as-false-witness flaw. Same #44/#54/#55 object-level-forensics class. Fix: run integrity checks against committed state (`git stash` or a clean checkout / `git show HEAD:<path>`), and report which state was validated.

**Root Cause:** `tsc`, `npm run verify`, **and any validator/integrity check** read the working tree, not the git index. In a multi-agent environment, the shared working tree accumulates uncommitted changes from multiple agents — it's never a reliable proxy for committed state. When two agents disagree about whether main is broken, building/checking the dirty tree settles nothing. **Authorship variant:** a file's presence in the working tree carries no provenance — anyone could have written it, or it could be an artifact of a failed tool operation. Treating "it exists" as "agent X approved it" is the attribution form of false witness. **Inverse variant:** the dirty tree cuts both ways — it can hide committed breakage (verify false-green) OR inject breakage absent from committed state; when the user runs uncommitted local builds, their runtime is whatever is on disk, not what CI sees. **Check-layer variant (t/1808):** a passing referential-integrity/validation check proves nothing about committed state if it ran against the dirty tree — "the check is green" must name *which tree* it checked.

**Prevention:**
1. **Commit ALL files in a refactor atomically** — deletions and their importer fixes in the same commit. Never commit a deletion without its dependents.
2. After committing, run verify to confirm the COMMITTED state is green (the existing Definition of Done rule).
3. **Disputes about committed state are settled at the git object level**, not by building the working tree:
   - `git show HEAD:<path>` — does the file/export exist in committed code?
   - `git grep <pattern> HEAD` — search committed content only
   - `git cat-file -e <sha>:<path>` — verify a path exists at a specific commit
   - `git stash && npm run verify && git stash pop` — build committed state only
4. **Never attribute uncommitted shared-tree changes** — authorship requires a commit SHA or an activity-telemetry event. Working-tree presence alone establishes neither authorship nor approval.
5. Pairs with the "Verify Before Pushing" rule in root AGENTS.md as its diagnostic complement.
6. **Integrity/validation checks must state which tree they checked** (t/1808) — a referential-integrity/schema/lint check that reads the working tree is a dirty-tree false witness just like `verify`. Run it against committed state (`git stash` / clean checkout / `git show HEAD:<path>`) when the claim is about committed HEAD, and report "checked committed HEAD" vs "checked working tree."

**Status:** Resolved — root AGENTS.md "Git forensics" Common Traps rule (bf738f2, p/8#58).

**Applies To:** All agents on shared working trees, especially when diagnosing "is main broken?"

---

## [Build] Migration Missed Call Site — Verify Gate Renderer Blind Spot

**Pattern:** A batch symbol rename/migration replaces an import but misses one of multiple call sites in a renderer file. The bug ships because the verify gate doesn't type-check renderer code — `tsc` covers `tsconfig.main.json` and `tsconfig.server.json` only; Vite/esbuild transpiles renderer without type-checking.

**Instances:**
- 2026-07-06 — Diagnostics (t/1412): commit 6c55463d (t/1304, POV_META migration) replaced a `nodePovFromId` import but missed one of three call sites in `EdgeDetailPanel.tsx`. Shipped to main because renderer code is never type-checked by the verify gate. Bug ticket t/1412, gate gap ticket t/1413 (p/9#17).

**Root Cause:** (1) Batch symbol renames across files are high-risk — easy to update the import but miss scattered call sites. (2) The verify gate has a renderer blind spot: `tsc` runs against `tsconfig.main.json` (main process) and `tsconfig.server.json` (server), but `src/renderer/**/*` is only transpiled by Vite/esbuild without type-checking. Real type errors in renderer code are invisible to the gate. Related to #47 (ad-hoc tsc phantom errors) but inverted: #47 is false positives from running the wrong command; this is false negatives from the real gate missing a compilation target.

**Prevention:**
1. After batch symbol renames, **grep for the old symbol** across the entire codebase before committing — don't trust the import replacement to catch all call sites.
2. The verify gate needs a renderer type-check step (tracked in t/1413) — until then, `npx tsc --noEmit -p tsconfig.renderer.json` (or equivalent) must be run manually for renderer changes.
3. For migrations: count call sites before and after — if the counts don't match, you missed one.

**Status:** Active — gate gap tracked in t/1413.

**Applies To:** All agents performing symbol renames or migrations in renderer code.

---

## [Build] Shell Quoting Violations Create Junk Files Across Shared Working Tree

**Pattern:** Bash commands containing unquoted code with special characters (braces, parentheses, dots, slashes) create literal junk files from expression fragments — e.g., `f.startsWith('debate-')`, `{,+`, `(path.join(taxonomyDir`, `2.0.0`, `e.type` as actual filenames. Compounding: `git checkout -- <bad-pathspec>` in the shared tree reverts other agents' uncommitted edits.

**Instances:**
- 2026-07-09 — Orca Support: found untracked junk files across 3 scopes (`lib/debate/`, `engineering/tech-lead/`, `src/main/`) — TypeScript/JS expression fragments and brace-expansion tokens created as literal filenames by bash commands with unquoted special chars. A `git checkout -- <bad-pathspec>` in the shared tree reverted ElectronMain's uncommitted edits mid-change on t/1425, briefly breaking the build for TaxEditor and ServerAuth (p/13#16).

**Root Cause:** ADR-004 (shell quoting rule) violations — agents ran bash commands containing code with special characters (heredocs, sed, unquoted git pathspecs). Bash interpreted brace expansion, glob patterns, and parentheses as shell metacharacters, creating literal files instead of passing the strings to the intended command. The shared working tree amplifies the blast radius: junk files pollute other agents' environment, and recovery commands (`git checkout`) risk reverting other agents' work.

**Prevention:**
1. **ADR-004 is the standing rule:** use Edit/Write tools for code with special characters, never Bash heredocs/sed.
2. Always quote pathspecs in git commands: `git checkout -- "path"` not `git checkout -- path`.
3. After any bash command that may have failed with special chars, check `git status` for unexpected untracked files and remove them.
4. Never run `git checkout -- <pathspec>` on the shared tree to clean up junk files — it reverts ALL changes at those paths, including other agents' uncommitted work. Use `rm` for junk files instead.
5. Recommend: new hook on Bash commands containing `git checkout` to warn about shared-tree reverts.

**Status:** Active

**Applies To:** All agents using Bash with code containing special characters, especially on shared working trees.

---

## [Build] Stale tsc Incremental Cache After Git Stash/Pop Causes Transient Type Errors

**Pattern:** Running `npm run verify` (which includes `tsc`) immediately after `git stash pop` produces a phantom TS2322 error that disappears on re-run — the tsc incremental cache (.tsbuildinfo) is stale from the pre-stash file state.

**Instances:**
- 2026-07-10 — Taxonomy Editor (t/1502): verify's first tsc run showed TS2322 in DebateTab.tsx. Re-ran verify — passed consistently. Cause: interleaved stash/pop during the ticket mutated the working tree faster than tsc's incremental cache tracked (p/6#17).

**Root Cause:** TypeScript's incremental compilation (`.tsbuildinfo`) caches file hashes and type relationships between runs. `git stash` swaps file contents out, `git stash pop` swaps them back — but the timestamps and on-disk state can confuse the incremental cache, causing it to type-check against a stale dependency graph on the next run. A clean second run rebuilds the cache correctly.

**Prevention:**
1. If verify fails with a type error after `git stash pop`, **re-run once** before investigating — transient cache staleness is the likely cause.
2. To force a clean state: delete `.tsbuildinfo` files before running verify (`rm -f tsconfig*.tsbuildinfo`).
3. Don't chase phantom errors that disappear on re-run — note it and move on. Only investigate if the error persists across two consecutive runs.

**Status:** Active

**Applies To:** All agents running tsc-based verify gates after git stash/pop operations.

---

## [Build] UsageID Config Field Name Mismatch — Template in Non-Template Field Silently No-Ops

**Pattern:** A `{{placeholder}}` template in a UsageID config field that doesn't support template rendering (e.g., `systemMessage` instead of `systemMessageTemplate`) is passed as a literal string. The AI model runs with no effective instructions and produces plausible-looking garbage — misdiagnosed as a model quality issue before the config layer is suspected.

**Instances:**
- 2026-07-12 — Computational Linguist (t/1550#3): `pov-aphorism` UsageID config had `systemMessage: "{{prompt}}"` but `Invoke-AIByUsage` only substitutes templates in `systemMessageTemplate`. The `{{prompt}}` went unrendered, model ran instruction-less, and produced famous-quote misattributions that looked like a model-quality problem. Fixed in 6e4fe06a. Lint ticket t/1552 filed (p/40#3).

**Root Cause:** The UsageID config schema has two similar field names — `systemMessage` (static, passed verbatim) and `systemMessageTemplate` (rendered with `{{var}}` substitution). Nothing validates that `{{...}}` syntax only appears in `*Template` fields.

**Prevention:**
1. Use `systemMessageTemplate` (not `systemMessage`) when the value contains `{{...}}` placeholders.
2. Lint rule (t/1552): warn on `{{...}}` patterns in non-`*Template` fields in `ai-usages.json`.
3. When AI output looks subtly wrong (plausible but unconstrained), check the UsageID config FIRST.
4. Same genus as gate-signal-integrity patterns (#20/#46/#48): a config that silently no-ops reads as working.

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64). Lint rule still tracked in t/1552.

**Applies To:** All agents configuring UsageID entries in `ai-usages.json`.

---

## [Build] `az containerapp update --revision-mode` Does Not Exist — Use `az rest PATCH`

**Pattern:** `az containerapp update` does not accept a `--revision-mode` flag. The correct approach is `az rest --method PATCH` against the ARM endpoint with `{"properties":{"configuration":{"activeRevisionsMode":"Multiple"}}}`.

**Instances:**
- 2026-07-13 — DevOps: throwaway-branch dry-run (run 29437864507) failed because the workflow step used `az containerapp update --revision-mode`. Fixed by swapping to `az rest PATCH` (p/26#5).

**Root Cause:** The `az containerapp update` command supports many config properties but revision mode is not one of them — it's a top-level ARM property only settable via REST API or Bicep.

**Prevention:**
1. For ACA revision mode changes, use `az rest --method PATCH` against the ARM endpoint, or set in Bicep and redeploy.
2. When an `az containerapp` subcommand fails with "unrecognized arguments," check the ARM REST API docs.
3. Same ACA CLI-gap family as #40 (revision snapshots + `az containerapp registry remove` swallows 409).

**Status:** Active

**Applies To:** DevOps, Azure infrastructure, ACA deployment workflows.

---

## [Build] RawBody Truncation Causes Guaranteed SPA Shell False Positive

**Pattern:** An HTTP body read with a hard character cap (e.g., 400 chars) truncates the response before the content being checked appears. An SPA shell's `<head>` is 464+ chars before any `<script>` tags, so a "response contains script tag" acceptance test always fails — a guaranteed false positive.

**Instances:**
- 2026-07-15 — DevOps (t/1500): blue-green deploy acceptance test checked for `<script` in the response body but RawBody was capped at 400 chars. The SPA shell's `<head>` metadata exceeds 464 chars before the first `<script>` tag, guaranteeing a false positive. Fixed by bumping cap to 4096 (p/26#7, p/8#61).

**Root Cause:** PowerShell's `Invoke-WebRequest` `-MaximumRetryCount` and body reads can silently truncate. When the truncation point falls before the content being tested, the check is structurally guaranteed to fail regardless of the actual response — not a flaky test, but a permanently broken one.

**Prevention:**
1. When checking response content, ensure the body read cap exceeds the maximum plausible offset of the target content. For SPA shells, 4096+ chars is safe.
2. If a content check fails in CI but passes in the browser, suspect body truncation before debugging the app.
3. Same gate-signal-integrity genus as #20/#46/#48/#61: a check that fails for structural reasons, not content reasons.

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** All agents writing HTTP acceptance tests, especially for SPA responses.

---

## [Build] GHA Format-Table Wrong Property Names — Silent Empty Output

**Pattern:** PowerShell `Format-Table` with property names that don't match the actual object type silently produces empty columns — no error, no warning, just blank diagnostic output in CI.

**Instances:**
- 2026-07-15 — DevOps (t/1500): GHA workflow step used `Format-Table StatusCode, Detail` but the `EndpointTestResult` object has `Status` and `Error` properties. All diagnostic columns rendered blank. Fixed by matching the actual property names (p/26#7, p/8#61).

**Root Cause:** PowerShell's `Format-Table` does not error on non-existent property names — it renders empty cells. In CI logs, this looks like "the data was empty" rather than "the column names are wrong." Local testing may use different object shapes or ad-hoc hashtables where the names happen to match.

**Prevention:**
1. Verify `Format-Table` property names against the actual object type: `$obj | Get-Member -MemberType Property` before scripting.
2. When CI diagnostic output is blank but the test ran, suspect wrong property names before assuming empty data.
3. Consider `Select-Object` with `| ConvertTo-Json` for CI diagnostics — it errors on missing properties instead of silently blanking.

**Status:** Active

**Applies To:** All agents writing PowerShell diagnostic output in CI workflows.

---

## [Build] Stacked-Branch Landing — Merge in Stack Order with --no-ff

**Pattern:** When two branches are stacked (child branched off parent) and both touch the same file, landing them without respecting stack order — or squashing the base — forces an avoidable rebase of the child and manufactures merge conflicts.

**Instances:**
- 2026-07-16 — Technical Lead (t/1585, t/1601): landing `land/t-1585` into the worktree hit a merge conflict in `DebateTestedDrilldown.tsx` because t-1585 and t-1601 both touch that file and t-1601 is stacked on t-1585. Resolved by merging with `--no-ff` in dependency order (t-1585 before t-1601) so the stack stayed intact and no rebase was needed (p/8#67).

**Root Cause:** A stacked child branch's commits sit on top of the parent's commits. Squashing or out-of-order merging the parent changes the base the child was built on, so git must replay (rebase) the child's diffs against a changed base — re-deriving conflicts in any shared file. Merging the parent first with `--no-ff` preserves the child's base commit, so the child merges cleanly.

**Prevention:**
1. For stacked branches sharing a file, merge in stack order (base before child) using `--no-ff` — never squash the base.
2. Do not rebase the child unless the base's history genuinely changed; ordered `--no-ff` merges avoid the need entirely.
3. Track stack dependencies explicitly (ticket parent/child or a note) so landing order is unambiguous before you start.

**Status:** Active

**Applies To:** All agents landing stacked feature branches, especially via the worktree landing procedure.

---

## [Build] Landing-Worktree Pre-Push Friction — Verify Dirties Tracked Artifacts + origin/main Advances

**Pattern:** In a landing worktree, the step between `npm run verify` and `git push` hits two recurring, orthogonal frictions that each abort the push/rebase and are easy to misread as a real conflict: **(A)** the verify run (vitest) **regenerates a tracked artifact** — e.g. a `*.snap` snapshot re-written with flipped LF↔CRLF line endings — so the tree is dirty with a change you didn't make, and `git rebase origin/main` fails "cannot rebase: you have unstaged changes"; **(B)** under the active push cadence **origin/main advances every few minutes**, so a `&&`-chained fast-forward guard (`git merge-base --is-ancestor origin/main HEAD`) returns non-zero and the push step exits 1 — and `git diff HEAD..origin/main` **false-flags your OWN unpushed split files as "overlap"** (they differ only because origin doesn't have them yet).

**Instances:**
- 2026-07-17 — Server Storage (p/206#3): after `npm run verify` in a landing worktree, `git rebase origin/main` failed "you have unstaged changes." Cause: verify regenerated `src/server/__tests__/__snapshots__/routeTable.test.ts.snap` with flipped LF↔CRLF — a tracked file dirtied as a side effect of verify, not the actual change. Resolved: `git checkout -- <that snap>` before the rebase, then rebase + push cleanly.
- 2026-07-17 — DebateTool (t/1686, ADR-007 worktree land, resolved 2ef26698, p/70#7): the `git push` bash step exited 1 because the `&&`-chained FF-guard `git merge-base --is-ancestor origin/main HEAD` returned non-zero — origin/main had advanced. Compounding, `git diff HEAD..origin/main` false-flagged the agent's own unpushed split files as "overlap." Resolved: cleaned the verify-run snapshot artifact, confirmed via `git show --stat <origin-commit>` that origin's new commit didn't touch the agent's files, rebased, pushed.
- 2026-07-26 — DevOps (t/1802 ci.yml prune, p/26#19): **confirming instance of facet B — discipline held, benign.** The pre-push `git merge-base --is-ancestor origin/main HEAD` guard exited 1 because origin/main advanced between worktree-creation and push (minutes apart, active repo). Resolved cleanly per the prevention: `git rebase origin/main` on the 1 commit + push. Documents that the recorded fix works in practice — a non-zero FF-guard is the *expected* "origin advanced, rebase now" signal, not an error. (DevOps flagged it only because the exit-1 tripped the route-to-Sage hook — the #80 Part-3 residual.)

**Root Cause:** (A) Verify is not read-only — vitest rewrites snapshot files, and on Windows a regenerated snapshot can come back with the opposite line endings (LF↔CRLF), leaving a tracked file modified. Git refuses to rebase with a dirty tree, so a side-effect artifact blocks the land. (B) The FF-guard and the `diff` comparison both assume origin/main is stationary, but the fleet's push cadence advances it constantly; the guard's non-zero exit is expected, not an error, and `git diff HEAD..origin/main` shows your own not-yet-pushed files as differences — mistaking either for a real conflict is the same false-witness failure as citing the working tree for committed state (Git Forensics #44/#54/#55).

**Prevention:**
1. **Expect verify to dirty regenerated artifacts; discard them before rebase/push.** After verify in a landing worktree, `git checkout -- <regenerated *.snap / generated file>` (or `git stash`) so the tree is clean before `git rebase origin/main`. Only your intended changed files should remain.
2. **Treat origin/main as moving: `git fetch origin` + rebase immediately before the push**, every land — a `&&`-chained FF-guard returning non-zero usually means "origin advanced, rebase now," not "abort." Don't let the guard's exit code fail the whole step.
3. **Verify overlap at the object level, not with `git diff HEAD..origin/main`** — that diff shows your own unpushed files as differences. Use `git show --stat <origin-commit>` (or `git log --stat origin/main ^HEAD`) to see what origin's new commit actually touched; only a real shared-file change needs conflict handling.

**Status:** Active — 2 instances, 2 agents (Server Storage, DebateTool), both 2026-07-17 on ADR-007 worktree lands. Reinforces the `/land-from-worktree` procedure with the pre-push cleanup + fetch-rebase step.

**Applies To:** All agents using the worktree landing procedure — the window between verify and push, especially during active fleet push cadence.

---

## [Build] PowerShell Through the Bash Tool — Git Bash Eats Shell Operators Before pwsh Sees Them

**Pattern:** Running a PowerShell pipeline through the **Bash tool** (which is Git Bash) fails when shell metacharacters — a pipe `|` or a backtick line-continuation — sit **outside** the `pwsh -Command '...'` string. Git Bash interprets them itself before pwsh is ever invoked, so the pipe splits the command at the bash level and the backtick is consumed as a bash escape, producing truncated commands or `unexpected EOF` rather than the intended pwsh pipeline.

**Instances:**
- 2026-07-17 — PowerShell (during t/1621 work, p/20#17): two failures piping PowerShell through the Bash tool — `pwsh -Command '...' | Something` sent the `|` to bash (not the pwsh pipeline), and a backtick line-continuation was eaten by bash before pwsh saw it. Fix: keep the whole pipeline inside a single `pwsh -Command '...'` string, or use the PowerShell tool directly.

**Root Cause:** The Bash tool is Git Bash, not pwsh. Only the text **inside** the quoted `-Command '...'` argument reaches PowerShell; everything else on the line is parsed by bash first. `|`, `` ` ``, `$`, `>`, `&&` and friends are bash metacharacters — placed outside the quoted command string they are consumed by bash, so pwsh receives a fragment. This is a distinct mechanism from quote-delimiter collision (see "Bash Heredoc Failures with Nested Quotes") and from `$`-substitution corruption — here the failure is a **shell operator leaking out of the command string**, not a mangled literal.

**Prevention:**
1. **Prefer the PowerShell tool** for any PowerShell work — it is the fleet default and sidesteps the two-shell problem entirely (root AGENTS.md Search Tooling Rule points the same way).
2. If you must go through the Bash tool, keep the **entire** pipeline inside one `pwsh -Command '...'` string — every `|`, `` ` ``, and `$` must live inside the quotes so pwsh, not bash, parses them.
3. Never rely on bash line-continuation (trailing `` ` `` or `\`) to span a pwsh command across Bash-tool lines — write the whole command on one logical line inside the quoted string, or write a script file (Shell Quoting Rule) and run it.

**Status:** Active

**Applies To:** All agents running PowerShell through the Bash tool on Windows/Git Bash.

---

## [Build] Windows Git Bash Silently Breaks Command Chains — grep Zero-Match Exit + MSYS Path Conversion

**Pattern:** Two independent Windows/Git-Bash behaviors silently abort a Bash-tool command mid-chain even though nothing is actually wrong: **(A)** `grep -c` (and any grep) **exits 1 on ZERO matches** — standard grep behavior — so an `&&`-chained check breaks at that link *even when the printed `0` was the desired result* (e.g. confirming zero `.ts` entries); **(B)** MSYS **auto path-conversion mangles ANY git `<ref>:<slashed-path>` colon revspec** (`git show`, `git cat-file`, `git rev-parse`, `git ls-tree` …) — `git show origin/main:.github/workflows/ci.yml` is rewritten to `origin\main;.github\...` (colon→`;`, `/`→`\`), producing `fatal: unknown revision` on a perfectly valid ref. **More broadly, MSYS mangles ANY argument that *looks like* a Unix path — not only git colon-revspecs but a leading-slash argument to a NON-git CLI** (e.g. an Azure resource ID `/subscriptions/...` passed to `az`, prefixed with the Git-bin install path → `InvalidEnvironmentId`; Azure p/105#4). Same root, two triggers: the `<ref>:<path>` colon and the leading `/`.

**Instances:**
- 2026-07-17 — DevOps (while landing t/1692, p/26#14): (A) a `grep -c ... && ...` chain broke because `grep -c` returned exit 1 on zero matches — the `0` count was the intended answer, but the non-zero exit killed the `&&` chain. (B) `git show origin/main:.github/workflows/ci.yml` failed "unknown revision" because MSYS converted the `<ref>:<path>` arg into `origin\main;.github\...`. Fixes: keep zero-match/count checks OUT of `&&` links (test the value separately), and prefix `MSYS_NO_PATHCONV=1` for `git show <ref>:<slashed-path>`. Both benign, resolved.
- 2026-07-17 — Technical Lead (p/8#79, refines facet B): facet B **does NOT reproduce** in TL's Bash-tool env — `git show HEAD:.github/workflows/ci.yml` and every `git show <ref>:<path>` returned OK all session. So facet B is **MSYS-config-dependent**, not "always breaks on Windows Git Bash": DevOps's MSYS setup mangles the arg, TL's does not. The durable defense is a failure-**signature**, not a blanket prefix (mandating `MSYS_NO_PATHCONV=1` everywhere is noise where it isn't needed).
- 2026-07-17 — ServerAPI (p/79#8, **2nd facet-A instance**): `git show ... | grep -c "^-" && echo ...` reported tool failure (exit 1) because `grep -c` returned 0 deletions (a purely-additive diff — `0` was the desired answer), aborting the `&&` chain. No real error — read the printed count; fix `|| true` after `grep -c` or keep it out of the `&&` chain. Confirms facet A recurs independently across agents (DevOps + ServerAPI, same day).
- 2026-07-17 — Taxonomy Editor (p/6#20, **3rd facet-A instance**): a Bash chain whose *final* `git log origin/main | grep -iE "pattern"` matched fine still tripped the failure hook (exit 1) because an **earlier `grep -c` in the same chain returned 0**, so the combined chain exit was nonzero. Object-level confirmations were actually fine; resolved by re-running the log query standalone. **Variant:** the poisoning grep is *upstream* in the chain, not the last command — so a successful final match is masked by an earlier zero-count. Crosses the 3-instance threshold (DevOps + ServerAPI + Taxonomy Editor, all same day).
- 2026-07-29 — ElectronMain (p/98#9, **4th facet-A instance**): a `grep -c` zero-match exit-1 broke a landing command chain (classic facet A — the printed count was the intended answer, the non-zero exit aborted the chain). Notable because it occurred in the SAME landing as a **higher-stakes chain-cut that silently dropped a `git push`** — see the sibling pattern "A Multi-Step `&&` Chain Can Be Cut Before a Critical Step Runs." Reinforces the accepted root rule (keep zero-match checks out of `&&` chains).
- 2026-07-29 — DebateDiagnostics (t/1909, p/245#3, **facet C — cwd-vs-repo-root**): `git show HEAD:src/renderer/.../EdgesUsed.tsx` exited **128**, run from the `taxonomy-editor/` subdir with a **cwd-relative** path — but `git show <ref>:<path>` resolves `<path>` from the **repo root**, not cwd. Fixed with the repo-root-relative path (`taxonomy-editor/src/renderer/.../EdgesUsed.tsx`). A THIRD `git show <ref>:<path>` failure mode, **platform-agnostic** (unlike facet B's MSYS mangling): a valid file looks "missing in the ref" — same wrong-forensics risk, different cause.
- 2026-08-01 — DevOps (p/26#29, **2nd facet-B instance**): `git show 'origin/main:.github/workflows/ci.yml'` via the Bash tool exited **128** — MSYS mangled the arg to `origin\main;.github\...` (colon→`;`, `/`→`\`). Confirms facet B reproduces in DevOps's MSYS env (consistent with TL's config-dependent finding, p/8#79). **NEW escape: ran the same `git show` through the PowerShell tool** — no MSYS layer, so no munging — a clean cross-tool workaround alongside `MSYS_NO_PATHCONV=1`. Ties to the win32 "prefer the PowerShell tool for git/shell ops" habit.
- 2026-08-01 — Documentation (p/323#1, **3rd facet-B instance — 2nd agent + generalizes beyond `git show`**): `git cat-file -e origin/main:.github/scripts/...` failed — MSYS rewrote the `:` revspec to `origin\main;...`. Two broadenings: (a) it's **`git cat-file`, not `git show`** — so facet B is **ANY git command taking a `<ref>:<path>` colon revspec** (`show`, `cat-file`, `rev-parse <ref>:<path>`, `ls-tree`…), not just `git show`; (b) it hit a **2nd agent** (Documentation, not DevOps). Fixed with a persistent **`export MSYS_NO_PATHCONV=1`** before the colon-revspec commands. **Precise reproducibility framing (TL p/8#157, correcting my p/8#156 overstatement): env-DEPENDENT, not "broadly reproducible."** It reproduces on ≥2 agents (DevOps + Documentation) but does **NOT** on TL's Bash tool — `MSYS_NO_PATHCONV` unset there, yet `git show`/`cat-file`/`rev-parse` on `<ref>:<deep/path>` all resolve clean (why TL's forensics worked all session). So it **varies by Git-for-Windows install** — neither a single-agent quirk nor universal. 3 instances / 2 agents + 1 clean counterexample (TL).
- 2026-08-03 — Azure (p/105#4, **facet B generalizes to a non-git tool + a leading-slash arg; 3rd agent**): `az deployment group create` failed `InvalidEnvironmentId` because MSYS mangled a **leading-slash Azure resource ID** (`/subscriptions/...`), prefixing it with the Git-bin install path (MSYS treats a leading-`/` arg as a Unix path to translate). Two broadenings: (a) the mangled arg is a **leading-slash resource ID, not a `<ref>:<path>` colon-revspec** — a 2nd MSYS trigger sharing facet B's root (args that *look like* Unix paths, already named in Root Cause); (b) it hit a **non-git tool (`az`)** and a **3rd agent** — facet B is not git-specific. Fix: pass Azure resource IDs via the **PowerShell tool** (no MSYS layer) or `MSYS_NO_PATHCONV=1`. Same env-dependent MSYS path-conversion class; ties to the win32 "prefer the PowerShell tool for git/shell ops" habit.

**Root Cause:** (A) grep's exit code is a *match indicator*, not a *success indicator* — 0 = matched, 1 = no match, 2 = error. In an `&&` chain the shell treats exit 1 as failure and stops, so a legitimately-empty result (count `0`) aborts the chain. This is standard POSIX grep behavior, not Windows-specific, but it bites hardest in Bash-tool one-liners that chain a count check into follow-up steps — and it recurs (2 agents in one day: a zero `.ts`-entry count and a zero-deletion diff count). Same "exit code ≠ what you think" family as the grep-fails-silently pattern above. (B) MSYS/Git-Bash *can* rewrite arguments that *look like* Unix paths (containing `/` or a leading drive-colon) into Windows paths before the program sees them. `git show`'s `<ref>:<path>` syntax collides with this — the `:` and `/`s get converted, corrupting the ref. **This is config-dependent** (`MSYS2_ARG_CONV_EXCL` / `MSYS_NO_PATHCONV` / how the Bash tool's MSYS is configured): it reproduced in DevOps's env and NOT in TL's, where every `git show <ref>:<path>` ran clean all session. So the harm is not "the command always breaks" — it's **misreading the false `unknown revision` as a genuinely-missing ref** (the exact wrong forensics conclusion the root Git-Forensics rule guards against). `MSYS_NO_PATHCONV=1` (or a leading `//`) disables the conversion for that command. Sibling of #67 (Git Bash eats shell operators before pwsh sees them) — same root: the Bash tool is Git Bash, and its shell/MSYS layer *may* transform your command before the target program runs.

**Prevention:**
1. **Keep zero-match/count checks out of `&&` chains.** Capture the value first (`n=$(grep -c ... || true)`) then test it, or append `|| true` so a legitimate zero-match doesn't abort the chain. Never assume `grep`/`grep -c` exit 0 on a successful-but-empty result.
2. **Facet B is a failure-SIGNATURE, not a blanket mandate** (TL, p/8#79): if `git show <ref>:<slashed-path>` reports `unknown revision` on a ref/path you KNOW exists, that's MSYS path-conversion — retry with `MSYS_NO_PATHCONV=1`. Do NOT prefix it unconditionally; it's config-dependent and unnecessary in envs (like TL's) that don't mangle. The critical error to avoid is concluding the ref is genuinely missing — the exact wrong forensics call the root Git-Forensics rule exists to prevent.
3. **So: a valid ref reporting "unknown revision" in the Bash tool is the tell** — suspect MSYS path-conversion before doubting the ref exists; confirm by re-running with `MSYS_NO_PATHCONV=1`, **OR run the same `git show` through the PowerShell tool** (no MSYS layer → no munging; DevOps p/26#29) — the cleanest cross-tool escape on win32.
4. **`git show <ref>:<path>` resolves `<path>` from the REPO ROOT, not your cwd** (facet C, platform-agnostic) — from a subdirectory a cwd-relative path exits **128** and looks like the file is missing in the ref. Use a repo-root-relative path (or `git -C <repo-root> show <ref>:<path>`). Same "valid path, misleading git-show failure → don't conclude the content is absent" caution as facet B, different cause.

**Status:** Active — sibling of #67 (Git-Bash-transforms-your-command family). **Facet A now has 4 instances (DevOps + ServerAPI + Taxonomy Editor 2026-07-17; ElectronMain 2026-07-29) — well past the escalation threshold.** Universal grep behavior (`grep`/`grep -c` exit 1 on zero match), recurring across agents and across chain positions (final OR upstream command). **Escalation — ACCEPTED (p/8#86):** TL folded facet A into the AGENTS.md batch as an extension to the existing root "Search Tooling Rule" section — *never put `grep`/`grep -c` in a `&&` chain (or as a Bash-tool command's last exit) where zero matches is a valid result; use `|| true` or capture-and-test.* Originally judged not *blockable* (a blocking guard would fire on every legitimate `grep && `) — **but now ADVISORY-guarded**: the workspace feedback rule **`exit-code-literacy-guard`** (2026-08-03, t/2081; `node -e` run-gate over the exit-code-literacy family #73A/#84/#90/#96/#121) emits a **context nudge** on the risky pattern rather than blocking, so legitimate `grep &&` uses proceed. **Live-firing OBSERVED — 2 independent firings across 2 different guard branches (2026-08-03):** Sage on a `git show … | grep -c` (#73A grep branch) + TL on `gh pr checks 334` correctly flagging **exit-8 = pending** (not failed) during the PR #334 CodeQL wait (#121 branch, p/8#166). Non-blocking ⇒ no false-green risk of its own; systematic firing-verification still deferred per t/1625. The documented root rule stays the behavioral defense. Overlay/owner-gated, in TL's 4-item batch being surfaced to the owner. Facet B is **environment-dependent MSYS path conversion — varies by Git-for-Windows install** (TL p/8#79/#157): **3 instances / 2 agents that reproduce (DevOps `git show`; Documentation `git cat-file`) + 1 clean counterexample (TL — colon-revspecs resolve fine with `MSYS_NO_PATHCONV` unset).** Generalizes to ANY git `<ref>:<path>` colon revspec (show/cat-file/rev-parse/ls-tree). **Key insight (p/8#157): env-dependence STRENGTHENS the need for the root trap-line, not weakens it** — an agent whose env doesn't reproduce it (TL) would otherwise dismiss a peer's report as user error, so the shared failure-signature is what lets a non-repro agent trust a repro agent. **Root Git-Forensics Common-Trap line LANDING via PR #323** — env-dependent wording + the valid-ref→`unknown revision` discriminator (retry `MSYS_NO_PATHCONV=1`, or run through the PowerShell tool). Escalation resolved. **Facet B broadened (Azure p/105#4, 2026-08-03):** MSYS path-conversion also mangles a **leading-slash arg to a NON-git CLI** (Azure resource ID `/subscriptions/...` → `az` `InvalidEnvironmentId`) — now **3 agents, git + non-git tools, two triggers (colon-revspec + leading-slash)**. Same env-dependent class, same fix (PowerShell tool / `MSYS_NO_PATHCONV=1`) — reinforces the win32 "prefer the PowerShell tool" habit for any arg that looks like a Unix path.

**Applies To:** All agents running git or grep through the Bash tool on Windows/Git Bash — especially object-level git forensics (`git show <ref>:<path>`) and count-guarded command chains.

---

## [Build] A Multi-Step `&&` Chain Can Be Cut Before a Critical Step (e.g. `git push`) Runs — Verify the Side Effect on origin Independently

**Pattern:** A long Bash-tool chain like `tsc && git push && git fetch && grep …` can stop **after an early command** — only the first command's output comes back (e.g. just `TSC=0`) — so a **`git push` later in the chain silently never executes**. The partial output looks like progress, and it's easy to assume the push landed. The commit is on local `HEAD` but the ref was never pushed; if origin has since advanced, your change is simply **absent upstream**. Mechanisms that cut the chain are mechanism-agnostic from the caller's view: a `grep -c` zero-match exit-1 (#73 facet A), an intermediate command's nonzero exit, or the Bash tool truncating/aborting after the first output.

**Instances:**
- 2026-07-29 — ElectronMain (p/98#9): a `tsc && git push && git fetch && grep` chain returned only `TSC=0`; the **`git push` never ran** and was nearly assumed landed. Caught only by object-level `git show origin/main:<file>`, which showed the change **absent** and origin **advanced**. Resolved by re-running the push standalone and re-verifying on origin. (The chain also carried a `grep -c` zero-match exit-1 — #73 facet A.)

**Root Cause:** An `&&` chain reports only its final exit and interleaves output; when it aborts early, the caller sees a truncated, success-looking result with no explicit failure for the skipped `push`. A `push` is a *side effect*, not a value the chain returns — so "the command came back" is bookkeeping, not evidence the ref moved (**bookkeeping ≠ artifact**). This is the chain-cut sibling of #95: there the push was *killed by a 120s timeout* (commit landed, push didn't); here it *never ran because an upstream link broke* — same split state (local commit present, origin ref absent), same defense.

**Prevention:**
1. **Never bury a `git push` (or any critical side-effecting step) mid-chain and trust the chain's apparent success.** Run the push as its own command, or verify it independently right after.
2. **After any chained push, confirm the commit is actually on origin at the object level** — `git ls-remote origin <branch>` (or `git show origin/main:<file>` for content) — and check the SHA/content is present BEFORE any dependent action or "it's landed" claim. (Same defense as #95 prevention #2; object-level, per the root Git-Forensics rule.)
3. **Keep chain-breakers (`grep -c`/`grep` zero-match, other exit-1-on-empty commands) out of `&&` chains that contain a critical step** — a broken link silently drops everything after it (#73 facet A; use `|| true` or capture-and-test).

**Status:** Active — chain-cut sibling of #95 under the "a push in a compound command may not have actually run → verify the ref on origin" theme; bookkeeping≠artifact genus; the chain-break mechanism overlaps #73 facet A.

**Applies To:** All agents landing via Bash-tool command chains that include a `git push` — especially long `tsc && push && … && grep` one-liners on Windows/Git Bash.

---

## [Build] `npm run build` Exits Non-Zero on an Interactive Prompt in a Non-Essential Trailing Step (No TTY)

**Pattern:** `npm run build` is a composite chain; its **trailing `licenses` step** (`generate-license-file`) prompts **"overwrite? (y/N)"** before rewriting an existing license file. In a **non-interactive shell (no TTY)** — the Bash tool, CI — the prompt can't be answered, so the step **exits 2 and fails the whole `npm run build`** — even though the essential build (`build:main` + the vite renderer) already completed successfully. A false-red on the real build, caused by a non-essential post-step assuming a TTY.

**Instances:**
- 2026-07-26 — DebateWorkspace (p/124#4): `npm run build` exited 2 in a non-interactive shell because the `licenses` / `generate-license-file` step hit an interactive overwrite prompt with no TTY. Resolved by treating it as non-blocking — `build:main` + vite renderer had already completed. Suggested adding a non-interactive/overwrite flag to that script.

**Root Cause:** `generate-license-file` (and similar codegen/docs tools) default to **interactive confirmation** before overwriting an existing output — fine at a dev terminal, broken under automation where there's no TTY to answer. Chained into the composite `build` script, its non-zero exit propagates to `npm run build`'s exit code, so the aggregate reports "build failed" when only a cosmetic trailing step failed. Same shape as the gate-signal-integrity false-reds (#20/#46): a non-essential step's failure masking the essential gate's success — here the essential build passed but the composite exit says otherwise.

**Prevention:**
1. **Add a non-interactive/overwrite flag to the `generate-license-file` invocation** in `package.json` (its `--overwrite` / no-input option), so the licenses step never prompts. (Suggested fix — needs the owning app's package.json change.)
2. **When a composite `build` fails, check WHICH step failed** — a trailing `licenses`/docs step exiting non-zero does NOT mean `build:main` or the renderer failed; read the step output, not just the aggregate exit code (same "read which step, not the rollup" discipline as the CI gate-blindness pattern).
3. **Keep non-essential steps out of the critical build path** for automation — run license/docs generation as a separate script, or make it non-blocking, so a TTY-only prompt can't false-red the real build.
4. **General:** any build/codegen tool that prompts before overwriting is a non-interactive-shell hazard — pass its yes/overwrite/no-input flag when invoking from the Bash tool or CI.

**Status:** Active — false-red (non-essential-step) variant near the gate-signal-integrity genus (#20/#46). Fix is a package.json flag on the owning app (routed suggestion, p/124#4).

**Applies To:** All agents running `npm run build` (or any composite build with a codegen/license/docs post-step) from a non-interactive shell — Bash tool, CI.

---

## [Build] Local `npm run verify` Hangs on a LIVE AI Backend When Keys Are Set — Keyless CI Never Hits It

**Pattern:** A test has a secondary path that **falls through to a LIVE AI backend when API keys are present in the shell**. On a dev machine (BYOK — keys set) the test makes real Gemini/Claude/Groq calls; **keyless CI runners never do**, so the divergence is invisible in CI. When the live provider is quota-exhausted (e.g. a concurrent debate batch eating the same key's quota), the call's retry logic (120s backoffs on `RESOURCE_EXHAUSTED`) turns the leak into a **~10-minute local `npm run verify` HANG** — a local-only false-red the CI signal can't explain.

**Instances:**
- 2026-07-26 — Debate Tool 2 (p/234#1, surfaced landing t/1824): local `npm run verify` killed after ~10 min hanging on `[retry] gemini/gemini-2.5-flash RESOURCE_EXHAUSTED` (120s backoffs). Cause: with AI keys set in the shell, `debateEngine.modelRouting.test.ts` fell through to a live Gemini backend on a secondary routing path; a concurrent t/1670 batch had exhausted the quota → retries hung. CI (keyless) never hits it. Fix: run **CI-faithfully with keys unset** — `GEMINI_API_KEY= ANTHROPIC_API_KEY= GROQ_API_KEY= npm run verify` → the same test passes **28/28 in ~3s**.

**Root Cause:** Two compounding issues. (1) **Test-isolation defect:** a unit/routing test must not reach a live backend, but a secondary path falls through to one **when keys are present** — so test behavior depends on shell env (keys) rather than being hermetic. (2) **Local ≠ CI on keys:** dev shells carry BYOK keys; CI runners are keyless, so the live-call path only fires locally and CI is blind to it. The live retry policy (120s × `RESOURCE_EXHAUSTED`) converts a silent leak into a long hang, and a **concurrent batch on the same key** makes exhaustion likely (ties to the serialize-batches convention, #83 prevention #5 / #86).

**Prevention:**
1. **Run `verify` CI-faithfully — keyless:** `GEMINI_API_KEY= ANTHROPIC_API_KEY= GROQ_API_KEY= npm run verify` reproduces the CI environment and sidesteps the live-call path (fast + deterministic). Good default whenever a local verify hangs but CI is green.
2. **Real fix — test isolation:** the routing test must stub/mock the backend so keys-present ≠ live-calls; a test's outcome must not depend on whether the shell has API keys. (Routed to the owning test.)
3. **A test that HANGS (not fails) on a backend retry is a hygiene defect** — tests must never make real network calls to paid APIs; cap/mocking is mandatory, and a live path reachable from a test is a bug regardless of keys.
4. **When local verify hangs but CI is green, suspect a keys-present live-call leak** — check for `[retry] … RESOURCE_EXHAUSTED`/backoff lines; the env difference (keys) is the usual cause.

**Status:** Active — local-vs-CI (keys-present) divergence; test-isolation defect surfaced landing t/1824. Workaround (keyless verify) documented; real fix is test isolation (routed).

**Applies To:** All agents running `npm run verify`/tests locally with BYOK keys set — especially debate-engine/model-routing tests that can reach a live backend.

---

## [Build] A New Test Can Trip a Cross-File / Repo-Wide Lint — Run the FULL Suite Before Push, Not Just the Changed File

**Pattern:** Some tests are **repo-wide lints** that scan *other* files (e.g. `ModelLiteralLint.Tests.ps1`, t/1858, flags `-Model '<unregistered-id>'` literals missing the `# model-lint:allow` marker). A new test you add in file A can violate a lint that lives in file B. If you validate locally by running **only your changed test file**, the lint in the other file never executes — so it passes locally and turns **main CI red fleet-wide** on push. The single-file run gives false confidence precisely because the failing check isn't in the file you ran.

**Instances:**
- 2026-07-28 — PowerShell 2 + PowerShell Main (t/1899, resolved 21fc09fd; p/228#5, p/20#29, full trail t/1899#2): commit `5f80fd4d` added an intentionally-invalid negative-test fixture `-Model 'totally-unregistered-model-zzz'` **without** the gate's documented `# model-lint:allow` escape-hatch marker. Running only the changed test file in the worktree passed; the repo-wide `ModelLiteralLint` (t/1858, a *different* test file that had been live+green ~5h) never ran locally → **main CI red fleet-wide for ~5h**. Compounded by a **stale local tree** (that file was 118 commits behind origin — stale facet of "Copying a Whole File From the Shared Tree"). Fix = the 1-line marker (`21fc09fd`); the byte-identical twin commit was stood down to avoid a duplicate-commit race.

**Root Cause:** A repo-wide lint's *coverage* (all files) is decoupled from its *location* (one test file). An agent's mental model is "I changed file A, so I run file A's tests," but the check that governs A's content lives in B. `Invoke-Pester ./tests/` runs B; `Invoke-Pester ./tests/A.Tests.ps1` does not. This is a specific, sharp case of the general "verify before push / run the full suite" rule — the reason you can't shortcut to the changed file is that cross-cutting gates (lints, invariant checks, manifest guards) deliberately live outside the files they govern.

**Prevention:**
1. **Run the FULL `Invoke-Pester ./tests/` before every push — never just the changed test file.** The changed-file run is fine for fast iteration, but the pre-push gate must be the whole suite so repo-wide lints/invariant checks execute (~100s here — it would have caught this). **CI is not first-pass validation** — don't discover a repo-wide gate by turning main red for the fleet. (Same spirit as the CI-faithful keyless-verify rule in the pattern above.)
2. **When you add a DELIBERATELY-invalid fixture (a negative test), apply the scanning gate's documented suppression marker on the SAME PHYSICAL LINE** — e.g. `-Model 'bad-id-zzz'  # model-lint:allow`. A negative test is invalid *by design*, which is exactly what a repo-wide scanner flags; the inline marker is how you declare "this invalidity is intentional." This is the author's proactive obligation — don't wait for CI to remind you the gate exists.
3. **Know the repo-wide gates exist:** `ModelLiteralLint` (`-Model` literal staleness, t/1858), manifest/version-coherence checks, ontology referential-integrity checks — these scan files other than their own, so a new literal/fixture in *any* file can trip them.
4. **Land targeted edits onto a fresh worktree base** (branched off current `origin/main`), don't copy a stale whole file — a stale base both hides newly-added gates and risks clobbering peers' additions (see the stale facet of the whole-file-copy pattern).

**Status:** Active — local-vs-CI divergence by *test scope* (changed-file run ≠ full suite), sibling of the keys-present live-backend divergence above; ~5h fleet-wide red main. Reinforces the standing "verify before push" rule with a concrete failure mode: repo-wide lints live outside the files they govern, and a deliberately-invalid fixture must carry the gate's inline suppression marker.

**Applies To:** All agents adding or modifying tests/fixtures in a repo that has cross-file or repo-wide lint tests (`ModelLiteralLint`, manifest/invariant guards).

---

## [Build] `git stash show` Rejects a Pathspec ("Too many revisions specified")

**Pattern:** `git stash show -p 'stash@{N}' -- <path>` fails with "Too many revisions specified" — `git stash show` accepts a single stash ref and does NOT take a `-- <pathspec>` to scope the diff to one file.

**Instances:**
- 2026-07-29 — DevOps (t/1768, p/26#24): `git stash show -p 'stash@{1}' -- <path>` errored while inspecting a stash for a single file. Fixed with `git diff 'stash@{1}^' 'stash@{1}' -- <path>`. Self-resolved, no impact.

**Root Cause:** `git stash show` is a thin wrapper that only diffs a whole stash entry against its base; it has no pathspec-filtering mode, so it parses the `-- <path>` tokens as additional revisions and bails. A stash is an ordinary commit (`stash@{N}`) whose first parent (`stash@{N}^`) is the base it was taken from, so the underlying `git diff` accepts a normal `<rev> <rev> -- <path>` form.

**Prevention:**
1. **To diff ONE file from a stash's own change set:** `git diff 'stash@{N}^' 'stash@{N}' -- <path>` (the stash vs its base). Note the `^` — a stash's first parent is its capture point.
2. **To compare a stashed file against another ref** (e.g. origin, as in the t/1768 supersession check): `git diff 'stash@{N}:<path>' 'origin/main:<path>'` (blob-vs-blob, no `--` needed).
3. Whole-stash overview (all files) still works with `git stash show -p 'stash@{N}'` — just drop the pathspec.

**Status:** Resolved — self-correcting (git rejects the malformed form immediately). Single instance; a reusable git idiom worth recording since stash inspection recurs during worktree/realign cleanups.

**Applies To:** Any agent inspecting a specific file inside a git stash.

---

## [Build] Extracting a `catch` Body Into a Helper Trips the AST-Enforced Flight-Recorder Rule (ADR-003)

**Pattern:** The custom ESLint rule `local/require-flight-recorder-in-catch` (ADR-003) is **position-based** — it requires `getGlobalRecorder()?.record(...)` to be *literally inside* the `catch` block's AST. Refactoring that moves the `record(...)` call into an extracted helper fails lint even though runtime behavior is identical. Complexity-reduction / function-extraction passes are the classic trigger: the natural move is to lift the whole `catch` body into a named function, which relocates the `record()` call out of the `catch` node.

**Instances:**
- 2026-07-29 — Taxonomy Editor 2 (t/1848 batch 7): extracting a `catch` body into a helper during complexity decomposition tripped the rule. Fixed by keeping `record(...)` inline in the `catch`, extracting only the non-recording tail (p/195#9, t/1848#11).
- 2026-07-29 — ElectronMain (t/1914): independently hit the same rule during the same t/1848 fan-out. Same fix.

**Root Cause:** ADR-003's guarantee is that *every* `catch` records to the flight recorder, and the rule enforces it structurally by requiring the `record()` call as a direct statement of the `catch` block — not merely reachable from it. A helper that records is behavior-equivalent but AST-invisible to the rule, so extraction is a false-positive-shaped-but-intended rejection: the rule can't prove the helper always runs and always records, so it holds the line on literal position.

**Prevention:**
1. **When decomposing a `catch`-heavy function, keep `getGlobalRecorder()?.record(...)` inline in the `catch`; extract only the non-recording tail** (e.g. fallback-value construction, retry orchestration). The record call stays put; everything after it can move.
2. Don't try to satisfy the rule by wrapping the helper to "also record" — the guarantee is literal-position, not reachability. Inline is the sanctioned form.
3. This is one of a class: **position-based AST rules survive behavior-preserving refactors only if the guarded call stays structurally where the rule expects it.** Before extracting a block guarded by a `local/*` rule, check whether the guarded call must stay put.

**Status:** Active — self-correcting at point-of-use (the lint rule rejects it immediately, zero cost beyond a retry), so NOT a #82-style escalation; the AST rule IS the enforcement. **2 instances / 2 roles, both in the t/1848 complexity-decomposition fan-out, with 6+ more roles (DebateDiagnostics, Chat, ServerAPI, …) still decomposing catch-heavy code** — high likelihood of further independent rediscovery. Point-of-use prevention broadcast by TE2 on the shared parent ticket (t/1848#11). **Durable systemic lever TAKEN (TL, p/8#116):** the fix idiom is being embedded in the rule's own lint-time message ("record()/log must stay LITERALLY in the catch — extract only the non-recording tail (ADR-003)"), filed low-pri/self-cert as **t/1927 (Shared Lib, `lib/eslint-rules` copy) + t/1928 (Taxonomy Editor, `taxonomy-editor/eslint-rules` copy)** — turns a structural rejection into a one-line self-service fix, immunizing the remaining fan-out and future decomposition.

**Related latent risk (drift smell), surfaced by this pattern (TL p/8#116):** the `require-flight-recorder-in-catch` rule is **two byte-identical copies** (`lib/eslint-rules` + `taxonomy-editor/eslint-rules`) referenced by **3 `eslint.config.mjs`** — hence the message-embed had to be filed as *two* tickets. A single duplicated source-of-truth carries an update-in-N-places tax: any future edit (like this one) must touch every copy, and the copies can silently diverge (a real failure the day one copy is updated and the others aren't). No divergence observed yet — TL noted a **single-shared-rule dedup** as a separate low-pri follow-up (not blocking the message fix). If the copies ever drift, that realized failure lands here.

**Applies To:** Any role running function-extraction / complexity-reduction on code with flight-recorder-guarded `catch` blocks (the t/1848 fan-out, and future refactors under ADR-003).

---

## [Build] Building a Sibling-Worktree Path With `..` Collapses to the Wrong Base

**Pattern:** Constructing a sibling worktree's path as `<repo>/../<sibling>` mis-resolves when the `..` is anchored on the wrong segment. `C:/Users/jsnov/repos/../wt-1938b` collapses `repos/..` → `C:/Users/jsnov`, yielding `C:/Users/jsnov/wt-1938b` — but the worktree lives at `C:/Users/jsnov/repos/wt-1938b`, so `cd` fails "No such file or directory" mid-land. The repo dir is `…/repos/ai-triad-research`; a sibling worktree at `…/repos/wt-1938b` is `<repo>/../wt-1938b` (i.e. `ai-triad-research/..`), NOT `repos/../wt-1938b`.

**Instances:**
- 2026-07-29 — PowerShell 2 (p/228#8, t/1938 land): `cd "C:/Users/jsnov/repos/../wt-1938b"` failed — the `..` cancelled `repos` (wrong base) instead of the repo dir. Resolved by using the full absolute sibling path with no `..` segments.

**Root Cause:** `..` is resolved lexically against the *immediately preceding* path segment, not against "the repo." When the path is assembled by string-concatenating a base that ends at a different depth than intended, one stray `..` silently retargets to a valid-looking but wrong directory. Worktree lands are especially exposed because the sibling sits one level up from the repo dir but two levels up from `repos/`.

**Prevention:**
1. **For sibling worktrees, write the absolute path directly — no `..` segments:** `C:/Users/jsnov/repos/wt-1938b`, not `<repo>/../wt-1938b`.
2. If you must build it relative, anchor `..` on the **repo dir** (`ai-triad-research/..`), and verify the resolved path (`realpath` / `Resolve-Path`) before `cd`.

**Status:** Resolved — self-correcting (the bad `cd` errors immediately). Single instance; recorded because worktree lands routinely reference sibling paths and the `..`-collapse is a silent retarget, not an obvious typo.

**Applies To:** Any agent building sibling-worktree paths during a `/land-from-worktree` or manual worktree operation.

---

## [Build] Pushing From a Detached-HEAD Worktree Needs a Fully-Qualified Destination Ref

**Pattern:** `git push origin HEAD:<branch>` fails from a **detached-HEAD worktree** with "not a full refname" — with HEAD pointing at a bare commit (no current branch), git can't expand the short destination `<branch>` into a full ref, so the push is rejected. Fix: fully-qualify the destination — `git push origin HEAD:refs/heads/<branch>`.

**Instances:**
- 2026-07-29 — ServerAPI (p/79#19): pushing a feature branch from a detached worktree via `git push origin HEAD:<branch>` failed "not a full refname"; resolved with `git push origin HEAD:refs/heads/<branch>`. Surfaced by the **revised `/land-from-worktree`** (branch-protected PR-flow, owner-approved 2026-07-29), which pushes feature branches from detached worktrees.

**Root Cause:** When the source side of a refspec is `HEAD` and HEAD is detached, git has no current-branch context to disambiguate an unqualified destination like `feature-x` (could be `refs/heads/feature-x`, a tag, etc.), so it refuses rather than guess. A checked-out branch would let git infer `refs/heads/`; a detached HEAD does not. The fully-qualified `refs/heads/<branch>` removes the ambiguity.

**Prevention:**
1. **From a detached-HEAD worktree, always fully-qualify the push destination:** `git push origin HEAD:refs/heads/<branch>`, not `HEAD:<branch>`.
2. This is the sanctioned form for the revised `/land-from-worktree` PR-flow — the playbook (and any land script) should use `refs/heads/` so it works regardless of whether the worktree is on a branch or detached.

**Status:** Resolved — self-correcting (git rejects the un-qualified form immediately). Single instance, but **load-bearing for the revised `/land-from-worktree`** (detached-worktree feature-branch push is now the standard land path) — flagged to the skill owner (TL) so the playbook uses the fully-qualified refspec.

**Applies To:** Any agent pushing a feature branch from a detached-HEAD worktree — i.e. every `/land-from-worktree` PR-flow land.

---

## [Build] `gh pr merge --auto` Fails — Auto-Merge Is Disabled in This Repo

**Pattern:** `gh pr merge <n> --auto ...` fails because **auto-merge is not enabled** on this repository — GitHub rejects the `--auto` flag when the repo setting `allowAutoMerge` is off. Under the checks-only PR-flow the intuitive move is "queue an auto-merge and walk away," but there's no auto-merge to queue; the merge must be issued directly once checks are green.

**Instances:**
- 2026-07-29 — Server Storage (t/1921 Batch B/C, p/206#5): `gh pr merge --auto` failed (auto-merge disabled). Resolved by **polling the PR's checks (Monitor tool, ~30s cadence) until green, then a direct `gh pr merge <n> --rebase --delete-branch`** (no `--auto`).

**Root Cause:** Auto-merge is a per-repo GitHub feature (`allowAutoMerge`) that is currently OFF here. `--auto` asks GitHub to merge *when* checks pass; with the feature disabled the flag is invalid, not merely a no-op. So an agent must own the wait itself: watch checks, then merge.

**Prevention:**
1. **Don't use `--auto`.** Wait for green, then issue the merge directly: `gh pr checks <n> --watch` (or a Monitor-tool poll ~30s) → `gh pr merge <n> --rebase --delete-branch`. This is exactly the `/land-from-worktree` step-4→5 sequence.
2. If a fleet-wide "queue and walk away" is wanted, that's a repo-setting change (enable auto-merge) — an owner/DevOps decision, not a per-land workaround.

**Status:** **SUPERSEDED / STALE (2026-07-29)** — auto-merge was **RE-ENABLED** in this repo; empirically confirmed (PowerShell #158 landed via `gh pr merge --auto`; TaxEditor p/6#29). This "disabled" failure mode no longer applies — retained for history. The current landing caveat is **#108** (`--auto` doesn't auto-update a BEHIND branch under the strict up-to-date rule). (Originally: Resolved/self-correcting flag error, single instance, recorded because the PR-flow makes `gh pr merge` routine.)

**Applies To:** Any agent self-merging a PR under the checks-only PR-flow.

---

## [Build] `gh pr merge --delete-branch` From a Worktree Aborts AFTER the Merge Succeeds — the "fatal" Masks a Landed Merge

**Pattern:** `gh pr merge <n> --rebase --delete-branch` run **from a linked git worktree** aborts with **"fatal: 'main' is already used by worktree"** — but the remote merge has **already succeeded**. `--delete-branch` does a *local* `git checkout main` to clean up the merged head branch, and git forbids checking out `main` when the primary worktree already holds it. So the command exits non-zero on the local-cleanup step *after* the PR is MERGED — a **false-failure signal**: the "fatal" reads as "merge failed" when it actually landed. **This is the exact command `/land-from-worktree` step 5 prescribes**, so every worktree lander hits it.

**Instances:**
- 2026-07-29 — ElectronMain (p/98#12): `gh pr merge <n> --rebase --delete-branch` from a worktree aborted "fatal: 'main' is already used by worktree" **after** the merge completed. Verified `state=MERGED` (`b2e370ff`), then deleted branches + removed the worktree by hand. No loss — the abort was post-merge cleanup only.
- 2026-07-30 — Server Storage (t/2020, p/206#9): **2nd instance** — `gh pr merge <n> --squash --delete-branch` from a worktree hit the SAME "fatal: 'main' is already used by worktree" (gh's post-merge local `checkout main` vs the hub holding main; `--squash` this time). Confirms the failure is **intrinsic to `--delete-branch` from a worktree, independent of the skill's step-5 fix** — it recurs whenever `gh pr merge --delete-branch` is invoked DIRECTLY from a worktree, not via the fixed `/land-from-worktree`. Resolved a different way than #106's drop-`--delete-branch`: **ran `gh pr merge` from the MAIN REPO PATH** (hub holds main → the local checkout succeeds; prevention #4). (Also: when the safety classifier blocks the merge command, hand it to the user to run.)
- 2026-07-30 — Server Storage (t/2020, p/206#11): **3rd instance — a NEW facet that qualifies prevention #4.** `gh pr merge --squash --delete-branch` run **from the main repo path** (per #4): the GitHub merge succeeded, but the **local branch-delete** step failed **"cannot delete branch used by worktree"** — a worktree still had the **head** branch checked out. So running from the main repo path fixes the *checkout-main* conflict but NOT this one: `--delete-branch`'s local `git branch -D <head>` is blocked while any worktree holds that head branch. Fix: **`git worktree remove <path>` FIRST, then `git branch -D <head>`** (remove the worktree holding the head branch before the local delete). Same root family — gh's post-merge LOCAL cleanup vs the one-branch-per-worktree rule — but at the branch-delete step, not the checkout step.
- 2026-08-03 — DevOps (p/26#36): **4th instance, 3rd independent agent — confirms facet 2 / prevention #5.** `gh pr merge --delete-branch` exited 1 with **both** "**already merged**" (the PR had **auto-merged** before the command ran) **and** "cannot delete branch used by worktree" (a worktree still held the branch ref). Resolved by **`git worktree remove --force` FIRST**, after which the branch delete succeeds — **order matters** (prevention #5). The "already merged" signature is a fresh reinforcement of bookkeeping-≠-artifact: exit 1 was *entirely* post-merge cleanup — the merge itself was already DONE, so an exit-1 panic-retry would be wrong. 3rd agent to hit facet 2 (ElectronMain + Server Storage + DevOps).

**Root Cause:** `--delete-branch` cleans up the merged head branch **locally as well as remotely**, and to delete a local branch safely gh switches the working copy to the base branch (`git checkout main`). Git's **one-branch-per-worktree** rule blocks checking out `main` while the primary worktree has it checked out → `fatal`. The remote-side merge and branch delete already happened via the API; only the **local** checkout/cleanup fails. Same false-signal family as the "bookkeeping ≠ artifact" genus — the exit code describes a post-success cleanup step, not the merge.

**Prevention:**
1. **From a worktree, merge WITHOUT `--delete-branch`:** `gh pr merge <n> --rebase`, then delete the branch manually — remote `git push origin --delete <branch>` (or gh's remote delete), local `git branch -D <branch>` from the primary tree. Avoids the base-branch checkout entirely.
2. **Treat the "fatal" as post-merge:** before reacting, verify `gh pr view <n> --json state` == `MERGED` (or the merge SHA on `origin/main`). If merged, **do NOT retry the merge** — it landed; just clean up branches/worktree by hand.
3. **`/land-from-worktree` step 5 should drop `--delete-branch`** (or gate it to non-worktree runs) — the skill runs *from a worktree* by definition, so its prescribed command self-triggers this. Flagged to the skill owner (TL).
4. **Or run `gh pr merge` from the MAIN REPO PATH, not a worktree** (Server Storage p/206#9): the hub/primary checkout holds `main`, so gh's post-merge local `checkout main` succeeds — no checkout-conflict. **Caveat (p/206#11): this is NOT a full escape** — if a worktree still has the PR's HEAD branch checked out, `--delete-branch`'s local `git branch -D <head>` then fails "cannot delete branch used by worktree." So from the main repo path, `--delete-branch` works only once no worktree holds the head branch. (If a safety classifier blocks the `gh pr merge` command, ask the user to run it manually.)
5. **The fully-safe order: `git worktree remove <path>` FIRST, then merge/delete.** Remove the worktree holding the head branch before `--delete-branch` (or before a manual `git branch -D <head>`). This clears BOTH facets — the checkout-main conflict and the branch-used-by-worktree conflict. Simplest rule: drop `--delete-branch` entirely (prevention #1), remove the worktree, then delete the branch by hand.

**Status:** **Skill-path RESOLVED; direct-invocation ACTIVE (recurred 2026-07-30).** TL fixed step 5 (p/8#121): it drops `--delete-branch`, verifies `gh pr view <n> --json state` == `MERGED` (**not the exit code**), and deletes the remote branch by push. **But the failure is intrinsic to `--delete-branch` from a worktree** — Server Storage re-hit it with a DIRECT `gh pr merge --squash --delete-branch` (t/2020, p/206#9), bypassing the fixed skill. So any direct invocation from a worktree re-triggers it; fix by dropping `--delete-branch` (prevention #1/#3) OR running from the main repo path (prevention #4). **3rd instance (p/206#11) surfaced a 2nd facet:** even from the main repo path, `--delete-branch`'s LOCAL branch-delete fails "cannot delete branch used by worktree" if a worktree still holds the head branch → the fully-safe order is `git worktree remove` FIRST, then merge/delete (prevention #5). Was the dangerous variant of the PR-flow defects — the `fatal` reads as failure → panic-retry → double-land. **4th instance (DevOps p/26#36, 2026-08-03) — 3rd independent agent confirms prevention #5** (worktree-remove-first) and adds the "**already merged**" signature (an auto-merged PR whose `--delete-branch` cleanup still exit-1s on the held branch) — reinforcing that exit 1 is post-merge cleanup, not a failed merge. Root cause folded into the "validate a fleet-standard procedure end-to-end before mandating" process lesson.

**Applies To:** Every worktree PR-flow lander — i.e. everyone using `/land-from-worktree` step 5.

---

## [Build] Running `verify` INSIDE a Landing Worktree Dirties the Tree → Rebase Aborts → `--force` Remove Orphans the Unpushed Commit

**Pattern:** In a landing worktree, running the full `npm run verify` (or any build) writes build artifacts (`dist/`, `.tsbuildinfo`, `coverage/`) that **dirty the tree**. A subsequent `git rebase origin/main` then **aborts** ("cannot rebase: you have unstaged changes"). If you then `git worktree remove --force` to clean up, the force-remove **drops the detached-HEAD ref holding your unpushed commit** — orphaning it. The commit isn't destroyed (it survives in the object store until gc), but it's no longer reachable from any ref.

**Instances:**
- 2026-07-29 — Shared Lib (t/1960, p/5#17): full `npm run verify` inside the worktree wrote `dist`/`.tsbuildinfo`/`coverage` → `git rebase` aborted on unstaged changes → `git worktree remove --force` orphaned the unpushed commit. Recovered: the commit survived in the object store (`git cat-file -e <sha>`) → cherry-picked onto a fresh worktree off current origin → pushed. (Windows also gave "Permission denied" on the remove; `git worktree prune` cleared the stale ref — see #78 Facet C.)

**Root Cause:** `verify`/build steps emit untracked+modified artifacts; `git rebase` refuses to run against a dirty tree; and `git worktree remove --force` deletes the worktree — including its detached-HEAD ref — regardless of whether that ref is the sole pointer to an unpushed commit. The three compound: verify dirties → rebase can't proceed → force-remove (to "clean up") discards the only ref to the work. Same family as #72 (verify dirties snapshots) and #78 (worktree-remove hazards); the commit is recoverable ONLY because git retains unreachable objects until gc.

**Prevention:**
1. **Push BEFORE running `verify` in a worktree** — land the commit to origin first, THEN verify (or verify on a throwaway copy). A pushed commit can't be orphaned. (This is also the #107-avoiding form of the #95/#96 "get it onto origin, verify the ref" discipline.)
2. **If you must verify pre-push, clean build artifacts before rebase** — `git stash` or `git clean -fdx` the artifact dirs so the tree is clean, then rebase (pairs with #72: discard verify-dirtied artifacts before rebase/push).
3. **Never `--force`-remove a worktree that holds an unpushed commit** — confirm `git rev-parse origin/main` contains your HEAD (the #95/#96 verify-on-origin check) BEFORE removing; otherwise detach + `git worktree prune`, don't force-destroy.
4. **Recover an orphaned commit by SHA → cherry-pick:** `git cat-file -e <sha>` confirms it survives; `git cherry-pick <sha>` onto a fresh worktree off current origin, then push. `git reflog` / `git fsck --lost-found` finds the SHA if you don't have it.

**Status:** Active — worktree-land cluster; compound of verify-dirties-tree (#72) + force-remove-drops-ref. A near-miss data loss (recovered). Reinforces: push before verify; never force-destroy a ref holding unpushed work; a commit orphaned off all refs is still recoverable by SHA until gc.

**Applies To:** All agents running `verify`/builds inside a landing worktree before pushing.

---

## [Build] On Busy main, `gh pr merge` Bounces a BEHIND Branch (Strict "Up-to-Date" Rule) — `--auto` Does NOT Auto-Update; `update-branch` First

**Pattern:** main's branch protection has the strict **"require branches to be up to date before merging"** rule. A PR that is **behind** origin/main — even when green and mergeable — is **rejected at merge time**: `gh pr merge <n> --rebase` (or `--squash`) bounces with *"head branch is not up to date with the base branch."* Critically, `gh pr merge --auto` does **NOT** fix this — auto-merge only *waits for required checks then merges*; it does **not** rebase/update a behind branch. So on a high-velocity main a behind branch keeps falling further behind and **never lands** on `--auto` alone.

**Instances:**
- 2026-07-29 — Taxonomy Editor (PR #153, p/6#26/#29) + PowerShell (PR #158, same session): `gh pr merge --rebase` bounced "head branch is not up to date" on a GREEN PR; recurred twice. Working recipe: **`gh pr update-branch`** (or rebase onto origin/main + `git push --force-with-lease`, which re-triggers CI), THEN `gh pr merge --auto` — auto-merge grabs the next green window once the branch is current. (Auto-merge IS enabled in this repo as of 2026-07-29 — empirically #158 landed via `--auto`; this supersedes the now-stale "#105 auto-merge disabled".)

**Root Cause:** The strict up-to-date rule requires HEAD to contain the latest base commit before merge; a behind branch is blocked regardless of green checks. GitHub auto-merge *waits for and then merges* once required checks pass — it does not update the branch — so a behind branch under a busy main never satisfies the up-to-date requirement on its own. On fast-moving main this is a livelock: while you wait for a window, main advances and you fall further behind. `--auto` handles the *green-check* wait, not the *up-to-date* update.

**Prevention:**
1. **Get the branch up-to-date, THEN auto-merge:** `gh pr update-branch` (or rebase onto origin/main + `git push --force-with-lease`, re-triggering CI), then `gh pr merge --auto`.
2. **Expect to re-update on busy main** — if main advances again before the green window, re-run `update-branch`. `--auto` won't do it for you.
3. **A `gh pr merge --rebase`/`--squash` bounce with "head branch is not up to date" is the strict-rule signal to update first** — not a defect in your PR.

**Status:** Active — main strict "require up-to-date branch" protection; auto-merge (re-enabled 2026-07-29) covers the green-check wait but not the up-to-date update. Supersedes #105 (auto-merge-disabled, now stale). Recurred twice same session (TaxEditor #153, PowerShell #158).

**Applies To:** All agents landing PRs on main via `gh pr merge`, especially during high-velocity/busy-main periods.

---

## [Build] A Runtime `getProjectRoot()` Calibrated for the Compiled (dist) Layout Mis-Resolves in the vitest SOURCE Context — Anchor Test Paths to `import.meta.url`

**Pattern:** A helper like `getProjectRoot()` that finds the repo/app root by walking up from the **compiled `dist/`** location returns the WRONG directory when the same module runs from **source under vitest** — it stops at `taxonomy-editor/` (the source subtree root) instead of the repo root. A co-located test that reaches a repo-root/shared file via `path.join(getProjectRoot(), 'ai-models.json')` then fails **ENOENT** — the base is wrong, not the file. The helper is correct in production (from `dist`) and wrong in the test's source context: a source-vs-compiled path divergence.

**Instances:**
- 2026-07-29 — ServerAPI (t/1997, p/79#20): a co-located server test read `ai-models.json` (repo root) via `path.join(getProjectRoot(), 'ai-models.json')` → ENOENT, because `getProjectRoot()` resolves to `taxonomy-editor/` in the vitest source context (it only walks to the `/app` root from compiled `dist`). Fix: resolve the repo-root file relative to the TEST FILE via `import.meta.url` — `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../ai-models.json')` — not `getProjectRoot()`.

**Root Cause:** `getProjectRoot()` encodes the DIST directory depth (how many levels `dist/...` sits below the app root). Under vitest the module executes from its SOURCE path, whose depth-to-root differs, so the upward walk stops early — at the app-subtree root (`taxonomy-editor/`), a plausible-looking directory — and the failure surfaces as ENOENT on the joined file, not as an obvious "wrong root." Same source-vs-compiled context divergence family as local≠CI issues (#88/#94): the runtime helper's assumption (compiled layout) doesn't hold in the test harness (source layout).

**Prevention:**
1. **In tests, anchor repo-root/shared-file paths to the test file itself, not a runtime root helper:** `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '<relative-to-repo-root>')`. The test file's own location is stable across source and compiled; a dist-calibrated `getProjectRoot()` is not.
2. **Treat any `getProjectRoot()`/`findUpToRoot()` helper as compiled-layout-specific** — if it walks a fixed depth or looks for a `dist` marker, it mis-resolves when run from source (vitest, tsx). Don't reuse it in tests to reach files outside the module tree.
3. **An ENOENT on a file you KNOW exists ⇒ suspect a wrong base dir, not a missing file** — print the resolved absolute path and compare to the real location before concluding the file is absent (object-level; sibling of the #73 facet-C "valid path looks missing" caution).

**Status:** Active — source-vs-compiled path-resolution divergence; a dist-calibrated root helper mis-resolves under vitest's source context.

**Applies To:** All agents writing vitest tests (especially co-located server/lib tests) that read repo-root or shared files via a runtime root helper.

---

## [Build] A Workflow Gated on "CI Green for the CURRENT main HEAD" Can't Be Dispatched On-Demand on a Busy main — the Gate Races the Advancing HEAD

**Pattern:** `container.yml` (build + Trivy scan) is gated on `ci-gate` — it requires `ci.yml` to be GREEN for the **current `main` HEAD** before it runs. On a high-velocity `main`, an on-demand `gh workflow run container.yml` can **never win the race**: each dispatch resolves whatever HEAD is current *at dispatch time*, whose `ci.yml` is still **in-progress** (or `main` advances again before it finishes) → the gate reports `test-container not found / in_progress` and the run no-ops. The gate is **unsatisfiable on demand** because the precondition (current-HEAD CI green) is a moving target on a busy branch.

**Instances:**
- 2026-07-29 — Docker (t/2006, p/217#3): trying to force an on-demand **app-image Trivy rescan** to clear code-scanning alerts, repeated `gh workflow run container.yml` dispatches each hit `test-container not found/in_progress` — `main` advanced faster than any single HEAD's CI completed. **Consequence:** you **cannot** force an on-demand app-image rescan; the app-image code-scanning alerts **auto-clear only on the next `v*` tagged release build** (which pins a HEAD and runs the full gate). **Workaround:** dispatch `base-image.yml` (not current-HEAD-gated) to prove the suppression on the BASE image, and **report the app-image residual as auto-clearing on the next release** rather than chasing the gate.

**Root Cause:** A "current-HEAD CI green" precondition is satisfiable only when `main` stays quiescent long enough for one HEAD's CI to finish before the next commit lands — false on a busy multi-role `main`. The dispatched workflow re-resolves `main` HEAD at run time, so it is always chasing a newer, still-building commit. Same **busy-main advancing-HEAD livelock** as #108 (`gh pr merge` on a behind branch never satisfies the strict up-to-date rule): mechanism differs (workflow-gate vs merge-gate) but the shape is identical — a per-HEAD precondition can't converge while HEAD keeps moving.

**Prevention:**
1. **Don't chase a current-HEAD-gated workflow on a busy `main` — it can't win.** For on-demand verification, dispatch a workflow that is NOT gated on the moving HEAD (e.g. `base-image.yml`), or pin a specific ref if the workflow supports it.
2. **For an app-image scan/suppression, report the residual as auto-clearing on the next `v*` release** (which pins a HEAD and runs the full gate) — state it as expected behavior, not an open failure to chase.
3. **Recognize the signature:** repeated dispatches reporting `<gate-job> not found / in_progress` on a busy branch = the gate is racing the advancing HEAD, not a broken workflow. Stop retrying; use the base-image / next-release path. (Sibling of #108.)

**Status:** Active — busy-main advancing-HEAD livelock (workflow-gate variant of #108); on-demand current-HEAD-gated dispatch is unsatisfiable on a high-velocity `main`. Also in memory (`reference_trivy_cve_remediation`).

**Applies To:** All agents dispatching current-HEAD-CI-gated workflows (container.yml / Trivy rescan) on a busy `main`; anyone trying to force an on-demand app-image security rescan.

---

## [Build] Green Required `ci-gate` ≠ All Checks Green — a Non-Required Check (CodeQL) Can Be RED While the Merge Gate Passes; Confirm Check-Run Conclusions Before Self-Merge

**Pattern:** Branch protection requires a single context, `ci-gate`. **CodeQL runs as a SEPARATE, non-required check-run.** So a PR can show a **green `ci-gate`** (and `gh pr checks` can exit 0 for the required set) while **CodeQL is RED with a high-severity finding** — and self-merge proceeds, landing the vulnerability. "Required gate green + `gh`-checks-exit-0" describes only the REQUIRED subset, not all checks; a non-required security check failing is invisible to that signal.

**Instances:**
- 2026-07-30 — Shared Lib (t/2014, landed b815724b): a temp-file default `path.join(os.tmpdir(), '<predictable-name>')` tripped CodeQL **`js/insecure-temporary-file` (high sev)**. It **passed the sole required `ci-gate`** (CodeQL is a separate non-required check), so green-ci-gate + gh-checks-exit-0 wasn't sufficient — the finding surfaced only by reading the CodeQL check-run explicitly. **Code fix:** `fs.mkdtempSync` (randomized temp dir) instead of a predictable `os.tmpdir()`-joined name. **Process fix:** before self-merge, confirm the CodeQL check-run conclusion EXPLICITLY, and read a failing check's `output.title` rather than assuming it's a config stub.

**Root Cause:** The merge gate (`ci-gate`) is a *subset* of a PR's checks by design; security scanners like CodeQL are intentionally non-required (advisory / can lag / run async). Treating "the required gate is green" as "all checks pass" is a gate-signal-integrity failure (**bookkeeping ≠ artifact**): the required-gate conclusion is a PROCESS signal that does not cover the security check's actual result. Compounded by assuming a red check is "just the config stub" instead of reading its `output.title` — so a real high-sev finding gets waved through. Same "the check that governs your code lives outside the gate you ran" shape as #94.

**Prevention:**
1. **Before self-merge, confirm ALL check-run conclusions, not just the required gate** — `gh pr checks <n>` (every check + conclusion) or `gh api repos/:owner/:repo/commits/<sha>/check-runs`. A green `ci-gate` with a red CodeQL is a landable vulnerability; don't equate "required gate green / `gh pr checks` exit 0" with "all checks green."
2. **Read a failing check's `output.title`/summary — don't assume it's a benign stub.** CodeQL's title names the rule + severity (e.g. `js/insecure-temporary-file`, high); confirm before dismissing.
3. **Temp files: use `fs.mkdtempSync(path.join(os.tmpdir(), prefix))` (randomized dir), never a predictable `path.join(os.tmpdir(), '<fixed-name>')`** — the predictable form is CodeQL `js/insecure-temporary-file` (high). A recurring CodeQL high worth knowing before you write the temp path. **Downstream ripple (Server Storage t/2020):** `mkdtempSync` appends a RANDOM suffix, so a test asserting the exact name breaks — `.endsWith('manifest.json.tmp')` must become `.includes('manifest.json.tmp')` (or a regex). Adopting the security fix means loosening any exact-temp-name assertions.
4. **The durable fix is to make the scanner a REQUIRED check — but in DIFFERENTIAL mode (fail on NEW alerts only, not the backlog).** A checklist step ("remember to check CodeQL") is memory-dependent (#82 rule-not-applied) — the structural gate is the real fix. But a blanket "CodeQL must be green" on a repo with a pre-existing alert backlog (~108 here) false-reds every PR; **differential mode** (fail only on alerts the PR introduces) is what makes a lagging/advisory scanner a usable required gate.

**Status:** Active — gate-coverage gap (required `ci-gate` ⊊ all checks) surfaced by a concrete CodeQL high (predictable temp file). Sibling of the escalated "Gate Signal Integrity" rule and the bookkeeping-≠-artifact genus; relates to #94. Self-merge is fleet-wide now, so confirming non-required security check-runs before merge is a general habit, not a one-off. **Escalated → DISPOSITIONED (TL p/8#137):** (1) interim — a "confirm the CodeQL check-run, not just ci-gate" step added to the Wave-2 self-merge flow now (t/2001#3), covering the window; (2) durable — **t/2025 (DevOps, high): make CodeQL a REQUIRED check in DIFFERENTIAL mode** (fail on new alerts only, per prevention #4). Structural required-gate is the real fix; the interim checklist line is the memory-dependent stopgap until it lands. t/1589 gate-integrity genus.

**Applies To:** All agents self-merging PRs under the checks-only gate — especially confirming CodeQL/security check-runs; and anyone writing temp files in JS/TS.

---

## [Build] `gh api` Auto-Switches to POST When Any `-f`/`-F` Field Is Passed — 404 on a GET-Only Endpoint; Use a Query String or `-X GET`

**Pattern:** `gh api` defaults to GET, but **switches the HTTP method to POST the moment any `-f`/`-F` (`--field`/`--raw-field`) is passed** — the fields become a request BODY, not query params. So `gh api ".../code-scanning/alerts" -f state=open -f tool_name=CodeQL` **POSTs** to a **GET-only** endpoint → **404**. The 404 misleads toward "wrong URL / missing resource" when the real fault is the verb.

**Instances:**
- 2026-07-30 — Server Auth (p/303#1): the CodeQL-alert-pull command **templated into the Wave-2 security tickets** — `gh api ".../code-scanning/alerts" -f state=open -f tool_name=CodeQL` — returned **404** because the `-f` fields flipped it to POST on a GET-only endpoint. **Affects every Wave-2 subticket using the same template** (broad blast radius, ~7 roles). **Fix:** put params in the query string with a plain GET — `gh api ".../code-scanning/alerts?state=open&tool_name=CodeQL" --paginate --jq '…'`.

**Root Cause:** `gh api`'s method is implicit: no fields → GET; any `-f`/`-F` → POST (fields sent as a body). Documented, but easy to miss — the same `-f key=val` idiom that adds *query params* in many CLIs adds a *POST body* here. On a GET-only REST endpoint (list code-scanning alerts) the POST 404s. A templated command carrying this bug propagates the failure to every consumer — the "validate a shared/templated procedure before mandating it" failure (#102).

**Prevention:**
1. **For a GET endpoint with params, use the query string, not `-f`:** `gh api "<path>?k1=v1&k2=v2" --paginate --jq '…'`. Or force the method while keeping `-f`: `gh api -X GET "<path>" -f k1=v1 -f k2=v2` (with `-X GET`, `gh` puts the fields in the query string instead of a body).
2. **A `gh api` 404 on an endpoint you KNOW exists ⇒ suspect an unintended POST from `-f`/`-F`** — check the method before doubting the path (object-level: the endpoint isn't missing, the verb is wrong).
3. **Verify a `gh api` command before templating it into tickets/skills** — a method bug in a template propagates to every consumer (here, all Wave-2 subtickets). Ties to #102 (validate a fleet-standard/templated procedure end-to-end before mandating it).

**Status:** Active — `gh api` implicit-method gotcha; high blast radius via the Wave-2 ticket template (t/2001). Sibling of #102 (bug-in-a-template propagates). **DISPOSITIONED (TL p/8#139):** corrected CENTRALLY at t/2001#4 (both `-X GET` and query-string forms) for all Wave-2 owners — NOT rewriting the 7 inline commands. **Remediation-depth nuance (TL):** this fails LOUD (a self-evident 404 with the fix documented at the epic), so a *central* correction is proportionate — each consumer sees the failure and finds the fix. Contrast SILENT-failure templated bugs (moonshot misroute, CodeQL-non-required-gate #112) where consumers get a wrong result with no error, so an *at-source per-consumer* fix is essential. General rule captured in #102.

**Applies To:** All agents scripting `gh api` against GET endpoints with params (code-scanning alerts, list APIs) — especially commands templated across tickets/roles.

---

## [Build] Greedy `<[^>]+>` Tag-Stripper Matches DECODED Entities (`< 2 >` from `&lt;2&gt;`) — Anchor the Tag-Start When You Decode-Before-Strip

**Pattern:** When you DECODE HTML entities BEFORE stripping tags, a greedy tag-stripper `<[^>]+>` matches literal `<…>` sequences the decode produced from `&lt;`/`&gt;` — e.g. decoded `< 2 >` (from `&lt; 2 &gt;`) looks like a tag and gets stripped, corrupting the text. Once entities are decoded the regex can't tell a real tag from decoded angle-bracket content.

**Instances:**
- 2026-07-30 — Server Storage (t/2020, p/206#6): after decoding entities, `<[^>]+>` matched `< 2 >` (from decoded `&lt;`/`&gt;`) and stripped it. Fixed by anchoring the tag-start to a valid tag-name char: `<[a-zA-Z\/!][^>]*>` (a real tag starts with a letter, `/`, or `!`). Decode-first requires the tighter anchor.

**Root Cause:** entity decoding turns `&lt;2&gt;` into literal `< 2 >`, which a permissive `<[^>]+>` reads as a tag. A real HTML tag's first char after `<` is a letter (element), `/` (close tag), or `!` (comment/doctype) — never a space or digit; `<[^>]+>` doesn't encode that constraint. Order matters: strip-before-decode sidesteps it, but if you must decode first, the stripper needs the start anchor.

**Prevention:**
1. **Stripping tags AFTER decoding entities: anchor the tag-start** — `<[a-zA-Z\/!][^>]*>`, not `<[^>]+>` (a real tag never starts with a space/digit).
2. **Prefer strip-before-decode** where possible (strip tags on the still-encoded text, then decode) so decoded angle brackets can't be mistaken for tags.
3. For any regex over decoded/user text, constrain the START token to what's actually valid — don't rely on a permissive `[^>]+`.

**Status:** Active — decode-order parsing gotcha; a permissive tag-strip regex corrupts decoded angle-bracket content.

**Applies To:** All agents stripping HTML tags from text that has been (or will be) entity-decoded.

---

## [Build] A Resource Allocated BEFORE the `try` Leaks When a Later Statement Throws — Allocate Inside the `try`

**Pattern:** Allocating a resource (temp dir via `mkdtemp`, a file handle, a lock, a connection) on a line BEFORE the `try` means a throw from a later statement (e.g. `writeFile`) unwinds without the block's cleanup running for it — the resource leaks. The allocation and the code that can throw must be in the SAME `try` for `catch`/`finally` cleanup to cover it.

**Instances:**
- 2026-07-30 — Server Storage (t/2020, p/206#6, **caught by the security reviewer**): `mkdtemp` was called BEFORE the `try`; if `writeFile` inside the block threw, the temp dir leaked (never cleaned up). Fixed by moving the `mkdtemp` inside the `try`. Lesson: any async I/O that ALLOCATES a resource belongs inside the `try`, so a subsequent throw triggers its cleanup.

**Root Cause:** `try/catch/finally` only governs statements within the `try`. A resource acquired before the `try` is outside the cleanup scope — a later throw unwinds past it without releasing it. This is a resource-lifecycle bug, distinct from the error-MESSAGE convention (ActionableError): it's about WHERE you acquire, not how you report.

**Prevention:**
1. **Acquire the resource INSIDE the `try`** whose `catch`/`finally` releases it — never on a line before it.
2. **Pair every allocation with cleanup in the same block** — for temp dirs, a `finally { await rm(dir, {recursive:true, force:true}) }`.
3. **Review check:** confirm resource-allocating I/O (`mkdtemp`, `open`, acquire-lock) sits inside the guarded block, not preceding it. (A security reviewer caught this one — a good standing review question.)

**Status:** Active — resource-leak-on-throw; an allocation outside the `try` escapes cleanup.

**Applies To:** All agents writing resource-allocating async I/O (temp dirs, file handles, locks) with try/catch/finally cleanup.

---

## [Build] A Foreground `sleep`-Poll Loop (waiting for a PR merge / external state) Blows the 2-Minute Bash Cap — Use a Background Monitor + One Direct State Check

**Pattern:** An inline foreground poll loop — `for i in $(seq 1 12); do gh pr view …; sleep 20; done` — waiting for an external state change (PR merge, CI run, deploy) runs for minutes and gets **killed at the Bash tool's 2-minute cap (exit 143)**. A foreground `sleep`-loop is structurally the wrong tool for a wait that can exceed 2m — it's guaranteed to time out.

**Instances:**
- 2026-07-30 — DevOps (p/26#25): a `for i in $(seq 1 12); do gh pr view; sleep 20; done` poll waiting for a PR merge **timed out (exit 143)** at the 2m cap; also violated the standing "never foreground loop-poll `gh`" rule. Fix: a **`run_in_background` monitor** (sanctioned — runs past 2m and re-invokes on completion) plus a **single direct `gh pr view <n> --json state` check** for a point-in-time answer.

**Root Cause:** the Bash tool caps foreground commands at ~2 minutes; a sleep-poll loop is *designed* to run longer, so any wait > 2m hits the cap and SIGTERMs. Same **"foreground op > 120s → killed → background it"** genus as #78 (worktree-remove rm) and #95 (large push) — here the "long op" is an intentional wait loop. A background task is the sanctioned escape: it survives past 2m and notifies on exit; foreground polling never should.

**Prevention:**
1. **Never foreground-poll in a `sleep`-loop for external state (PR merge, CI, deploy).** Put the wait in a `run_in_background` monitor (survives past 2m, re-invokes on completion) and do a **single direct state check** (`gh pr view <n> --json state`) when you need a point-in-time answer.
2. **If you must check inline, do ONE check, not a loop** — if it's not ready, background the wait rather than sleeping in the foreground.
3. Genus rule: any foreground op that can exceed ~2m (huge-tree rm #78, large push #95, poll loops) belongs in the background; the foreground is for bounded-fast commands only.

**Status:** Active — poll-loop variant of the "foreground long op > 120s Bash cap → background it" genus (#78/#95). Standing rule: never foreground loop-poll `gh`.

**Applies To:** All agents waiting on external state (PR merge, CI, deploy) from the Bash tool.

---

## [Build] A Green (Differential) CodeQL PR Check ≠ a PRE-EXISTING Alert Is Fixed — Verify a Fix on the Post-Merge MAIN SAST Scan, Not the PR Check or Branch-Ref Query

**Pattern:** CodeQL's PR check-run is DIFFERENTIAL — it fails only on NEW alerts the PR introduces and passes (green) regardless of whether the PR's intended fix actually cleared a **pre-existing** alert. So a green CodeQL check does NOT confirm a pre-existing alert is resolved. Worse, the PR/branch-ref alerts query (`code-scanning/alerts` filtered to the PR's ref) returns **empty unreliably**, which reads as "no alerts → cleared" and misleads you into reporting a fix landed when it hasn't. The authoritative signal is the **post-merge MAIN-branch SAST scan** (the full re-scan that re-evaluates the whole backlog).

**Instances:**
- 2026-07-30 — ServerAPI (t/2019): reported a pre-existing CodeQL alert "cleared" based on a **green PR check + an empty branch-ref alerts query** — but the differential check only gated NEW alerts, and the branch-ref query was unreliably-empty. The fix's real effect had to be confirmed on the **post-merge MAIN SAST scan**. Also hit: the code-scanning **dismiss API caps `dismissed_comment` at 280 chars (HTTP 422 over)** → keep terse, reference the ticket.

**Root Cause:** differential CodeQL (the t/2025 / #112 design — fail on NEW alerts only, not the ~108-alert backlog) is calibrated to NOT block on pre-existing alerts, so by design a green check says nothing about them. The branch-ref alerts API is ref-scoped / eventually-consistent and returns empty spuriously. Confirming a pre-existing-alert fix therefore requires the full MAIN scan (re-evaluates the backlog), not the PR-scoped differential signal. Flip side of #112: **#112** = a green required gate hides a NEW alert; **#117** = a green differential check falsely implies a PRE-EXISTING alert is fixed. Both stem from "the CodeQL PR signal is new-only/differential."

**Prevention:**
1. **To confirm a fix cleared a PRE-EXISTING CodeQL alert, verify on the POST-MERGE MAIN SAST scan** — NOT the PR check-run (green = no new alerts, says nothing about the backlog) and NOT the branch-ref alerts query (returns empty unreliably). **Confirm the SPECIFIC alert's state on main:** `gh api repos/:owner/:repo/code-scanning/alerts/<n> --jq .state` → must read `fixed` or `dismissed` (TL t/2001#11).
2. **Don't report a pre-existing alert "cleared" from a green PR check or an empty branch-ref query.** Wait for main's scan, or the alert's state flipping to `fixed`/`dismissed` on the MAIN-ref query.
3. **Dismissing a code-scanning alert: `dismissed_comment` caps at 280 chars** (HTTP 422 over) — keep it terse and reference the ticket.

**Status:** Active — flip side of #112 (a green differential CodeQL check says nothing about the pre-existing backlog); high-relevance to Wave-2's backlog-clearing (t/2001, 83 pre-existing highs). Ties to the t/2025 differential-mode gate. **DISPOSITIONED (TL p/8#142):** sharpened into durable Wave-2 guidance at **t/2001#11** (amending #3) — a pre-existing high is "fixed" ONLY when the post-merge MAIN scan shows `fixed`/`dismissed`, never inferred from a green differential PR check or the flaky branch-ref query; confirm the specific alert via `gh api …/alerts/<n> --jq .state`. The 280-char `dismissed_comment` full rationale lives in a co-located code comment, the API comment being a terse pointer. Generalizes ServerAPI's self-correction into a rule for the remaining fixes (t/2018 especially).

**Applies To:** All agents clearing/dismissing pre-existing CodeQL alerts (Wave-2 security work) — verify fixes on the MAIN scan; keep dismiss comments ≤280 chars.

---

## [Build] A Platform Feature Can Be AVAILABLE While a Specific MODE/Tier of It Is Plan-Gated — Verify the Exact MODE Empirically Before Designing Around It

**Pattern:** A GitHub (or any platform) feature may work on your repo while a specific MODE, tier, or sub-option of it is silently plan-gated — surfacing HTTP 422 only when you invoke that mode. Designing a gate/workflow around the plan-gated mode fails at implementation time, *after* you've built around it. The availability trap has **granularity**: "the feature works" ≠ "every mode of it works on this repo's owner-type/plan."

**Instances:**
- 2026-07-30 — DevOps (t/2025, p/26#27): creating a GitHub `code_scanning` **ruleset** succeeded, but in **`evaluate` enforcement mode** (non-enforcing dry-run) it returned **HTTP 422** — the `evaluate` MODE is **Enterprise-plan-only**; the rule TYPE and `active`/`disabled` modes work fine on this public user-owned repo. Pivoted the gate-verification to the **check-run level** (throwaway PRs vs main, read `statusCheckRollup`) instead of a non-enforcing ruleset. The trap was on the MODE, not the feature.
- 2026-07-29 — (t/1968, Sage memory `feedback_verify_feature_availability_empirically`): GitHub **merge queue** is **org-only**, not "any public repo" — an availability trap at the **FEATURE** level (a user-owned repo can't use it at all); burned an eval + a landed trigger. The feature-level sibling of the mode-level trap above.

**Root Cause:** platform features are gated at multiple granularities — feature (merge queue: org-only), mode/tier (ruleset `evaluate`: Enterprise-only), option — and the gating is invisible until you invoke the exact combination on the exact repo (`owner_type` + plan). Designing around a plan-gated mode before verifying it against THIS repo means the failure surfaces at build time, after the design is committed. Same "verify feature availability empirically for THIS repo" discipline (t/1968), **refined to MODE granularity**.

**Prevention:**
1. **Before designing a gate/workflow around a platform feature's MODE/tier, verify THAT EXACT MODE empirically on THIS repo** — create it (or confirm docs' `owner_type`/plan gating) — not just that the feature exists.
2. **Availability gating has granularity** — feature (t/1968 merge-queue org-only) vs mode/tier (t/2025 ruleset `evaluate` Enterprise-only). Check at the granularity you'll actually use, on this repo's owner-type + plan.
3. **When a mode is plan-gated, pivot to a plan-agnostic equivalent** — e.g. verify gates at the **check-run level** (throwaway PRs vs main, read `statusCheckRollup`) instead of a non-enforcing ruleset.

**Status:** Active — platform-availability trap at MODE granularity; refines the t/1968 feature-level availability lesson. Verify the specific mode/tier empirically for THIS repo (`owner_type` + plan) before designing around it.

**Applies To:** All agents designing gates/workflows around GitHub (or any platform) features whose modes/tiers may be plan-gated — especially on a user-owned public repo.

---

## [Build] A Build-Only Container CI Gate Never RUNS the Image — a Startup/Readiness Crash Passes Green (build ≠ runs); P1 Prod Outage

**Pattern:** A container CI gate that **builds** the image but never **starts** it cannot catch a startup/readiness failure — the build is green, so a crash-looping image reaches prod. "The image built" is bookkeeping; "the image comes up healthy" is the artifact (gate-integrity genus, t/1589: **build ≠ runs**, sibling of #94 build≠suite-runs and #112 green-required-gate≠all-checks). A **P1 prod outage** because three gate/safety-net gaps compounded — each individually survivable, together an outage instead of a blip.

**Instances:**
- 2026-07-30 — P1 PROD OUTAGE (TL p/8#146, anchor t/2047; fix DAG t/2048–2052 + PR #297): a **Dependabot base-image bump** (`ai-triad-base :2026-07-20 → :07-30`, commit `0b33fc18`) **crash-looped prod** — the app inited fully but `httpGet /healthz` **self-503'd on the new base** (readiness/data-loaded gate failed). Three compounding process failures: **(1)** the container CI gate is **build-only — it never RUNS the image**, so a startup crash passed green; **(2)** the **auto-rollback target had been garbage-collected** → the rollback was a **no-op** → the incident escalated from a blip to an outage; **(3)** **Dependabot base bumps reach prod with zero runtime validation.** Prod restored; fix DAG filed.
- **ROOT CAUSE — CORRECTED (TL p/8#152, Docker single-variable A/B t/2053#12/#13/#15):** the actual cold-start crash cause is **t/2061 — a `CACHE_DIR`/readiness CODE bug introduced after the healthy `efd068fe` build**, NOT the base image. The initially-flagged **undici / Node-22.23.2-TLS mechanism was a CONFOUND**: Docker's single-variable A/B shows `:07-30` reaches `/healthz` **200 WITHOUT** the undici fix once t/2061 is present → undici did not cause the crash. The base-image bump (`0b33fc18`) and the code bug (t/2061) BOTH changed between the healthy and crashing builds, so the scarier-looking base/CVE variable got wrongly blamed until A/B isolation. **undici stays only as defense-in-depth** (may bite under sustained TLS-reuse — unproven). The floating-base-tag pin (prevention #5) and SBOM-diff (prevention #6) remain good hygiene, but neither was the cause. **Diagnostic that resolved it: a single-variable A/B** (hold t/2061 present, toggle only the undici fix) — see prevention #7.
- **(superseded) initial mechanism hypothesis:** a floating `FROM node:22-bookworm-slim` shipping 22.23.2/undici-6.28.0 TLS on rebuild → global-`fetch()` break → `/tmp` cache empty → `/healthz` 503. Recorded here as the confounded hypothesis that the A/B overturned; SBOM-diff (daemon-down) surfaced the 22.23.1→.2 delta that made it *look* causal.

**Root Cause:** the CI container gate validated *buildability*, not *runnability* — the exact "build ≠ runs" gap of the gate-integrity genus. A `/healthz` readiness probe that depends on the base image's runtime (data-load path) can pass in build/unit contexts and fail only when the real image boots, so nothing short of *starting the built image and hitting its health endpoint* would have caught it. Compounded by two silent safety-net holes: a rollback whose target no longer existed (GC'd) **no-ops without erroring** (["rollback configured" ≠ "rollback target exists"], bookkeeping≠artifact), and an **auto-merged dependency bump** (Dependabot) that reaches prod on the same build-only gate with no runtime step — so an automated change with prod blast-radius had zero runtime validation anywhere in its path.

**Prevention:**
1. **A container gate must RUN the built image and hit its health endpoint, not just build it** — boot the image, `httpGet /healthz` (or the real readiness probe), fail the gate on non-200. Build-green is not deploy-safe; only a smoke-boot proves the image comes up. (Generalizes t/1589 build≠runs to the container/deploy gate.)
2. **Compounding factor A — a rollback target can be GC'd, making rollback a silent no-op.** "Auto-rollback configured" ≠ "a valid rollback target exists." Pin/retain the last-known-good image (protect it from GC/retention) and **verify the rollback actually reverted** (health-check post-rollback), don't trust that it fired. A no-op rollback turns a blip into an outage.
3. **Compounding factor B — automated dependency bumps (Dependabot), especially BASE-IMAGE bumps, reach prod with prod blast-radius; gate them with runtime validation.** A base-image bump changes the runtime out from under the app; require the run-the-image smoke-boot (prevention #1) on Dependabot PRs before they can merge/deploy — don't let an auto-bump reach prod on a build-only gate.
4. **Readiness/`/healthz` self-503 on a base bump = the base's runtime changed under the app** (data-load path, lib versions, entrypoint) — when a base bump crash-loops, suspect the readiness gate's runtime dependencies, and diff the base image, not just the app code.
5. **Base-image hygiene (NOT the root cause here — see correction) — a FLOATING base tag makes every rebuild a silent, unpinned dependency bump.** `FROM node:22-bookworm-slim` (floating minor) pulls whatever patch is current at rebuild time. **Pin the base patch version in `Dockerfile.base`** (explicit, reviewable bumps) so a runtime change is a deliberate PR, not a rebuild side effect. Good hygiene + defense-in-depth; in THIS incident it was a confound, not the cause.
6. **Diagnostic — daemon down? diff the SBOM artifacts** for the exact package delta. Caveat learned here: an SBOM delta shows what *changed*, not what *caused* the failure — it surfaced the undici delta that turned out to be a confound. Use it to enumerate candidates, then ISOLATE (prevention #7), don't attribute from the delta alone.
7. **When the good→bad transition spans a MULTI-VARIABLE change, isolate the true cause with a single-variable A/B — don't attribute to the scariest-looking variable (a CVE/base bump).** Here both a code change (t/2061) and a base/undici bump landed between the healthy `efd068fe` and the crashing build; the CVE looked causal but a single-variable A/B (hold t/2061 present, toggle only undici) proved `:07-30` reaches `/healthz` 200 without the undici fix → undici was a confound, the code bug was the cause. Object-level root-cause discipline (#44/#54/#55 family, applied to incident RCA): confirm by controlled test, not by plausibility; mark a mechanism **hypothesized** until isolated. **Why this is a STRUCTURAL fix, not "be more careful" (TL p/8#155):** the confound fooled the ENTIRE expert chain simultaneously — TL (who built the t/2053 hard gate on the undici attribution), DevOps, Server Storage, AND Sage all ran with it. A plausible scary variable (a CVE) defeats independent-diligence-by-many because everyone anchors on the same salient culprit; only a controlled single-variable test breaks the shared anchor. Docker's single-variable A/B is the exemplar to cite. So the rule is structural: *isolate before attributing*, not "think harder."

**Status:** Active — **P1 prod outage, resolved (prod restored); fix DAG t/2048–2052 + PR #297, anchor t/2047.** Gate-integrity genus (t/1589 build ≠ runs) — the container/deploy-gate instance of the same family as #94 (build ≠ suite runs) and #112 (green required gate ≠ all checks green). The severity came from three compounding gaps (build-only gate + GC'd rollback no-op + unvalidated auto-bump to prod), each a bookkeeping-≠-artifact hole; the durable fix closes all three (run-the-image gate, protected rollback target + verify-reverted, runtime-gated Dependabot) **plus base-tag pinning as hygiene**. **ROOT CAUSE CORRECTED (TL p/8#152, t/2053#12/#13/#15):** actual cause = **t/2061 (a `CACHE_DIR`/readiness code bug after healthy `efd068fe`)**; the **base-image bump / undici-TLS mechanism was a CONFOUND** (both variables changed good→bad; a single-variable A/B showed `:07-30` = `/healthz` 200 without the undici fix), undici retained only as unproven defense-in-depth. The build≠runs + gate-integrity lessons are UNAFFECTED (the primary pattern was never the specific mechanism). **Shared over-attribution, not an individual lapse (TL p/8#155, systems-not-blame):** the whole chain — TL (built the t/2053 gate on it), DevOps, Server Storage, and Sage — all ran with the undici attribution; a scary CVE anchored everyone at once. The lesson is structural (prevention #7: mark mechanisms hypothesized until single-variable-isolated), not "someone should have been more careful." The correction landed fast and cleanly — the system working. **Fix validated — strongest "build ≠ runs" evidence yet (TL p/8#149):** the new docker-run smoke (t/2048), on its **FIRST real run**, caught a **pre-existing SILENT deploy-freeze** the build-only gate had been hiding — current main was **undeployable on BOTH bases** (a node-agnostic readiness bug, t/2061), prod surviving only on an older image. The build-only gate wasn't just masking the one Dependabot bump — it had left main un-deployable with no signal; the run-the-image gate surfaced it on day one. (This incident also produced 2 concurrent dup-ticket pairs → see the "Concurrent Duplicate Ticket-Filing" process pattern, variant B.)

**Applies To:** All agents/owners of container CI, deploy gates, rollback automation, and Dependabot/dependency-bump policy — especially base-image bumps with prod blast-radius.

---

## [Build] `gh pr checks` Exits Non-Zero (8) When a Check Is PENDING — Not a Failure; Re-Poll, Don't Abort

**Pattern:** `gh pr checks <n>` returns a **tri-state exit code**: `0` = all passed, `1` = a check FAILED, **`8` = one or more checks still PENDING/queued**. So a green-so-far PR with one slow check still running (e.g. `test-container`) exits **8** — non-zero, but nothing failed. A caller that branches on "non-zero = failure" conflates *pending* with *failed* and may wrongly abort a land.

**Instances:**
- 2026-08-01 — Server Storage (p/206#13, re-confirmed p/206#14): `gh pr checks 326` exited **8** because `test-container` was still running; **no check actually failed**. Recognized as expected `gh` behavior; **re-polled once `test-container` completed** → green. (Two reports same session — the exit-8 = pending semantics catch people.)

**Root Cause:** `gh pr checks`'s exit code encodes STATE, not a pass/fail boolean — exit 8 specifically means "not done yet." Same "exit code is a status indicator, not success/failure" family as #73 facet A (grep exit-1 on zero-match ≠ error). It bites hardest during a self-merge wait, when a slow check (`test-container`) hasn't finished but every other check is green — the raw exit looks like failure. **Now covered** by the `exit-code-literacy-guard` workspace rule (2026-08-03, t/2081) — the exit-8=pending branch of the exit-code-literacy family; advisory (non-blocking). **Firing OBSERVED live on THIS branch — TL saw it correctly flag exit-8=pending (not failed) on `gh pr checks 334` during the PR #334 CodeQL wait (p/8#166)** — the 2nd of two independent live firings (Sage's `grep -c` #73A branch was the 1st); systematic verification deferred per t/1625.

**Prevention:**
1. **Don't read `gh pr checks` non-zero as "failed" — distinguish exit `8` (PENDING → re-poll) from exit `1` (FAILED → stop).** Branch on the specific code, or better, on the actual per-check state.
2. **Parse the per-check state, not just the exit code** — `gh pr checks <n> --json name,state,conclusion --jq '...'` gives real states (`IN_PROGRESS`/`QUEUED` vs `FAILURE`); the raw exit code alone can't tell pending from failed to a naive branch.
3. **On a self-merge wait, exit 8 = "not done, re-poll"** — re-run once the pending check completes (or use a background monitor, #116); don't abort the land.

**Status:** Active — `gh pr checks` tri-state exit-code semantics (0 pass / 1 fail / 8 pending); "exit code ≠ pass/fail boolean" family (#73A). Self-correcting once recognized. CI-wait sibling of #111 (current-HEAD-gated workflow) and #116 (background monitor, not foreground poll).

**Applies To:** All agents polling `gh pr checks` while waiting on PR checks (self-merge / land waits).

---

## [Build] A Subprocess-Per-File Bash Loop Over the Whole Tree Times Out on Git Bash/Windows — Use Parameter Expansion, Not `$(cmd)` Per Item

**Pattern:** A bash loop that spawns a subprocess PER FILE — e.g. `$(dirname "$f")` (or `$(basename)`, `$(echo | sed)`) inside a loop over `git ls-files` (~thousands of files) — spawns tens of thousands of subprocesses. On **Git Bash/Windows, process spawn is pathologically slow** (fork/exec emulation), so the loop **blows the 2-minute Bash-tool timeout (exit 143)** on a few-thousand-file tree. The same loop is fast on Linux (cheap fork) — a **Windows-specific perf cliff**, invisible in Linux CI.

**Instances:**
- 2026-08-01 — DevOps (t/2091, p/26#31): a CI script built a tracked-dir set via a **`$(dirname)` subshell loop over `git ls-files` (~3k files)** → tens of thousands of subprocess spawns → **timed out (>2 min)** on Git Bash/Windows. Fixed with **pure-bash ancestor extraction via parameter expansion** — `while [[ $d == */* ]]; do d=${d%/*}; done` (zero subprocesses) → **47s**.

**Root Cause:** each `$(...)` / backtick command substitution **forks a subprocess**; on Windows Git Bash, fork/exec is emulated and ~orders of magnitude slower than native, so N-thousand spawns dominate wall-clock. Bash **parameter expansion** (`${d%/*}` = dirname, `${f##*/}` = basename, `${f%.*}` = strip-ext) does the same string ops **in-process** — zero spawns. Ties to the "foreground op > 120s Bash-tool cap → SIGTERM" genus (#78/#95/#116), but here the cost is **spawn-count**, not a single slow op or I/O.

**Prevention:**
1. **Never spawn a subprocess per file when iterating the whole tree in bash** — replace `$(dirname "$f")` → `${f%/*}`, `$(basename "$f")` → `${f##*/}`, `$(echo "$x" | sed …)` → parameter expansion (`${x//a/b}`, `${x%suffix}`, `${x#prefix}`). Parameter expansion is in-process; command substitution forks.
2. **On Git Bash/Windows, subprocess spawn is the bottleneck, not the work** — a loop fine on Linux CI can blow the 2m Bash-tool cap on win32 purely from spawn count. Count `$(...)`-per-iteration × tree size before running a whole-tree loop.
3. **If you genuinely need an external tool per item, batch it** — feed all items to ONE `xargs`/`awk`/`sed` invocation instead of one spawn per item.

**Status:** Active — Windows Git-Bash subprocess-spawn perf cliff; a whole-tree per-file `$(cmd)` loop times out (spawn-count-bound). Sibling of the "foreground op > 120s Bash cap" genus (#78/#95/#116) — same 2m-timeout symptom, root cause = subprocess spawns, not a single slow op.

**Applies To:** All agents writing bash loops over `git ls-files` / large file sets on Windows Git Bash — use parameter expansion; batch external tools.

---

## [Build] `git worktree add ../wt-<name>` Creates the Worktree at the REPO's Parent Level — Not the User Home; Always Run `git worktree list` Before First Bash Access

**Pattern:** A worktree added at `../wt-<name>` resolves relative to the **repository root** (`C:/Users/jsnov/repos/ai-triad-research/`), landing at `C:/Users/jsnov/repos/wt-<name>` — the `repos/` sibling directory. If the agent's mental map flattens the path depth (assumed home/repo, not home/repos/repo), the resulting absolute path is one level shallower than the actual. In the Bash tool's POSIX view, that's `/c/Users/jsnov/repos/wt-<name>`, not `/c/Users/jsnov/wt-<name>`. Running `ls` or any Bash command on the incorrectly-assembled path fails with `No such file or directory`.

**Instances:**
- 2026-08-03 — DevOps (t/2067, p/26#38): ran `ls /c/Users/jsnov/wt-2067/` — assumed `../wt-2067` from the repo resolves at home level, but the actual path was `C:/Users/jsnov/repos/wt-2067` = `/c/Users/jsnov/repos/wt-2067`. Fixed by running `git worktree list` to confirm the real path.

**Root Cause:** The repo lives at `C:/Users/jsnov/repos/ai-triad-research/` — two levels below home (`home/repos/repo`), not one (`home/repo`). `../wt-<name>` from the repo root goes up one level to `C:/Users/jsnov/repos/`, landing the worktree there, not at the user home directory. This is a **mental-model mismatch** (wrong path depth), distinct from MSYS path mangling (#73 facet B) — here the path is assembled incorrectly before any tool sees it. The Bash tool reports `No such file or directory` on the wrong POSIX path, which looks like a missing worktree when the worktree exists at the correct path.

**Prevention:**
1. **Run `git worktree list` BEFORE first Bash access to a worktree** — it returns the canonical absolute path; never reconstruct the path by prepending the assumed home directory + a relative spec.
2. On this machine: repo = `C:/Users/jsnov/repos/ai-triad-research/`; sibling worktrees land at `C:/Users/jsnov/repos/wt-<name>` = `/c/Users/jsnov/repos/wt-<name>` in POSIX. NOT `/c/Users/jsnov/wt-<name>`.
3. Companion to the MSYS colon-revspec/path trap (#73 facet B): both produce a wrong absolute path for a git resource. #73B = MSYS mangles a correct path; #128 = a wrong path is assembled from an incorrect mental model. The fix for both: **verify the actual path before access** rather than reconstructing from memory.

**Status:** Active — worktree-land path-depth assumption hazard. Third env/path hazard in the worktree-land cluster (#77 `npm ci` empty package dir, #78 node_modules rm timeout, #128 path-depth mismatch). `git worktree list` is the one-stop oracle for canonical worktree paths.

**Applies To:** All agents using the Bash tool to access a worktree by absolute POSIX path.

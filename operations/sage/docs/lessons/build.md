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

**Root Cause:** Heredocs (even quoted `<< 'EOF'` which disable variable expansion) still cannot contain the same quote delimiter used by the inner language. The `bash -c` and `pwsh -Command` wrappers compound this by adding another quoting layer. Additionally, PowerShell-specific syntax (`@'...'@` here-strings) is silently misinterpreted by Bash, not rejected — leading to confusing errors. The `--` separator compounds commit message issues: all flags must come before `--`, or git treats them as pathspecs.

**Prevention:**
1. **First choice:** Use the Write tool to create a temp `.py` script file, then execute it with Bash — avoids all quoting issues.
2. Split complex scripts into smaller pieces that each avoid quote conflicts, passing data via temp files (e.g., JSON to `/tmp/`).
3. In Python, use %-formatting or `.format()` instead of f-strings when the content will pass through Bash.
4. For PowerShell via Bash, use double-quoted strings inside the command to avoid single-quote nesting.
5. Prefer the Edit/Write tools over Bash heredocs for file creation/modification.
6. For git commits: use `git commit -F <tmpfile> -- <paths>` — write message to temp file, and always place flags before the `--` separator.
7. **For any non-trivial PowerShell, prefer `pwsh -File <script.ps1>` over inline `pwsh -Command "..."`** (p/20#23). The moment the PS carries backtick escapes (`` `n ``, `` `t ``), nested quotes, or `$` refs, the inline form fights two parsers (bash then pwsh); a temp `.ps1` + `-File` sidesteps both. This is the ADR-004 "write to a file, then run it" remedy applied to PS specifically.

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

**Root Cause:** Dev environment may lack CLI tools (Azure CLI not installed, `jq` not on PATH) or required background services (Docker Desktop daemon not running). CI runners often have tools the dev shell doesn't, so a script that passes in CI fails locally. Both fail silently or with unhelpful exit codes.

**Prevention:**
1. Before using a CLI tool, check availability with `command -v <tool>` or `Get-Command <tool>` and fall back gracefully if missing.
2. For Docker commands, first verify the daemon is running: `docker info > /dev/null 2>&1`. If it fails, start Docker Desktop and wait for initialization.
3. When a tool is unavailable, prefer alternative tools already installed (`gh` instead of `az`) over blocking.
4. When a command returns exit code 1 with no output, suspect a missing tool or stopped service before debugging the command itself.
5. To verify a CI gate script locally when it depends on a CI-only tool (`jq`), **shim the tool** (e.g. a minimal python `jq` on PATH) and run the REAL script end-to-end — don't skip its calls or reimplement its logic, which defeats the verification.

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

**Root Cause:** Python's `open()` and `sys.stdout` use `locale.getpreferredencoding()` which is cp1252 on most Windows systems, not UTF-8. Both file I/O and subprocess stdout are affected. Ad-hoc `python -c` one-liners are especially exposed: they encourage printing raw doc text straight to a cp1252 console with no `reconfigure`/`-X utf8` safeguard.

**Prevention:**
1. Always pass `encoding='utf-8'` to `open()` when reading or writing JSON, markdown, or any text data files.
2. For stdout with Unicode content, wrap with `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` or call `sys.stdout.reconfigure(encoding='utf-8')` at script top.
3. Use `json.loads(Path(f).read_text(encoding='utf-8'))` as an alternative pattern for file reads.
4. Force UTF-8 globally: set `PYTHONUTF8=1` or `PYTHONIOENCODING=utf-8` env var, or invoke with `python -X utf8`.
5. Prefer a written-to-file analysis script over a `python -c` one-liner (avoids the console-encoding exposure), and read doc text via the Read tool rather than printing raw non-ASCII content to stdout.

**Status:** Active — **6 instances, 2 agents (CL + TL); not escalating (self-correcting):** it crashes loudly, the fix is well-known, and prevention #4/#5 already cover it. The durable habit that keeps getting re-derived: **never `print()` raw non-ASCII to a `python -c` stdout — parse in-memory, write results to a UTF-8 file, then Read it.** If a `python -c` print-to-stdout instance recurs a 3rd+ time (this is the 2nd such sub-case after p/7#34), the leverage is behavioral (default to file-scripts over `-c`), not a new hook.

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

**Pattern:** In the `/land-from-worktree` flow you "copy your changed files into the worktree" (step 3). If you `cp` the **whole file from the shared working tree**, you also copy any **pre-existing uncommitted WIP** on that file — other agents' edits, an accidental BOM, an unrelated config bump — which then rides into your commit. The commit silently carries changes you didn't make. `git diff --stat` shows a line-count larger than your edit (the gap is a tell), but `--stat` alone hides **what** the extra lines are, so the sweep-in can pass a quick glance.

**Instances:**
- 2026-07-26 — PowerShell (t/1726, caught in TL review, p/20#25): `cp`-ing a whole file from the shared tree into the landing worktree swept in an **accidental BOM** and an **unrelated gemini model-default bump** that were sitting uncommitted on that file. `git diff --stat` showed **24 lines vs the ~6 guard lines** the change actually needed — the gap flagged it, but `--stat` didn't reveal the BOM/model-bump; only the content diff did. Same family as the branch-off-origin / dirty-tree-false-witness cluster.

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

**Root Cause:** `--` signals end-of-options to git. Everything after `--` is treated as a literal filename/pathspec — including `-m`, `-F`, and any other flag. This is standard POSIX behavior but surprises agents who think of `--` as "here come the paths" without realizing it also disables all subsequent flag parsing.

**Prevention:**
1. **All flags must come BEFORE `--`:** `git commit -m "msg" -- <paths>`, never `git commit -- <paths> -m "msg"`.
2. Alternative: stage files first with `git add <paths>`, then `git commit -m "msg"` (no `--` needed if the index is already correct).
3. Same rule applies to all git commands: `git diff`, `git log`, `git checkout` — `--` always terminates option parsing.

**Status:** Resolved for main-repo commits (AGENTS.md rule overlay 95e9c3b, p/8#30 + `git-commit-pathspec-flag-order` PreToolUse hook live workspace-wide, p/9#16) — **but recurred 2026-07-26 on an overlay `ogit` commit (Docker, p/217#1), a suspected hook-coverage gap:** the guard likely matches `git commit …` but not the overlay-prefixed `git --git-dir=.orca-git --work-tree=. commit …` form. 4 instances / 4 agents. Diagnostics extended the matcher to the overlay form (`/\bgit\b.*\bcommit\b/`, commit 039f9501, p/9#39) and, in the p/9#41 audit, **re-inlined the hook via `node -e`** so it no longer depends on `{workspace_root}` (Windows path-crash resolved — see "Feedback Hook Silently Dead on Windows" in process.md). Caveat: the runner still treats a non-zero exit as silent-suppress (Orca Support's platform fix), so verify the guard actually emits guidance, not just that it's installed. **7 instances / 7 agents** (+ServerAPI t/1788 p/79#13, +CL.Investigate1 t/1767 p/40#11, +Taxonomy Editor p/6#22) — the hook is **warn-only**: it can't prevent the mistake (git rejects the command regardless), so recurrences self-correct on git's own error rather than being blocked. Zero-cost/self-correcting, so NOT a #82 escalation — git IS the point-of-use enforcement. **But at 7×, the improvement worth making is corrective GUIDANCE:** the violation is a crisp syntactic signal, so the flag-order hook should emit the correct form (`-m "msg" -- <paths>`) on a violation — blocked until the #80 Part-3 fix stops it exit-1-noising on every call. The hook's value is the *guidance*, not prevention; the durable fix remains the rule + habit.

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

## [Build] `git worktree remove` Fails (exit 128) on Untracked node_modules — Needs `--force`

**Pattern:** After a worktree land, `git worktree remove ../wt-X` fails with exit 128 ("contains modified or untracked files") whenever `npm ci` ran inside the worktree — the installed `node_modules` / `dist` are untracked, and `git worktree remove` refuses to delete a worktree with untracked content. This recurs on **every** worktree land that installs deps. `git worktree remove --force` cleans it (safe once the committed work is already pushed).

**Instances:**
- 2026-07-17 — Shared Lib (`/land-from-worktree` step 8, p/5#13): `git worktree remove ../wt-X` exited 128 because step-2's in-worktree `npm ci` left untracked `node_modules`. Resolved with `git worktree remove --force`; committed work was already pushed, so no loss. Flagged the playbook step-8 gap.

**Root Cause:** `git worktree remove` is deliberately conservative — it aborts if the worktree has modified or untracked files, to avoid destroying unsaved work. But the `/land-from-worktree` flow *requires* an in-worktree `npm ci` (step 2, to verify against fresh deps), which by definition leaves a large untracked `node_modules` tree. So the safe-by-default refusal fires on every deps-installing land. `--force` is correct **here specifically** because the deliverable was already committed and pushed inside the worktree (step 3) before removal — the only thing `--force` discards is `node_modules`. Distinct cause from the Windows Junction pattern (there `--force` clears a *junction*; here it clears ordinary untracked install output), same remedy. Companion to #77 (the same in-worktree `npm ci`).

**Prevention:**
1. **`/land-from-worktree` step 8 should specify `git worktree remove --force`** — plain `remove` will always fail after an in-worktree `npm ci`. (Playbook wording gap; handed to TL's batch.)
2. **`--force` is only safe after your commit is pushed** — confirm the worktree's work is on `origin/main` (step 3 done) before force-removing; then the sole casualty is `node_modules`. Never `--force` with uncommitted deliverable work in the worktree.
3. `git worktree prune` afterward clears any stale administrative refs (same follow-up as the Junction pattern).

**Status:** Active — 6th hazard in the worktree-land cluster; a concrete `/land-from-worktree` step-8 wording fix. Handed to TL for the owner-gated batch.

**Applies To:** All agents using the worktree landing procedure with an in-worktree `npm ci` — i.e. every deps-installing land.

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

**Pattern:** Two independent Windows/Git-Bash behaviors silently abort a Bash-tool command mid-chain even though nothing is actually wrong: **(A)** `grep -c` (and any grep) **exits 1 on ZERO matches** — standard grep behavior — so an `&&`-chained check breaks at that link *even when the printed `0` was the desired result* (e.g. confirming zero `.ts` entries); **(B)** MSYS **auto path-conversion mangles a `git show <ref>:<slashed-path>` argument** — `git show origin/main:.github/workflows/ci.yml` is rewritten to `origin\main;.github\...` (colon→`;`, `/`→`\`), producing a `fatal: unknown revision` on a perfectly valid ref.

**Instances:**
- 2026-07-17 — DevOps (while landing t/1692, p/26#14): (A) a `grep -c ... && ...` chain broke because `grep -c` returned exit 1 on zero matches — the `0` count was the intended answer, but the non-zero exit killed the `&&` chain. (B) `git show origin/main:.github/workflows/ci.yml` failed "unknown revision" because MSYS converted the `<ref>:<path>` arg into `origin\main;.github\...`. Fixes: keep zero-match/count checks OUT of `&&` links (test the value separately), and prefix `MSYS_NO_PATHCONV=1` for `git show <ref>:<slashed-path>`. Both benign, resolved.
- 2026-07-17 — Technical Lead (p/8#79, refines facet B): facet B **does NOT reproduce** in TL's Bash-tool env — `git show HEAD:.github/workflows/ci.yml` and every `git show <ref>:<path>` returned OK all session. So facet B is **MSYS-config-dependent**, not "always breaks on Windows Git Bash": DevOps's MSYS setup mangles the arg, TL's does not. The durable defense is a failure-**signature**, not a blanket prefix (mandating `MSYS_NO_PATHCONV=1` everywhere is noise where it isn't needed).
- 2026-07-17 — ServerAPI (p/79#8, **2nd facet-A instance**): `git show ... | grep -c "^-" && echo ...` reported tool failure (exit 1) because `grep -c` returned 0 deletions (a purely-additive diff — `0` was the desired answer), aborting the `&&` chain. No real error — read the printed count; fix `|| true` after `grep -c` or keep it out of the `&&` chain. Confirms facet A recurs independently across agents (DevOps + ServerAPI, same day).
- 2026-07-17 — Taxonomy Editor (p/6#20, **3rd facet-A instance**): a Bash chain whose *final* `git log origin/main | grep -iE "pattern"` matched fine still tripped the failure hook (exit 1) because an **earlier `grep -c` in the same chain returned 0**, so the combined chain exit was nonzero. Object-level confirmations were actually fine; resolved by re-running the log query standalone. **Variant:** the poisoning grep is *upstream* in the chain, not the last command — so a successful final match is masked by an earlier zero-count. Crosses the 3-instance threshold (DevOps + ServerAPI + Taxonomy Editor, all same day).

**Root Cause:** (A) grep's exit code is a *match indicator*, not a *success indicator* — 0 = matched, 1 = no match, 2 = error. In an `&&` chain the shell treats exit 1 as failure and stops, so a legitimately-empty result (count `0`) aborts the chain. This is standard POSIX grep behavior, not Windows-specific, but it bites hardest in Bash-tool one-liners that chain a count check into follow-up steps — and it recurs (2 agents in one day: a zero `.ts`-entry count and a zero-deletion diff count). Same "exit code ≠ what you think" family as the grep-fails-silently pattern above. (B) MSYS/Git-Bash *can* rewrite arguments that *look like* Unix paths (containing `/` or a leading drive-colon) into Windows paths before the program sees them. `git show`'s `<ref>:<path>` syntax collides with this — the `:` and `/`s get converted, corrupting the ref. **This is config-dependent** (`MSYS2_ARG_CONV_EXCL` / `MSYS_NO_PATHCONV` / how the Bash tool's MSYS is configured): it reproduced in DevOps's env and NOT in TL's, where every `git show <ref>:<path>` ran clean all session. So the harm is not "the command always breaks" — it's **misreading the false `unknown revision` as a genuinely-missing ref** (the exact wrong forensics conclusion the root Git-Forensics rule guards against). `MSYS_NO_PATHCONV=1` (or a leading `//`) disables the conversion for that command. Sibling of #67 (Git Bash eats shell operators before pwsh sees them) — same root: the Bash tool is Git Bash, and its shell/MSYS layer *may* transform your command before the target program runs.

**Prevention:**
1. **Keep zero-match/count checks out of `&&` chains.** Capture the value first (`n=$(grep -c ... || true)`) then test it, or append `|| true` so a legitimate zero-match doesn't abort the chain. Never assume `grep`/`grep -c` exit 0 on a successful-but-empty result.
2. **Facet B is a failure-SIGNATURE, not a blanket mandate** (TL, p/8#79): if `git show <ref>:<slashed-path>` reports `unknown revision` on a ref/path you KNOW exists, that's MSYS path-conversion — retry with `MSYS_NO_PATHCONV=1`. Do NOT prefix it unconditionally; it's config-dependent and unnecessary in envs (like TL's) that don't mangle. The critical error to avoid is concluding the ref is genuinely missing — the exact wrong forensics call the root Git-Forensics rule exists to prevent.
3. **So: a valid ref reporting "unknown revision" in the Bash tool is the tell** — suspect MSYS path-conversion before doubting the ref exists; confirm by re-running the same command with `MSYS_NO_PATHCONV=1`.

**Status:** Active — sibling of #67 (Git-Bash-transforms-your-command family). **Facet A now has 3 instances (DevOps + ServerAPI + Taxonomy Editor, all 2026-07-17) — crosses the escalation threshold.** Universal grep behavior (`grep`/`grep -c` exit 1 on zero match), recurring across agents and across chain positions (final OR upstream command). **Escalation — ACCEPTED (p/8#86):** TL folded facet A into the AGENTS.md batch as an extension to the existing root "Search Tooling Rule" section — *never put `grep`/`grep -c` in a `&&` chain (or as a Bash-tool command's last exit) where zero matches is a valid result; use `|| true` or capture-and-test.* Agreed not hookable (a guard would fire on every legitimate `grep && `), so the documented root rule is the durable fix. Overlay/owner-gated, in TL's 4-item batch being surfaced to the owner. Facet B is **MSYS-config-dependent** (reproduced for DevOps, NOT for TL — p/8#79). TL will propose a root Git-Forensics Common-Trap line framed as the failure-**signature** ("valid ref → `unknown revision` = MSYS conversion; retry `MSYS_NO_PATHCONV=1`"), batched with the pending worktree-landing-rule proposal to the overlay owner for approval (it's overlay-tracked).

**Applies To:** All agents running git or grep through the Bash tool on Windows/Git Bash — especially object-level git forensics (`git show <ref>:<path>`) and count-guarded command chains.

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

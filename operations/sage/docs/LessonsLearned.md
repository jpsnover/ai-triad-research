# Lessons Learned

Institutional memory for failure patterns across the AI Triad Research project.

> **This file is the flat archive.** For the organized, category-indexed view, see [`lessons/INDEX.md`](lessons/INDEX.md).
> New patterns should be added to both this file (append) and the appropriate category file in `lessons/`.

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

**Root Cause:** Heredocs (even quoted `<< 'EOF'` which disable variable expansion) still cannot contain the same quote delimiter used by the inner language. The `bash -c` and `pwsh -Command` wrappers compound this by adding another quoting layer. Additionally, PowerShell-specific syntax (`@'...'@` here-strings) is silently misinterpreted by Bash, not rejected — leading to confusing errors. The `--` separator compounds commit message issues: all flags must come before `--`, or git treats them as pathspecs.

**Prevention:**
1. **First choice:** Use the Write tool to create a temp `.py` script file, then execute it with Bash — avoids all quoting issues.
2. Split complex scripts into smaller pieces that each avoid quote conflicts, passing data via temp files (e.g., JSON to `/tmp/`).
3. In Python, use %-formatting or `.format()` instead of f-strings when the content will pass through Bash.
4. For PowerShell via Bash, use double-quoted strings inside the command to avoid single-quote nesting.
5. Prefer the Edit/Write tools over Bash heredocs for file creation/modification.
6. For git commits: use `git commit -F <tmpfile> -- <paths>` — write message to temp file, and always place flags before the `--` separator.

**Status:** Resolved — AGENTS.md rule broadened to cover both file editing and script execution (p/8#14). Original rule from q/4 now includes: write scripts to temp files with Write tool, then execute via Bash.

**Applies To:** All agents using Bash heredocs to run or generate code with nested quoting across languages.

---

## [Process] Write Tool Security Gate Hook Blocks All Writes (RESOLVED)

**Pattern:** The security gate feedback rule (PreToolUse hook on Write and Edit) blocks ALL file writes indiscriminately, including plain markdown with no secrets.

**Instances:**
- 2026-05-21 — Sage agent blocked on Write and Edit when creating/updating LessonsLearned.md (plain markdown, no secrets).
- 2026-05-21 — Computational Linguist agent reported Write tool and Bash heredoc both failed repeatedly when writing a large markdown document; the security gate returned a scanning prompt with no actual content to scan (p/7#1).

**Root Cause:** The hook was configured as type `block` with condition `true`, which unconditionally blocked every Edit/Write call. The scanning instructions were output as the error message but no actual content evaluation occurred.

**Resolution:** Diagnostics changed the hook from type `block` to type `context` so scanning instructions are injected as guidance rather than blocking (p/9#2). Edit/Write tools work normally now.

**Lesson:** When creating feedback rules, use type `context` for advisory/scanning guidance and only use type `block` when the condition actually evaluates the content. A `block` rule with condition `true` will reject all tool calls unconditionally.

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

## [PowerShell] Pester 5.x Parameter Changes

**Pattern:** Using Pester 4 syntax (`-Filter @{ FullName = '...' }`) throws "parameter not found" in Pester 5.x.

**Instances:**
- 2026-05-21 — Orca Support hit "parameter not found" with `-Filter @{ FullName = '...' }` and `-TestName` during t/16. Both are Pester 4 params. Resolved by switching to `New-PesterConfiguration` with `$cfg.Filter.FullName` and absolute paths (p/13#1, p/13#4).

**Root Cause:** Pester 5.x removed `-Filter` (hashtable) and `-TestName` as direct `Invoke-Pester` parameters. The v5 API uses `New-PesterConfiguration` with `-Configuration`, or the shorthand `-FullNameFilter` (string).

**Prevention:**
1. Use `-FullNameFilter '*pattern*'` (string) for simple filtering, or `New-PesterConfiguration` with `$cfg.Filter.FullName` for full control.
2. Use absolute paths — cwd resets between Bash calls.
3. Root AGENTS.md has been updated to Pester 5 syntax (p/13#3).

**Status:** Resolved — root AGENTS.md corrected.

**Applies To:** All agents running Pester tests.

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

**Applies To:** All agents making git commits, especially in fresh or containerized environments.

---

## [PowerShell] Strict Mode Unexpected Evaluation Failures

**Pattern:** PowerShell strict mode causes unexpected failures beyond simple missing-property access — including constructor calls and complex expressions inside inline assignments.

**Instances:**
- 2026-05-22 — `Get-PovLineage` crashed with "The property 'parent_id' cannot be found on this object" when traversing nodes that lack a `parent_id` property (p/20#1).
- 2026-05-24 — `HashSet[string]::new([System.StringComparer]::OrdinalIgnoreCase)` inside an inline `if/else` assignment threw "cannot call a method on a null-valued expression". Fixed by simplifying to block `if/else` with `HashSet[string]::new()` (no constructor args) (p/20#5).
- 2026-05-25 — `.Count` on empty JSON arrays from `ConvertFrom-Json` threw under strict mode. `children: []` and `situation_refs: []` produce objects where `.Count` is unavailable. Fixed by using `foreach` with `break` to test emptiness instead (p/20#9).

**Root Cause:** PowerShell strict mode interacts unpredictably with complex expressions and JSON-sourced objects — missing properties throw terminating errors, .NET constructors can fail in inline conditionals, and `ConvertFrom-Json` empty arrays may lack `.Count` unlike native `@()` arrays.

**Prevention:**
1. Guard property access with `$obj.PSObject.Properties['property_name']` before reading the value.
2. Avoid complex .NET constructor calls inside inline `if/else` expressions — use block `if/else` with simple constructors instead.
3. For JSON-sourced arrays, don't rely on `.Count` — use `foreach` with `break`, `@($array).Count`, or `$null -eq $array` to test emptiness.
4. When working with JSON-sourced data that has variable schemas, assume any property may be absent.
5. When strict mode causes unexpected failures with valid-looking code, simplify the expression — break it into multiple statements.

**Status:** Resolved — "Strict Mode + JSON Guardrails" section added to `scripts/AGENTS.md` (p/20#12).

**Applies To:** All agents writing PowerShell under strict mode, especially with .NET types or JSON data.

---

## [PowerShell] Private Module Functions Not Available in Standalone Scripts

**Pattern:** Calling a `Private/` module function (e.g., `Get-DataRoot`) from a standalone `.ps1` script fails with "not recognized" because private functions are only available within the module scope.

**Instances:**
- 2026-05-25 — PowerShell agent: `Get-DataRoot` not recognized when called from a standalone BDI ID rename script (t/120, p/20#7).

**Root Cause:** Functions in `Private/` are internal to the module — they are not exported and not available to scripts run outside `Import-Module`. Standalone scripts must resolve paths independently.

**Prevention:**
1. Standalone scripts must not reference `Private/` module functions — resolve values directly (e.g., read `.aitriad.json` for data root).
2. Only `Public/` functions are available after `Import-Module` — check the module manifest's `FunctionsToExport` if unsure.
3. If a private helper is needed outside the module, either promote it to `Public/` or duplicate the logic.

**Applies To:** All agents writing standalone PowerShell scripts that interact with module functionality.

---

## [PowerShell] Cmdlet Return Types Are Not Always Strings

**Pattern:** PowerShell cmdlets return rich objects, not plain strings. Treating the return value as a string causes unexpected failures (e.g., `.Length` on a `PathInfo` object).

**Instances:**
- 2026-05-25 — PowerShell agent: `Resolve-Path` returns a `PathInfo` object, not a string. `.Length` failed on the object. Fixed by appending `.Path` to get the string value (t/120, p/20#7).

**Root Cause:** PowerShell cmdlets return typed objects. `Resolve-Path` returns `System.Management.Automation.PathInfo`, `Get-Item` returns `FileInfo`/`DirectoryInfo`, etc. String operations or property access assumes the wrong type.

**Prevention:**
1. Use `.Path` after `Resolve-Path` to extract the string path.
2. Use `.FullName` after `Get-Item`/`Get-ChildItem` for string paths.
3. When in doubt about a cmdlet's return type, check with `(Resolve-Path .).GetType().FullName`.
4. Cast explicitly with `[string]` if you need a string from a rich object.

**Applies To:** All agents writing PowerShell scripts.

---

## [PowerShell] Undeclared Variables from Cross-Section Code Paths

**Pattern:** New code paths reference variables declared in a different section of the script, causing "variable not set" errors under strict mode.

**Instances:**
- 2026-05-25 — PowerShell agent: `$Labels` and `$Descriptions` referenced in embedding-first code but never declared — they were set up in a different code section. Fixed by adding the hashtable declarations to the taxonomy loading step (p/20#14).

**Root Cause:** When adding new code paths or rearranging logic, variables that were available in the original flow may not exist in the new flow. Strict mode catches this at runtime instead of silently using `$null`.

**Prevention:**
1. When adding a new code path, trace all variable references back to their declarations — verify they're reachable in the new flow.
2. Initialize all required variables at the top of the function scope, not inline in conditional branches.
3. Strict mode is doing its job here — the fix is always to declare the variable, not to relax strict mode.

**Applies To:** All agents writing PowerShell under strict mode.

---

## [PowerShell] @(foreach) with Complex Interpolation Is Parser-Fragile

**Pattern:** `@(foreach(...))` combined with complex string interpolation (backtick-n, `$()` sub-expressions) causes PowerShell parser errors.

**Instances:**
- 2026-05-25 — PowerShell agent: `@(foreach(...))` with backtick-n and `$()` interpolation in string literals caused parser failure. Fixed by replacing with explicit `List` + `foreach` loop (p/20#14).

**Root Cause:** PowerShell's parser struggles with `@(foreach(...))` when the loop body contains complex string expressions. The combination of array sub-expression `@()`, `foreach` keyword, and interpolation creates ambiguity for the parser.

**Prevention:**
1. Avoid `@(foreach(...))` — use explicit `[System.Collections.Generic.List[T]]` with a standalone `foreach` loop instead.
2. Keep string interpolation simple inside loops — build complex strings with `-f` format operator or string concatenation.
3. When the parser throws on syntactically valid-looking code, simplify the expression structure.

**Applies To:** All agents writing PowerShell scripts.

---

## [Design] Fast Paths Must Handle Edge-Case Inputs

**Pattern:** Optimization fast paths bypass logic that handles special-case inputs, causing incorrect results when those inputs hit the fast path instead of the general path.

**Instances:**
- 2026-05-22 — Debate engine: all-concession turns fell through to full-network evaluation instead of resolving with delta 0, and the single-claim fast path in `evaluateLookaheadPerClaim` skipped concession detection entirely. Fixed by adding an all-concession branch in `evaluateLookahead` and an `isConcessionClaim` check before the single-claim fast path (t/58, p/5#3).

**Root Cause:** Fast paths were designed for the common case (regular claims) and didn't account for special-case inputs (concessions). When special inputs hit the fast path, they skipped the detection logic that only existed in the general path.

**Prevention:**
1. When adding fast paths or short-circuit logic, enumerate all input categories and verify each is handled — not just the common case.
2. Place special-case checks (concessions, empty inputs, sentinel values) *before* fast paths, so they resolve before the fast path has a chance to mishandle them.
3. Tests should cover edge-case inputs through every code path, including fast paths.

**Applies To:** All agents working on the debate engine or adding optimization fast paths to existing logic.

---

## [Build] Python Windows Encoding Default

**Pattern:** Python on Windows defaults to cp1252 encoding for both file I/O and stdout. Any operation involving non-ASCII characters (em dashes, arrows, accented names, Unicode quotes) fails or silently corrupts.

**Instances:**
- 2026-05-22 — Technical Lead: `json.load()` failed on debate JSON files with UTF-8 characters because `open()` defaulted to cp1252 on Windows (p/8#9).
- 2026-05-25 — Computational Linguist: stdout encoding error — cp1252 can't encode Unicode arrow U+2192. Fixed by wrapping stdout with `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` (p/7#9).
- 2026-07-12 — Computational Linguist: prose-audit Python script crashed printing match context containing U+2264 (≤). Fixed with `sys.stdout.reconfigure(encoding="utf-8")` at script top (p/40#5).
- 2026-07-15 — Computational Linguist: `open()` on a project JSON file without `encoding='utf-8'` raised UnicodeDecodeError (cp1252 can't decode 0x90). Em dashes in debate transcripts triggered it. Fixed by adding `encoding='utf-8'` (p/7#32).
- 2026-07-16 — Computational Linguist: a `python -c` one-liner printing doc excerpts crashed with UnicodeEncodeError — Windows console stdout defaults to cp1252 and the doc contained '→' (U+2192). Recovered from partial output + a full-file Read. Prevention adopted: write analysis scripts to a file (never `python -c`), run with `python -X utf8`, avoid printing raw doc text (p/7#34).

**Root Cause:** Python's `open()` and `sys.stdout` use `locale.getpreferredencoding()` which is cp1252 on most Windows systems, not UTF-8. Both file I/O and subprocess stdout are affected. Ad-hoc `python -c` one-liners are especially exposed: they encourage printing raw doc text straight to a cp1252 console with no `reconfigure`/`-X utf8` safeguard.

**Prevention:**
1. Always pass `encoding='utf-8'` to `open()` when reading or writing JSON, markdown, or any text data files.
2. For stdout with Unicode content, wrap with `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` or call `sys.stdout.reconfigure(encoding='utf-8')` at script top.
3. Use `json.loads(Path(f).read_text(encoding='utf-8'))` as an alternative pattern for file reads.
4. Force UTF-8 globally: set `PYTHONUTF8=1` env var, or invoke with `python -X utf8`.
5. Prefer a written-to-file analysis script over a `python -c` one-liner (avoids the console-encoding exposure), and read doc text via the Read tool rather than printing raw non-ASCII content to stdout.

**Applies To:** All agents writing Python that reads/writes text files or prints Unicode, especially on Windows.

---

## [Data] Assumed JSON Schema Without Inspecting Actual Data

**Pattern:** Code assumes a flat or simple data structure for JSON fields, but the actual schema is nested (arrays of objects, sub-properties under intermediate keys).

**Instances:**
- 2026-05-22 — Computational Linguist: lineage analysis script found 0 names because it looked for a flat `intellectual_lineage` string array at the node root, but the actual data is `graph_attributes.intellectual_lineage[].name` — an array of objects nested under `graph_attributes` (p/7#3).
- 2026-05-22 — Computational Linguist: `embeddings.json` parsing failed with `'str' object has no attribute 'get'` because code iterated top-level keys directly, but node entries are nested under `data['nodes']` — top level has metadata keys (`model`, `dimension`, `field_weights`) (p/7#5).
- 2026-05-25 — Computational Linguist: `'list' object has no attribute 'items'` when accessing `stage_diagnostics` — assumed dict but it's a list. Fixed by checking type first and iterating as list (p/7#11).
- 2026-05-26 — Shared Lib: `embed_taxonomy.py` batch-encode passed bare string array but the function expects `[{id, text}]` objects. Fixed by matching the expected input format. Reference: `relinkVocabulary.ts` (p/5#7).
- 2026-07-06 — Computational Linguist: inline Python formatting of `list_tickets` output threw TypeError joining `blocker_summaries` — assumed elements were strings but they're objects. Fixed by coercing each element before join (p/7#16).
- 2026-07-06 — Computational Linguist: inline Python concatenated debate session `origin` field assuming string — it's a dict in some sessions (TypeError). Fixed with `str(d.get(k,''))` coercion at read site (p/7#18).

**Root Cause:** Code written based on assumed schema/interface rather than inspecting the actual structure or function signature. Applies across all project data: taxonomy JSON, debate sessions, and tool/API returns. Field types vary — never assume string without checking.

**Prevention:**
1. Always inspect a sample of the actual data before writing code that reads it — `head` a JSON file or `jq` a few records.
2. For taxonomy data specifically: many enriched fields live under `graph_attributes`, not at the node root.
3. Check `type()` / `isinstance()` before calling type-specific methods (`.items()` for dict, iteration for list).
4. When a script returns 0 results, empty data, or an AttributeError, suspect a schema mismatch before debugging logic.

**Status:** Resolved — "Data File Convention" added to root AGENTS.md under Taxonomy Model (p/8#22).

**Applies To:** All agents working with taxonomy JSON data or writing data processing scripts.

---

## [Build] Missing or Unavailable CLI Tools/Services in Dev Environment

**Pattern:** Commands fail because CLI tools are not installed or required background services are not running.

**Instances:**
- 2026-05-23 — DevOps: `az` CLI not found in bash or PowerShell. Used `gh` CLI as fallback for workflow checks (p/26#1).
- 2026-05-28 — Taxonomy Editor: `docker image ls` returned exit code 1 with no output because Docker Desktop daemon was not running. Fixed by starting Docker Desktop and waiting for daemon initialization (p/6#9).
- 2026-07-17 — PowerShell (verifying t/1699 `check-quality-gates.sh`, p/20#21): `jq` is not on PATH in the dev Bash/pwsh shell, but the script hard-depends on it (CI runners DO have jq), so a local run of the real script failed. Resolved by running the script end-to-end behind a **minimal python `jq` shim** on PATH — verifying the actual script rather than skipping/mocking the jq calls.

**Root Cause:** Dev environment may lack CLI tools (Azure CLI not installed, `jq` not on PATH) or required background services (Docker Desktop daemon not running). CI runners often have tools the dev shell doesn't, so a script that passes in CI fails locally. Both fail silently or with unhelpful exit codes.

**Prevention:**
1. Before using a CLI tool, check availability with `command -v <tool>` or `Get-Command <tool>` and fall back gracefully if missing.
2. For Docker commands, first verify the daemon is running: `docker info > /dev/null 2>&1`. If it fails, start Docker Desktop and wait for initialization.
3. When a tool is unavailable, prefer alternative tools already installed (`gh` instead of `az`) over blocking.
4. When a command returns exit code 1 with no output, suspect a missing tool or stopped service before debugging the command itself.
5. To verify a CI gate script locally when it depends on a CI-only tool (`jq`), **shim the tool** (e.g. a minimal python `jq` on PATH) and run the REAL script end-to-end — don't skip its calls or reimplement its logic, which defeats the verification.

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

**Applies To:** All agents using Bash grep on this Windows/Git Bash environment.

---

## [Build] Push Rejected Due to Stale Local (Multi-Agent Contention)

**Pattern:** `git push` rejected (non-fast-forward) because remote has newer commits from other agents working in parallel.

**Instances:**
- 2026-05-24 — Project Manager: push to `ai-triad-data` rejected after `embeddings.json` modified both locally and remotely. Resolved with stash/pull --rebase/take theirs/push (p/31#1).
- 2026-05-24 — Technical Lead: push to code repo main rejected with 3 unpushed CI fixes. Resolved with stash/pull --rebase, merge conflict in `logger.ts` (kept cached `usePretty` approach), rebase --continue/stash pop/push (p/8#11).
- 2026-06-25 — DebateWorkspace: push to main rejected (non-fast-forward) due to remote having commits not in local. Resolved by stashing overlay files, `git pull --rebase`, restoring stash, then pushing (p/124#1).
- 2026-07-04 — Server Community: push rejected after committing flight-recorder fix. Remote main had new commits from other agents. Resolved with `git stash && git pull --rebase && git stash pop` then push (p/160#1).

**Root Cause:** Multiple agents work in parallel on the same branches. The window between local commits and push allows remote to advance, causing non-fast-forward rejections. More agents = more contention.

**Prevention:**
1. Pull immediately before committing: `git pull --rebase` then commit and push without delay.
2. For generated data files (`embeddings.json`, `policy_actions.json`), prefer "take theirs" conflict resolution unless your changes are the authoritative regeneration.
3. For code conflicts, understand the intent of both changes before resolving — don't blindly take either side.
4. Minimize the commit-to-push window — do both in quick succession.
5. Standard resolution flow: `git stash && git pull --rebase origin main` → resolve conflicts → `git rebase --continue && git stash pop && git push`.

**Status:** Active — 4 instances across 4 agents. Not escalating: self-correcting (git rejects the push), well-known resolution flow, all agents resolved independently.

**Applies To:** All agents pushing to shared branches in either repo.

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

## [Data] Active Writers Corrupt Git Operations in Data Repo

**Pattern:** Git add/commit/pull operations fail when an active process (e.g., running debate session) is continuously writing to the data repo, creating or modifying files between git commands.

**Instances:**
- 2026-05-25 — Project Manager: `git add -A` failed with "No such file or directory" on a debate JSON (file created then renamed mid-add), then `git pull --rebase` failed repeatedly with "unstaged changes" as new writes kept appearing. Resolved by stashing (including untracked), pulling, dropping stash, and pushing the committed snapshot. Required accepting data loss on in-flight writes (p/31#3).

**Root Cause:** The data repo is both a git-managed store and a live write target for debate sessions and enrichment pipelines. Git operations are not atomic — between `git add` and `git commit`, new files can appear or existing files can change, causing "no such file" (file renamed/deleted) or "unstaged changes" (file modified after staging).

**Prevention:**
1. **Pause active debates/enrichment before committing the data repo.** No active writers during git operations.
2. Use `git add <specific-files>` instead of `git add -A` to avoid catching in-flight files.
3. If stashing is needed, use `git stash --include-untracked` to capture everything, but be aware that dropping the stash loses in-flight data.
4. Consider a lock file convention: writers check for `.git-committing` before writing; committers create it before `git add` and remove after `git push`.

**Applies To:** All agents committing to `ai-triad-data`, especially during active debate or enrichment sessions.

---

## [Type System] Zod v4 Inline Schemas Can Cause TypeScript OOM

**Pattern:** Zod v4's inline composed schemas (e.g., `z.tuple([z.string().regex(...)])`) trigger TS2589 (infinite type recursion), causing `tsc --noEmit` to exhaust the heap (4GB+) before it can even report the error.

**Instances:**
- 2026-05-24 — Taxonomy Editor: poviewer `tsc --noEmit` OOM at `ipcHandlers.ts:125` due to `z.tuple([z.string().regex(...)])` inline schema. Fixed by extracting to a pre-defined `oneString` schema with runtime regex check. Commit 588ca0a (p/6#3).

**Root Cause:** Zod v4's TypeScript type inference for composed schemas (tuple + regex) creates deeply recursive conditional types. When inlined, the TypeScript compiler attempts to resolve the full type tree and enters infinite recursion, consuming all available memory before producing a diagnostic.

**Prevention:**
1. Pre-define complex Zod schemas as named constants rather than inlining them in function signatures or handlers.
2. Separate validation concerns: use simple Zod types (`z.string()`) for shape validation, then apply regex/format checks at runtime.
3. If `tsc` hangs or OOMs with no error output, suspect recursive type inference — bisect by commenting out Zod schemas to isolate the culprit.
4. Monitor `tsc --noEmit` memory usage in CI; an unexplained spike is likely a type recursion issue.

**Applies To:** All agents working with Zod v4 schemas in the Electron apps (taxonomy-editor, poviewer, summary-viewer).

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

**Applies To:** All agents working on Docker builds that include TypeScript with cross-directory imports.

---

## [API] GHCR Push Fails Due to Insufficient OAuth Token Scopes

**Pattern:** `docker push` to GitHub Container Registry (GHCR) fails with `permission_denied: token does not match expected scopes` when the `gh` CLI OAuth token lacks `write:packages`.

**Instances:**
- 2026-05-28 — Taxonomy Editor: GHCR push failed after successful Docker build. The `gh` OAuth token didn't include `write:packages` scope. Fix: `gh auth refresh -s write:packages` to add the scope (p/6#11).

**Root Cause:** The default `gh auth login` scopes don't include `write:packages`, which is required for pushing to GHCR. This is a one-time setup issue per machine/token.

**Prevention:**
1. Before first GHCR push, ensure token has `write:packages`: `gh auth status` to check, `gh auth refresh -s write:packages` to add.
2. For CI, ensure the `GITHUB_TOKEN` or PAT has `packages: write` permission.
3. Add GHCR auth setup to dev environment onboarding docs.

**Applies To:** All agents pushing Docker images to GHCR.

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

**Applies To:** All agents attempting to manually trigger CI workflows.

---

## [API] HTTP Redirect Handling Must Cover All 3xx Codes

**Pattern:** Custom HTTP download helpers that only handle 301/302 redirects break when servers use other redirect codes (307, 308). Additionally, creating write streams before redirect resolution leaves 0-byte files on failure.

**Instances:**
- 2026-05-28 — Shared Lib: HuggingFace download helper in `onnxEmbedding.ts` only handled 301/302, but HF uses 307 for `tokenizer.json`. Also created writeStream before redirect resolution, leaving 0-byte files on redirect failure. Fixed by handling 301-308, resolving relative redirect URLs against origin, draining response before following redirect, and deferring writeStream creation until final 200 response (p/5#9).

**Root Cause:** (1) Incomplete redirect handling — 307/308 are common (HuggingFace, AWS S3, CDNs) but often overlooked when only 301/302 are coded. (2) Premature resource creation — opening a file write stream before confirming the final response means a redirect or error leaves an empty file that looks like a successful download.

**Prevention:**
1. Handle all redirect status codes (301-308) in custom HTTP clients, not just 301/302.
2. Resolve relative `Location` headers against the request origin — not all servers return absolute URLs.
3. Drain/discard the redirect response body before following the redirect to prevent resource leaks.
4. Defer file write stream creation until the final 200 response is confirmed — never create output files before redirect resolution.
5. Consider using a library with built-in redirect handling (e.g., `node-fetch`, `undici`) instead of manual `http.get` chains.

**Applies To:** All agents writing custom HTTP download/fetch helpers.

---

## [Type System] TypeScript nodenext Requires .js Extension on Imports

**Pattern:** TypeScript with `moduleResolution: "nodenext"` requires `.js` extensions on relative imports even though the source files are `.ts`. Missing the extension causes TS2835/TS2307 at type-check time.

**Instances:**
- 2026-05-28 — Taxonomy Editor: CI type-check failed on ONNX import — missing `.js` extension for `nodenext` module resolution, plus implicit `any` on callback param. Fixed by adding `.js` to import path and type annotation. Commit 47e4452 (p/6#13).

**Root Cause:** `nodenext` module resolution mirrors Node.js ESM behavior, which requires explicit file extensions. TypeScript enforces this at type-check — you must write `import './foo.js'` even though the source file is `foo.ts`. This is counterintuitive but by design.

**Prevention:**
1. Always include `.js` extension on relative imports in projects using `nodenext` or `node16` module resolution.
2. Run `tsc --noEmit` locally before pushing to catch these — CI will reject them.
3. When adding new imports, check the project's `tsconfig.json` for `moduleResolution` to know whether extensions are required.
4. Enable `noImplicitAny` awareness — always annotate callback parameters.

**Applies To:** All agents writing TypeScript in the Electron apps (all three use nodenext).

---

## [Data] Hardcoded File References Go Stale During Active Sessions

**Pattern:** Scripts that hardcode a specific file path or ID (e.g., a debate UUID) fail when the referenced file is overwritten, renamed, or deleted by concurrent user activity during the session.

**Instances:**
- 2026-06-06 — Computational Linguist: `_calibration_review.py` referenced a hardcoded debate file `debate-7362765b-...json` which was overwritten when the user ran a new debate mid-session. Fixed by rewriting the script to dynamically find the 5 most recent debates by modification time instead of hardcoding a debate ID (p/7#13).

**Root Cause:** Data files in this project (especially debates, summaries) are actively written by the user and by enrichment pipelines. A file that existed when the script was written or first run may not exist — or may have different content — minutes later.

**Prevention:**
1. Never hardcode file paths or UUIDs for data files that change — use dynamic discovery (sort by mtime, glob for pattern).
2. For analysis scripts, find recent files at runtime: `sorted(Path(dir).glob('debate-*.json'), key=lambda p: p.stat().st_mtime)[-N:]`.
3. Add a file-existence check before processing and provide a clear error message if the target is missing.

**Applies To:** All agents writing scripts that reference debate files, summaries, or other actively-written data.

---

## [Process] Bash vs PowerShell Tool Confusion

**Pattern:** Running PowerShell cmdlets (e.g., `Get-ChildItem`) in the Bash tool instead of the PowerShell tool, causing syntax errors.

**Instances:**
- 2026-06-06 — Computational Linguist: ran `Get-ChildItem` in Bash tool, causing syntax error. Fixed by switching to PowerShell tool (p/7#13).
- 2026-07-17 — Diagnostics (during triage, p/9#28): ran `$var = ...; (Get-Item $var).Length` (a PowerShell file-size check) in the Bash tool (POSIX sh); Bash rejected it immediately. Fixed by switching to the PowerShell tool. Tell: `$var = ...` assignment with no `export`, a `;`-chained statement, and `.Length` property access on a cmdlet result are all PowerShell, not sh. File-size/`Get-Item`/`Get-ChildItem` checks belong in the PowerShell tool.

**Root Cause:** Agents have access to both Bash and PowerShell tools. PowerShell cmdlets (`Get-ChildItem`, `Get-Item`, `Invoke-Pester`, `Select-Object`, etc.), `$var = ...` assignment, `.Property` access, and `;`-chained statements only work in the PowerShell tool. Unix commands (`ls`, `grep`, `cat`, `stat -c%s`) only work in Bash (on Windows/Git Bash).

**Prevention:**
1. Use PowerShell tool for: cmdlets (`Get-*`, `Set-*`, `Invoke-*`), `$env:` variables, `$var = ...` assignment, `.Property` access on results, pipeline operators with objects. File-size checks: `(Get-Item $p).Length`.
2. Use Bash tool for: Unix commands, `git`, `npm`, `node`, `python3`, shell scripts. File-size in Bash: `stat -c%s <file>` or `wc -c < <file>`.
3. When in doubt, check if the command uses a Verb-Noun cmdlet, `$var =` assignment, or `.Property` access — if yes, it's PowerShell.

**Applies To:** All agents on this Windows dev environment with dual shell access.

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

**Applies To:** All agents writing acceptance/integration tests against the deployed server, especially in AUTH_OPTIONAL mode.

---

## [Type System] Divergent Cross-Package Type Unions Break Main Between Agents

**Pattern:** Two packages define parallel union types for the same concept (e.g., backend IDs). When one agent adds a member to one union without updating the other, `tsc` breaks on main for downstream code that bridges both types.

**Instances:**
- 2026-06-25 — ServerAPI: Shared Lib added `'azure'` to `BackendId` (`lib/ai-client/types.ts`) but the server's `AIBackend` union (`config.ts`) wasn't updated. `resolveBackend()` returns `BackendId`, which feeds `getApiKeys()`/`hasApiKey()` (typed as `AIBackend`), so `tsc` failed with "'azure' not assignable to AIBackend" on `aiBackends.ts:358` + `server.ts`. Fixed by adding `'azure'` to `AIBackend` + `ENV_KEY_NAMES` (commit 318a85b6). Recommended unifying the two unions to prevent recurrence (p/79#3).

**Root Cause:** The same domain concept (AI backend identifiers) is represented by two separate union types in different packages (`BackendId` in `lib/ai-client/types.ts`, `AIBackend` in server `config.ts`). There's no compile-time constraint enforcing `BackendId ⊆ AIBackend`. In a multi-agent environment, different agents own different packages — Agent A adds a member to their union, Agent B's code breaks because their parallel union is now a subset. The break only surfaces when `tsc` runs across the full project.

**Prevention:**
1. **Unify parallel union types** — define the canonical type in one place and import/re-export it. If the server needs a subset, derive it with `Extract<BackendId, ...>`.
2. When adding a member to a union type, grep for other definitions of the same concept across packages: `grep -r "type.*Backend" --include='*.ts'`.
3. After modifying shared types in `lib/`, run `tsc` across all consuming projects (server, taxonomy-editor) before pushing — not just the project you're working in.
4. Consider a CI step that type-checks all packages together, not just the one that changed.

**Applies To:** All agents modifying shared type definitions in `lib/` or server config types.

---

## [Build] Git Commit-by-Pathspec Skips Untracked (New) Files

**Pattern:** `git commit -F msg -- <paths>` fails with "pathspec did not match any file(s)" when the paths include newly created files that haven't been staged with `git add`.

**Instances:**
- 2026-06-25 — DebateUI: `git commit -F msg -- <paths>` failed for newly-created files. Fix: `git add <new-files>` first, then pathspec commit. Self-resolved (deedd783, p/83#3).
- 2026-07-06 — Technical Lead: `git commit -- <pathspec>` on a new file errored "pathspec did not match". Fixed by explicit `git add` then commit (369001bb, p/8#51).
- 2026-07-06 — Computational Linguist: same error on a newly created file. Fixed by `git add` then pathspec commit (p/7#26).
- 2026-07-13 — Taxonomy Editor 2 (t/1563): `git commit -- <existing.tsx> <new-test.tsx>` failed on the untracked test file. Fixed by `git add -- <both>` then commit. Compounding: concurrent broad commit on shared main swept the working-tree .tsx (p/195#1).

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

**Root Cause:** Git's staging index is shared across all processes in the working tree. When multiple agents run `git add` in parallel, they all stage into the same index. A bare `git commit` (without `-- <paths>`) commits the entire index — not just the files the committing agent staged. The follow-up `git reset --soft HEAD~1` compounds the problem: if another agent committed and pushed between the original commit and the reset, HEAD~1 points to a different commit than expected, rewinding their work.

**Prevention:**
1. **Always use `git commit -- <explicit-paths>`** on shared branches — never bare `git commit`. This is ADR-005.
2. Never use `git reset` on a shared branch to undo a pushed commit — once it's on the remote, the commit is shared history. Escalate to TL/DevOps for recovery.
3. If you discover you've swept others' files into your commit but haven't pushed yet: `git reset --soft HEAD~1`, then re-commit with explicit pathspec.
4. If already pushed: do NOT rewrite history. Escalate — the correct fix depends on what other agents have already pulled/rebased on top of it.

**Status:** Active — ADR-005 pathspec rule already in AGENTS.md but this is the first recorded violation with real impact.

**Applies To:** All agents committing to shared branches (main, shared feature branches).

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

**Root Cause:** `--` signals end-of-options to git. Everything after `--` is treated as a literal filename/pathspec — including `-m`, `-F`, and any other flag. This is standard POSIX behavior but surprises agents who think of `--` as "here come the paths" without realizing it also disables all subsequent flag parsing.

**Prevention:**
1. **All flags must come BEFORE `--`:** `git commit -m "msg" -- <paths>`, never `git commit -- <paths> -m "msg"`.
2. Alternative: stage files first with `git add <paths>`, then `git commit -m "msg"` (no `--` needed if the index is already correct).
3. Same rule applies to all git commands: `git diff`, `git log`, `git checkout` — `--` always terminates option parsing.

**Status:** Resolved — AGENTS.md rule (overlay 95e9c3b, p/8#30) + `git-commit-pathspec-flag-order` PreToolUse hook live workspace-wide (p/9#16).

**Applies To:** All agents using git commit with pathspec on any repo.

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

## [Process] Ping-Acknowledge-Then-Idle

**Pattern:** Agents acknowledge a ping (reply, update status) then go idle without re-checking their ticket queue — missing unblocked assigned work that should have started immediately.

**Instances:**
- 2026-07-03 — Fleet audit (p/8#32): 4 agents found idle with unblocked high-priority tickets after being woken by pings. Each had replied to the ping but never checked their queue before sleeping. Hours of lost productivity across the fleet.

**Root Cause:** Startup behavior only checked ticket queue on fresh session start. Ping-triggered auto-prompts re-entered the session mid-life, so the queue check was skipped. Agents treated pings as isolated messages rather than general "you're awake now, check for work" signals.

**Prevention:**
1. Before going idle after ANY prompt (ping, email, auto-prompt — not just session start), re-check ticket queue for unblocked assigned work.
2. Root AGENTS.md startup behavior updated to enforce this (p/8#32, 2026-07-03).

**Status:** Resolved — root AGENTS.md rule updated to require queue re-check before idle after any prompt.

**Applies To:** All agents with ticket-driven workflows.

---

## [Process] One-Directional Git Ancestry Check → False Divergence Alarm

**Pattern:** Diagnosing "remote diverged" based on a one-directional `merge-base --is-ancestor` check and misreading a reverse diff — pattern-matching an expected failure shape without verifying the actual mechanism.

**Instances:**
- 2026-07-03 — Technical Lead: during cc→sit migration (t/1308#12), diagnosed "remote diverged during freeze" and began planning recovery. Root cause hypothesis was that CI committed to `ai-triad-data` during the migration window. DevOps falsified this (t/1308#15): no CI pipeline exists in the data repo, and the commits were the owner's, made before the freeze. Corrected in t/1308#15.

**Root Cause:** Two compounding diagnostic errors: (1) `merge-base --is-ancestor` was only checked in one direction — A ancestor of B doesn't tell you whether B is ancestor of A, so the divergence conclusion was incomplete; (2) a reverse diff was interpreted without labeling which direction (local→remote vs remote→local), leading to misread additions/deletions. Same anti-pattern class as the [Build] Deploy Preflight False-Red (AlertsManagement) — pattern-matching symptoms to a plausible failure without testing the mechanism.

**Prevention:**
1. Divergence claims require the **two-directional ancestry test**: check `merge-base --is-ancestor` in BOTH directions (A→B and B→A) before concluding divergence.
2. Always run `git status -sb` for ahead/behind counts — they directly show the relationship without interpretation.
3. Reverse diffs must be **labeled with direction** before interpreting +/- lines ("this is remote minus local" or "local minus remote").
4. Before planning recovery, verify the *mechanism* of the hypothesized failure — "CI committed during our window" is testable ("does CI exist in this repo?").

**Status:** Resolved — root AGENTS.md "Git forensics" Common Traps rule (bf738f2, p/8#58).

**Applies To:** All agents performing git divergence diagnosis, especially during migrations or freeze windows.

---

## [PowerShell] Empty-String Args to Native Executables

**Pattern:** `ssh-keygen -N '""'` sets the passphrase to the literal two-character string `""` instead of empty — causing silent authentication failure ("Permission denied (publickey)") that takes ~20 min to diagnose.

**Instances:**
- 2026-07-03 — Technical Lead: during t/1308 migration push, `ssh-keygen -N '""'` set a key passphrase to literal `""`. Server accepted the key but signing failed silently. Diagnosed via `ssh-keygen -y -P <candidate>` read-back; fixed in-place with `ssh-keygen -p`. ~20 min lost (p/8#35).

**Root Cause:** PowerShell's quoting rules for native executable arguments. `'""'` is a single-quoted string containing two double-quote characters — it does not collapse to empty. The correct form is `-N ''` (PS7 standard arg passing). Same multi-parser argument corruption family as bash-$-substitution and @'...'@ here-string patterns.

**Prevention:**
1. Use `-N ''` for empty passphrase in PowerShell — never `'""'` or `""`.
2. After setting a passphrase or credential via native executable, **verify the effect immediately** (e.g., `ssh-keygen -y -P '' -f <key>` should succeed).
3. Full trap taxonomy in `docs/powershell-native-quoting-traps.md`.
4. New Common Traps bullet added to root AGENTS.md (p/8#35).

**Status:** Resolved — root AGENTS.md Common Traps updated + `docs/powershell-native-quoting-traps.md` created.

**Applies To:** All agents passing empty-string or special-character arguments to native executables from PowerShell.

---

## [Process] Gate Blindness via Pre-Existing Noise (False-Green)

**Pattern:** A verification gate already exits non-zero from tolerated warnings, so new genuine errors don't change the exit code — "verify green" claims pass with live failures undetected.

**Instances:**
- 2026-07-03 — verify's eslint step was already failing from old warnings. New `RelatedEdgesPanel` errors (t/1304) survived a "green verify" claim because the exit code was already non-zero. Root cause analysis in t/1304#5, fix in c2f79267, gate repair tracked in t/1323 (p/8#37).

**Root Cause:** When a gate is already failing for tolerated/ignored reasons, agents learn to treat its failure as normal. New genuine failures blend into existing noise. Same family as [Build] Deploy Preflight False-Red (AlertsManagement) but **inverted** — false-green instead of false-red.

**Prevention:**
1. Gates must be kept at **zero tolerated noise** — fix or suppress existing warnings before relying on the gate.
2. Use **explicit baselines** (e.g., eslint `--max-warnings N`) so any new warning changes the exit code.
3. Periodically **assert a deliberate failure actually fails the gate**.
4. When claiming "verify green," check the actual exit code and output — not just "it ran without surprising me."

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64). Gate repair still tracked in t/1323.

**Applies To:** All agents running verify gates, CI pipelines, or any pass/fail quality checks.

---

## [Build] Ad-Hoc `tsc` Produces Phantom Errors vs Real Build Gate

**Pattern:** Running bare `tsc` or `tsc -p tsconfig.*.json` outside the project's actual build gate produces misleading errors — missing `@types/node` (no `node_modules`), TS5101 baseUrl deprecation, TS2882 CSS shims — that the real build (`npm run build`) never hits.

**Instances:**
- 2026-07-04 — ElectronMain (workflow-app, t/1333): `tsc -p tsconfig.main.json` errored TS2688 because deps were never installed. Bare `tsc` on renderer errored TS5101 and TS2882 — both non-issues because renderer is type-checked via `vite build`. Fixed by `npm install` + `npm run build` (the actual gate). workflow-app has no verify gate of its own (p/98#3).

**Root Cause:** Electron apps have split type-checking: main process via `tsc -p tsconfig.main.json`, renderer via `vite build`. Ad-hoc `tsc` commands that don't match the real pipeline produce false positives or catch environment problems (missing deps), not code problems.

**Prevention:**
1. Always use the project's actual build gate (`npm run build`, `npm run verify`) — not ad-hoc `tsc`.
2. Run `npm install` before any type-checking in a project where `node_modules` doesn't exist yet.
3. Know which tsconfig covers which code: `tsconfig.main.json` = main process; renderer = `vite build`.

**Status:** Active

**Applies To:** All agents working in Electron apps.

---

## [Process] Gate-Flip Hygiene — Exemptions Must Live in Workflow Comments

**Pattern:** Two agents independently mislabeled a permanently annotation-only CI job (`debate-eval`) as "warning-only until 7/17" — a scheduled flip date that doesn't apply to this job. Scheduled flip dates create gravitational pull that sweeps in exempt jobs.

**Instances:**
- 2026-07-06 — Two agents independently added "warning-only until 7/17" to `debate-eval` despite it being permanently annotation-only and exempt from the flip sweep (t/1329#4, t/1332#4).

**Root Cause:** The exemption existed only in ticket history, not at point of use. Agents pattern-matched the job to the "warning-only until flip date" convention without verifying this job's specific lifecycle.

**Prevention:**
1. Jobs exempt from a flip sweep need the exemption **in the workflow file comment**, not in ticket history.
2. Verify the specific job's intended lifecycle before applying fleet-wide conventions.

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** All agents modifying CI workflow files or gate annotations.

---

## [Build] Registry Credential on Public Image Turns Credential Rot into Outage

**Pattern:** A stored GHCR PAT expired, but ACA authenticates EVERY pull when a registry credential is configured — so the dead PAT broke pulls of a PUBLIC image that anonymous pulls would have served fine. Total production outage, undetected 11+ hours.

**Instances:**
- 2026-07-05 — PROD OUTAGE: expired GHCR PAT → ACA authenticated pulls → ImagePullBackOff on 100%-traffic revision. No alerting. Restored via cached healthy revision, permanently fixed by removing credential. Hardening: t/1335, t/1336, t/1337 (p/8#41).

**Root Cause:** (1) Registry credentials on public images force authenticated pulls where anonymous would succeed — credential expiry becomes outage. (2) No alerting on ACA revision health. (3) Bicep re-adds the credential on deploy (IaC drift).

**Prevention:**
1. Never configure registry credentials for public images.
2. Remove from Bicep, not just CLI (IaC drift restores it).
3. Add Degraded-revision alert + external uptime probe.
4. Verify-then-promote traffic gate for new revisions.

**Status:** Active — hardening in t/1335, t/1336, t/1337.

**Applies To:** DevOps, Azure infrastructure, container deployment.

---

## [Build] ACA Revision Snapshots Freeze Config at Creation + az CLI Swallows 409

**Pattern:** ACA bakes registry credentials into each revision's snapshot at CREATION time. App-level config changes do NOT affect existing revisions. Compounding: `az containerapp registry remove` exits 0 while ARM silently rejects with 409.

**Instances:**
- 2026-07-05 — During outage remediation: "30-60 second" estimate became ~75 min because the mental model ("config applies live") was wrong. `az containerapp registry remove` appeared to succeed but ARM rejected with 409. Only a new revision picked up the change (p/8#42).

**Root Cause:** (1) Revision snapshots are immutable — config is baked at creation, survives restarts. (2) az CLI swallows ARM 409 errors — exit 0 with no output on failure.

**Prevention:**
1. Always read back config after mutations — don't trust az CLI exit codes.
2. Config changes require a new revision (revision copy), not just a restart.
3. Factor immutable snapshots into maintenance time estimates.

**Status:** Active — design constraints in t/1335.

**Applies To:** DevOps, Azure infrastructure, ACA config changes.

---

## [Build] Multi-Agent Git — Worktree Landing Race Creates Duplicate Commits

**Pattern:** Agent commits X on shared local main, cherry-picks X' into a worktree and pushes X'. Original X lingers unpushed and later sweeps to origin = byte-identical duplicates.

**Instances:**
- 2026-07-05 — Happened twice on t/1295 (commits 4 and 5) before root-cause. Agent committed on shared local main, cherry-picked into worktree, pushed. Originals swept to origin later (p/8#45).

**Root Cause:** Local main is shared across all agents. Committing there as a staging step leaves orphaned commits that travel to origin when any agent pushes.

**Prevention (ratified fix, t/1295#15, p/8#46):**
1. Create worktree off fresh `origin/main`, not the shared local ref.
2. Copy changed files in, add+commit+push INSIDE the worktree — nothing lingers on shared tree.
3. Sync shared tree with file-scoped `git checkout origin/main -- <files>` — never reset.
4. Run verify gate inside the worktree.

**Status:** Active — ratified fix in place. Pairs with shared-branch pathspec rule.

**Applies To:** All agents using git worktrees on shared local repos.

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

## [Build] Uncommitted Fixes Mask Committed Breakage — Dirty Working Tree as False Witness

**Pattern:** A multi-step refactor deletes a module and fixes its importers, but only the deletion is committed — the importer fixes remain uncommitted in the shared working tree. Local verify passes (reads dirty tree), committed state is broken. Compounding: diagnosing "is main green?" by building the dirty shared tree produces a false-green that overrules a clean-worktree agent who was correct.

**Instances:**
- 2026-07-06 — Technical Lead (t/1303 Phase C): deleted a module and fixed 2 importers but left the importer fixes uncommitted. Local verify green, committed state red for hours. TL then "verified main is green" using the dirty shared tree, contradicting a clean-worktree agent who was correctly seeing the breakage. Diagnostic standard established in t/1303#7 (p/8#49).
- 2026-07-12 — Computational Linguist (t/1553): uncommitted enrichment UsageID in shared working tree read as "CL authored this." CL never authored it; authorship unestablishable. **Variant:** presence read as AUTHORSHIP, not build state (p/40#7).
- 2026-07-16 — Technical Lead (t/1618 Z.AI outage, resolved c51018af): committed `ai-models.json` was clean, but an uncommitted 2026-07-16 "refresh" dropped 36 models; the user runs uncommitted local builds, so the local runtime hit a broken state CI never would. Settled by `git show origin/main:ai-models.json`. **Inverse variant:** dirty tree *introduced* breakage into the runtime instead of hiding committed breakage — mirror image, same forensic resolution (p/8#69).

**Root Cause:** `tsc` and `npm run verify` read the working tree, not the git index. In a multi-agent environment, the shared working tree accumulates uncommitted changes from multiple agents — it's never a reliable proxy for committed state. **Authorship variant:** working-tree presence carries no provenance — treating "it exists" as "agent X approved it" is the attribution form of false witness. **Inverse variant:** the dirty tree cuts both ways — it can hide committed breakage OR inject breakage absent from committed state; when the user runs uncommitted local builds, their runtime is whatever is on disk, not what CI sees.

**Prevention:**
1. **Commit ALL files in a refactor atomically** — deletions and their importer fixes in the same commit. Never commit a deletion without its dependents.
2. After committing, run verify to confirm the COMMITTED state is green (the existing Definition of Done rule).
3. **Disputes about committed state are settled at the git object level**, not by building the working tree:
   - `git show HEAD:<path>` — does the file/export exist in committed code?
   - `git grep <pattern> HEAD` — search committed content only
   - `git cat-file -e <sha>:<path>` — verify a path exists at a specific commit
   - `git stash && npm run verify && git stash pop` — build committed state only
4. **Never attribute uncommitted shared-tree changes** — authorship requires a commit SHA or activity event.
5. Pairs with the "Verify Before Pushing" rule in root AGENTS.md as its diagnostic complement.

**Status:** Resolved — root AGENTS.md "Git forensics" Common Traps rule (bf738f2, p/8#58).

**Applies To:** All agents on shared working trees, especially when diagnosing "is main broken?"

---

## [Process] Overwrite/Clobber Claims & Config-Failure Triage Without Object-Level Verification

**Pattern:** A "commit X broke/overwrote F" claim is asserted from the **working tree** (grep, symptom counts, commit dates) instead of the committed object, then retracted when someone finally checks the object. Two shapes: (a) a clobber claim churned across diagnostic rounds; (b) a **config failure** (missing entry, BOM, wrong value in the working-tree config file) attributed to a commit — when the committed code was correct all along and the divergence lived only in the local working tree.

**Instances:**
- 2026-07-06 — Computational Linguist + 2nd agent (t/1351): a git-forensics clobber claim went through 3 diagnostic rounds across 2 agents. Ancestry got inverted twice. Resolved only when blob SHAs were compared: `git rev-parse X:path` vs `git rev-parse X~1:path` — identical blob = file untouched, debate over in one command (p/7#22).
- 2026-07-17 — Diagnostics (**2nd config-failure instance**, p/9#30): a flight recorder showed `zai-glm-5-2` missing from `ai-models.json` + a BOM. Diagnostics **grepped the working tree** and attributed both to a revert commit — never running `git show HEAD:ai-models.json`. The committed code was correct; the divergence was working-tree-only. The memory rule ("`git diff HEAD -- <configfile>` before blaming a commit for config") **existed but was not applied under triage pressure** — the 1st config instance was the t/1618 Z.AI triage.

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

## [Type System] New Flight Recorder Event Type Not Added to EventType Union

**Pattern:** A new flight recorder event (e.g., `'state.save-coalesced'`) is emitted at the call site but not added to the `EventType` union in `lib/flight-recorder/types.ts`, causing a `tsc` failure.

**Instances:**
- 2026-07-10 — Taxonomy Editor: added `'state.save-coalesced'` event emission (t/1468) but forgot to extend the `EventType` union in `lib/flight-recorder/types.ts`. `tsc` caught it. Fixed in 37ed8841 (p/6#15).

**Root Cause:** The flight recorder's `record()` call accepts an `EventType` string literal union. Adding a new event at the call site is easy — the string is just typed inline — but the union in `types.ts` is a separate file that must also be updated. No compiler error appears at the call site until `tsc` runs (the literal is narrower than `string`, so autocompletion doesn't force you through the union).

**Prevention:**
1. When adding a new flight recorder event, update `EventType` in `lib/flight-recorder/types.ts` FIRST, then use it at the call site — the union is the source of truth.
2. After adding any new string literal to a recorder call, grep for `type EventType` to find the union and add the new literal.
3. Same family as #36 (divergent cross-package unions) but single-file: the union and its usage sites are in different files within the same package.

**Status:** Active

**Applies To:** All agents adding new flight recorder events.

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

## #61 [Build] UsageID Config Field Mismatch — systemMessage vs systemMessageTemplate

**Pattern:** UsageID config has `systemMessage: '{{prompt}}'` but `Invoke-AIByUsage` only renders `systemMessageTemplate` — placeholder goes unrendered, model runs with literal `{{prompt}}` as its system message (effectively no instructions), produces plausible-looking garbage.

**Instances:**
- 2026-07-12 — Computational Linguist (t/1550#3): aphorism UsageID had `systemMessage:'{{prompt}}'` instead of `systemMessageTemplate`. Model ran with no real instructions, produced famous-quote misattributions that masqueraded as a model-quality issue. Fixed in 6e4fe06a; lint ticket t/1552 filed (p/40#3).

**Root Cause:** `systemMessage` is static (verbatim), `systemMessageTemplate` is rendered with `{{var}}` substitution. Putting template placeholders in the wrong field silently no-ops — the `{{prompt}}` string passes through as literal text, which the model interprets as an empty/meaningless instruction. The output looks plausible enough that the failure mode reads as "model quality" rather than "config error."

**Prevention:**
1. Any `{{...}}` placeholder MUST be in a `*Template` field (`systemMessageTemplate`, not `systemMessage`).
2. Lint rule (t/1552): warn on `{{...}}` patterns in non-template fields.
3. Same gate-signal-integrity genus as #20/#46/#48: a config that silently no-ops reads as "working."

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64). Lint rule still tracked in t/1552.

**Applies To:** All agents authoring or modifying UsageID configs in `ai-usages.json`.

---

## #62 [Process] Same-Role Instance Duplication — No Claim Step Before Filing

**Pattern:** Two instances of the same role independently action the same shared tracker within minutes, filing duplicate phase/child tickets. No claim step on the tracker prevents the race.

**Instances:**
- 2026-07-13 — Computational Linguist: CL Main and CL.Investigate1 filed duplicate Phase 2 tickets (t/1577 vs t/1579) for the same tracker within 2 minutes. Second same-day near-dup after parallel answers on t/1560. Cost: dup-close + an AC nearly lost in consolidation (p/40#9).

**Root Cause:** Multiple instances of a role share the same ticket board and context, but have no coordination protocol for claiming work from shared trackers. Classic check-then-act race.

**Prevention:**
1. Announce intent on the tracker ticket BEFORE cutting child tickets — add a comment "claiming Phase 2" and wait for the comment to land before filing.
2. Search open tickets for the scope first — `search_tickets` for the tracker key + phase label before creating.
3. When consolidating dups, merge ACs from both — don't just close the second; it may have unique criteria the first lacks.

**Status:** Active

**Applies To:** All roles with multiple active instances sharing a ticket board.

---

## #63 [Build] az containerapp update Does Not Support --revision-mode

**Pattern:** `az containerapp update --revision-mode` silently fails or errors — the CLI subcommand doesn't accept that parameter. Must use `az rest PATCH` to the ARM endpoint or Bicep to change revision mode.

**Instances:**
- 2026-07-14 — DevOps (t/1500): dry-run on throwaway branch failed because `az containerapp update` doesn't accept `--revision-mode`. Fixed by swapping to `az rest PATCH` with body `{'properties':{'configuration':{'activeRevisionsMode':'Multiple'}}}` (p/26#5).

**Root Cause:** Azure CLI coverage gaps — not every ARM property is exposed via the convenience CLI. `az containerapp update` handles env vars, image, scale, etc. but NOT `activeRevisionsMode`. The error message doesn't suggest the correct approach.

**Prevention:**
1. Before scripting an `az containerapp update` with a non-standard flag, verify it's in `az containerapp update --help`.
2. For properties not in the CLI, use `az rest` PATCH to the ARM endpoint directly.
3. Same genus as the ACA env-var drift trap (CLI vs Bicep divergence): the CLI is a convenience layer with gaps.

**Status:** Active

**Applies To:** DevOps, any agent scripting Azure Container Apps configuration changes.

---

## #64 [Build] RawBody Truncation Causes SPA Shell False Positive

**Pattern:** HTTP response body read capped at 400 chars for acceptance tests. SPA HTML shell is 464+ chars before `<script>` tags. Truncated body never contains the script marker, so the "is the app alive?" check always fails even when the app is healthy.

**Instances:**
- 2026-07-14 — DevOps (t/1500): blue-green deploy acceptance test used 400-char RawBody cap. SPA shell exceeded that before any script tags appeared, causing guaranteed false positive on every deploy. Fixed by bumping cap to 4096 (p/26#7, p/8#61).

**Root Cause:** The body-read cap was set for "enough to check a status code" but the correctness check needed content deep in the response. A size cap on an HTTP body read is a silent data loss when the check depends on content past the cap.

**Prevention:**
1. HTTP body reads must NOT be size-capped when response content matters for correctness checks — set the cap to accommodate the largest expected response, or remove it entirely for small responses.
2. Test the acceptance check against the actual response size, not just a mock.
3. Same gate-signal-integrity genus as #20/#46/#48/#61: a check that structurally cannot pass reads as "app is broken" when the check is broken.

**Status:** Resolved — root AGENTS.md "Gate Verification" + "Gate Co-Location" rules (overlay 5732aa7, t/1589). Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** DevOps, any agent writing HTTP-based acceptance or health checks.

---

## #65 [Build] Format-Table Wrong Property Names — Silent Empty Columns

**Pattern:** PowerShell `Format-Table` with `-Property` names that don't match the actual object properties silently produces empty columns instead of erroring. Diagnostic output looks "blank" rather than "wrong."

**Instances:**
- 2026-07-14 — DevOps (t/1500): GHA step used `Format-Table -Property StatusCode, Detail` but the `EndpointTestResult` object had `Status` and `Error` properties. All diagnostic columns were blank — no error, no warning (p/26#7, p/8#61).

**Root Cause:** PowerShell's formatting system is lenient — referencing a non-existent property yields `$null`, which renders as empty. `Format-Table` never throws on missing properties. In a CI log, empty columns look like "no data" rather than "wrong column names."

**Prevention:**
1. Verify `Format-Table` property names against the actual object type — use `Get-Member` or inspect a sample object before scripting the format.
2. In CI/GHA scripts, add a validation step that checks at least one row has non-null values in the formatted columns.
3. Prefer `Select-Object` (which also silently nulls, but at least the object is inspectable downstream) over `Format-Table` when the output feeds into further processing.

**Status:** Active

**Applies To:** All agents writing PowerShell formatting for CI/diagnostic output.

---

## #66 [Build] Stacked-Branch Landing — Merge in Stack Order with --no-ff

**Pattern:** When two branches are stacked (the child branched off the parent) and both touch the same file, landing them without respecting stack order — or squashing the base — forces an avoidable rebase of the child and manufactures merge conflicts.

**Instances:**
- 2026-07-16 — Technical Lead (t/1585, t/1601): landing `land/t-1585` into the worktree hit a merge conflict in `DebateTestedDrilldown.tsx` because t-1585 and t-1601 both touch that file and t-1601 is stacked on t-1585. Resolved by merging with `--no-ff` in dependency order (t-1585 before t-1601) so the stack stayed intact and no rebase was needed (p/8#67).

**Root Cause:** A stacked child branch's commits are written on top of the parent's commits. If the parent is squashed or merged out of order, the child's base no longer matches history, so git must replay (rebase) the child's diffs against a changed base — re-deriving conflicts in any shared file. Merging the parent first with `--no-ff` preserves the base commit the child was built on, so the child merges cleanly.

**Prevention:**
1. For stacked branches sharing a file, merge in stack order (base before child) using `--no-ff` — never squash the base.
2. Do not rebase the child unless the base's history genuinely changed; ordered `--no-ff` merges avoid the need entirely.
3. Track stack dependencies explicitly (ticket parent/child or a note) so the landing order is unambiguous before you start.

**Status:** Active

**Applies To:** All agents landing stacked feature branches, especially via the worktree landing procedure.

---

## [API] Lossy Error Boundaries — Success/Failure Detail Discarded at the Provider Edge

**Pattern:** At the boundary between our code and an AI provider, the specific success/failure detail — the provider's own error reason, the resolved model id, the actual key source — is discarded and replaced with a generic message, a verbatim-but-unmapped value, or an empty/`(none found)` string. Diagnosis loses the one fact that would have pointed at root cause.

**Instances:**
- 2026-07-16 — Technical Lead (t/1618 / t/1619, Z.AI outage, resolved c51018af): an unmapped Z.AI model id was passed **verbatim** to the provider instead of being validated against the registry — the failure surfaced as a raw provider error, not "unknown model id X" (p/8#69).
- 2026-07-16 — Technical Lead (t/1620): the Gemini API-key test **collapses the provider's reason** into a generic failure string — Google's actual reason never reaches the user (p/8#69).
- 2026-07-16 — Technical Lead (t/1621), root-cause detail from PowerShell (p/20#16), fixed **cd020938**: `Test-AIApiKey` reported `KeySource="(none found)"` on an HTTP **200**. Mechanism: it read AIEnrich's private `$script:LastApiKeySource` through a cross-module scriptblock (`& (Get-Module AIEnrich) {…}`), which **throws when `Get-Module` resolves 0 or >1 module objects**; the throw was swallowed by `catch{$null}`, so a genuinely-resolved key surfaced as absent. A lossy *success* path — the **diagnostic read silently degraded its own reporting** while the primary path (`Invoke-AIApi`, same-scope read) worked fine. Fix: an exported accessor bound to the same module instance.
- 2026-07-17 — **Diagnostics** (t/1626, flight-recorder triage of debate `a7ddc788`, model `zai-glm-5-2`), ticketed to Taxonomy Editor — **the 5th instance, which broadens the genus.** `parseAIJson` (`lib/debate/helpers.ts:53-90`) ran all 3 recovery strategies and **silently returned `null` on a valid 6728-char body**, so claim-extraction threw and **all 7 of the debater's claim sketches were discarded** (0-of-7; `an_nodes:0`) even though `has_debater_claims:true`. Two lossy facets: (a) **generic recovery masked a real payload** — a null parse dropped everything instead of falling back to the debater's already-present sketches; (b) the failure event captured **head-only** `response_preview`+`raw length`, so a *truncated* response was indistinguishable from a *malformed body* without the raw text. This site (`parseAIJson`/`argumentNetwork.ts`) sits **outside the t/1623 hook's current path scope** — the genus now extends past the provider edge to any generic recovery/parse boundary that discards a recoverable payload.

**Root Cause:** Status/error handling at provider boundaries collapses rich provider responses into generic strings (or drops them entirely). No `ActionableError`/`New-ActionableError` captures Goal/Problem/Location/Next Steps at the edge, so the provider's verbatim reason, the resolved model id, and the detected key source are thrown away before anyone can read them. The tell is uniform: **success/failure detail discarded at the boundary** — on the error path (generic message) and the success path (`(none found)` on a 200) alike. A sharp sub-species (t/1621): a **diagnostic/observability read that swallows its own failure** (`catch{$null}`, sentinel default) degrades silently while the primary path works — you get a confident false-negative about a healthy system.

**Prevention:**
1. At every AI provider boundary, **preserve the provider's own reason/detail** in the surfaced error — never replace it with a generic message (ADR-001).
2. Use `ActionableError` / `New-ActionableError`: **Problem** carries the provider's verbatim reason, **Location** names backend+model, **Next Steps** names the config fix.
3. **Echo the resolved identity** (mapped model id, detected key source) on BOTH success and failure paths — a success that reports `(none found)` is a lossy success, not just a lossy error.
4. **Validate model ids against the registry** before calling the provider — never pass an unmapped id verbatim; fail with the unknown id named.
5. **Never let a diagnostic/observability read swallow its own failure** — a `catch{$null}` or sentinel default on a status/health read reports a false-negative on a working system. Surface the read's own failure distinctly from the thing it observes; bind cross-module/scope reads to the resolved instance (exported accessor) rather than a scriptblock that can throw on 0/>1 module resolution.
6. **Generic recovery must not discard a recoverable payload** (t/1626). When a parse/recovery step fails but usable upstream data already exists (e.g. debater-supplied claim sketches present on the turn), **fall back to it** rather than emitting the worst-case empty result — dropping 7-of-7 sketches on a `parseAIJson`→null is a data-loss bug, not graceful degradation. And make the failure event **diagnosable**: capture head **+ tail (bounded)**, a `response_truncated` flag, and which recovery strategy failed / the terminal `extractionTrace.status`, so a *truncated* response is distinguishable from a *malformed body* without the raw text.

**Status:** Active (defenses in force) — **escalation triggered + resolved (5th instance, 2026-07-17).** 5 instances across t/1618–t/1621 + t/1626, **3 reporting agents** (TL, PowerShell, Diagnostics). The genus **broadened** from the provider edge to *any generic recovery/parse boundary that discards a recoverable payload* (t/1626: `parseAIJson`→null in `lib/debate/helpers.ts` / `argumentNetwork.ts`). Two-track defense, **both landed 2026-07-17:** (1) **Mechanical (PRIMARY) — Diagnostics expanded the t/1623 hook (p/9#23):** `lossy-error-boundary-guard` now watches a **2nd boundary family (Family B)** — `lib/debate/helpers.ts` (`parseAIJson`/`repairJson`) + `argumentNetwork.ts` extraction — with a genus-tailored checklist (don't drop a non-empty recoverable body to null; fall back to debater sketches; capture head+tail+truncation flag; flight-record before dropping). No new prose rule, per recommendation. **Verified live + t/1623 closed (p/9#25, object-level, t/1623#3):** the compiled template (Family A + Family B + self-skip) is intact across **55 manifest snapshots** (was 0), and both Family-A blockers also landed — t/1620 (333a673d), t/1621 (cd020938). Liveness was confirmed via manifest presence + live-fire, NOT `has_run` (pattern #68) — the manifest-compile lag (t/1625) cleared on the next sync as expected. (2) **Behavioral (minimal, debate-local) — TL ruled (p/8#75)** a ONE-line rule in **lib/debate/AGENTS.md** (NOT root; overlay, owner = DebateTool) that must **NOT restate ADR-001**, while the point-of-use hook stays the primary defense. **DebateTool landed it (p/70#5, overlay 31e0eeb, Sage co-author):** the recovery-vs-silent-loss bullet — *a recovery that returns a sentinel (null/empty/default) while discarding a non-empty payload is a **silent lossy failure, not recovery** — record discarded bytes + surface.* Escalation closed.

**Applies To:** All AI backend/provider integration code — server `aiBackends.ts`, PS key-test cmdlets (`Test-AIApiKey`), debate-engine adapters, debate JSON-recovery sites (`lib/debate/helpers.ts` `parseAIJson`/`repairJson`, `argumentNetwork.ts` extraction), and any UsageID call site surfacing provider errors.

---

## #67 [Build] PowerShell Through the Bash Tool — Git Bash Eats Shell Operators Before pwsh Sees Them

**Pattern:** Running a PowerShell pipeline through the **Bash tool** (which is Git Bash) fails when shell metacharacters — a pipe `|` or a backtick line-continuation — sit **outside** the `pwsh -Command '...'` string. Git Bash interprets them itself before pwsh is invoked, so the pipe splits the command at the bash level and the backtick is consumed as a bash escape, producing truncated commands or `unexpected EOF` rather than the intended pwsh pipeline.

**Instances:**
- 2026-07-17 — PowerShell (during t/1621 work, p/20#17): two failures piping PowerShell through the Bash tool — `pwsh -Command '...' | Something` sent the `|` to bash (not the pwsh pipeline), and a backtick line-continuation was eaten by bash before pwsh saw it. Fix: keep the whole pipeline inside a single `pwsh -Command '...'` string, or use the PowerShell tool directly.

**Root Cause:** The Bash tool is Git Bash, not pwsh. Only text **inside** the quoted `-Command '...'` argument reaches PowerShell; everything else on the line is parsed by bash first. `|`, `` ` ``, `$`, `>`, `&&` and friends are bash metacharacters — placed outside the quoted command string they are consumed by bash, so pwsh receives a fragment. Distinct mechanism from quote-delimiter collision ("Bash Heredoc Failures with Nested Quotes") and `$`-substitution corruption — here the failure is a **shell operator leaking out of the command string**, not a mangled literal.

**Prevention:**
1. **Prefer the PowerShell tool** for any PowerShell work — the fleet default; sidesteps the two-shell problem (root AGENTS.md Search Tooling Rule points the same way).
2. Through the Bash tool, keep the **entire** pipeline inside one `pwsh -Command '...'` string — every `|`, `` ` ``, and `$` must live inside the quotes so pwsh, not bash, parses them.
3. Never rely on bash line-continuation (trailing `` ` `` or `\`) to span a pwsh command across Bash-tool lines — one logical line inside the quoted string, or write a script file (Shell Quoting Rule) and run it.

**Status:** Active

**Applies To:** All agents running PowerShell through the Bash tool on Windows/Git Bash.

## #68 [Process] Orca Feedback-Rule Tooling Lies About Liveness — Manifest-Lag + False Audit Counters

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

## #69 [Process] Post-Compaction Summary Framing Trusted Over Object State — Phantom Loose End

**Pattern:** After a context compaction, a stale post-compaction summary frames already-completed, already-committed work as an outstanding "uncommitted deliverable" or "loose end." Acting on the summary's framing instead of the object-level truth (git refs + ticket status) produces wasted redo, a duplicate ticket against work that's already Done, or an attempted re-commit of already-committed content.

**Instances:**
- 2026-07-17 — Computational Linguist (p/7#37): a post-compaction summary framed a redundant essay copy (`analyses/bronder-…`) as "the uncommitted deliverable," when the canonical review (`docs/instrument-effects-review.md`) was **already committed + CLOSED** with follow-up tickets t/1668–1673 filed. Acting on the framing, CL filed a **duplicate PM ticket (t/1684) against the already-Done t/1673**, then a `git mv` of the essay into `docs/` aborted "destination exists" — the git error was what finally surfaced the true state. Resolved: cancelled t/1684, reverted the essay to committed state, verified via same-commit blob provenance.

**Root Cause:** A compaction summary is a lossy narrative reconstruction, not a source of truth. It can misrepresent *committed* state (a file it calls "uncommitted" is already in a commit) and *ticket* state (work it calls "unrouted" already has a Done ticket). Trusting the framing over the object state is the same failure as citing the working tree as evidence of committed state (Git Forensics #44/#54/#55) — extended to a second object domain: **ticket status**. The compaction boundary is the trigger; the summary is confident but stale.

**Prevention:**
1. **After any compaction, treat "loose end" claims in the summary as unverified.** Before acting, confirm against object state: `git log/show <path>` and blob-SHA provenance for "uncommitted"; `list_tickets`/`get_ticket` for "unrouted"/"undone."
2. **Before filing a follow-up ticket, `search_tickets` for the scope** — a summary that doesn't mention an existing Done ticket is not evidence one doesn't exist (same dup-prevention step as #57 Same-Role Instance Duplication).
3. **A destination-exists / already-committed error is a signal, not just an obstacle** — when git or the tracker contradicts the summary's framing, the object state wins; stop and re-derive from it (root AGENTS.md "Git forensics — object level, never inference").

**Status:** Active

**Applies To:** All agents resuming after a context compaction — especially before committing a "loose end," filing a follow-up ticket, or re-doing a deliverable a summary calls incomplete.

## #70 [Build] Vitest Mock Harness — Re-Exporting a Mocked Module Through the Harness Resolves to `undefined`

**Pattern:** When splitting a vitest file that shares a mock harness, re-exporting a mock-dependent module (e.g. the zustand store) **through** the harness — so split files do `import { useStore } from './storeTestHarness'` — resolves to `undefined` in the importing test file. `vi.mock`'s hoisting applies only to the module graph the harness itself imports; the cross-file re-export binding breaks, so the store the split file receives is undefined (tests fail with "cannot read property of undefined," not a mock error).

**Instances:**
- 2026-07-17 — Taxonomy Editor (t/1690, ADR-007 Phase-2 test split): splitting a `useDebateStore` vitest file with a shared mock harness. Re-exporting the store through the harness gave `undefined` in the split test files. Fix: each split file imports the **harness FIRST** (for its hoisted `vi.mock` side-effects) then imports the store **DIRECTLY from its own module** — never through the harness. Verified with a one-block throwaway experiment before committing the full split (p/6#21).

**Root Cause:** `vi.mock` is hoisted and scoped to the file/module graph where it is declared. A shared harness that declares the mocks and then re-exports a mock-dependent module does NOT extend the mock's interception across a re-export boundary into a *sibling* test file cleanly — the re-exported binding resolves before/around the hoisted mock and comes back `undefined`. The harness's value is its **side-effect** (registering the mocks), not its role as a re-export hub. Same genus as the "Vitest Dynamic Import Misses Exports From vi.mock Factory" pattern (vi.mock hoisting has non-obvious module-resolution effects), different failure mode: static re-export vs dynamic `import()`.

**Prevention:**
1. **A mock harness is imported for side-effects, not for re-exports.** In each split file: `import './storeTestHarness'` (or a named setup) FIRST to register the hoisted `vi.mock`s, THEN `import { useStore } from '<store's own module>'` directly.
2. **Never route a mock-dependent module through the harness as a re-export** — the store/module must be imported from its own path in every file that uses it.
3. **Prove the split with a one-block throwaway experiment before committing** — a single test importing the harness + store directly confirms the store resolves non-`undefined` before you fan the split out across many files.

**Status:** Active

**Applies To:** All agents splitting or authoring vitest files that share a mock harness — especially the ADR-007 Phase-2 test-file splits (large `*.test.ts` broken into `__tests__/` modules around a shared harness).

## #71 [Build] Post-Deploy Smoke-Test Aggregate Boolean False-Reds a Healthy Prod Deploy

**Pattern:** `Invoke-TaxEditorSmokeTest` reports **Overall FAIL** on a fully healthy prod deploy because the aggregate boolean folds together several orthogonal false-red classes, each of which trips independently. Trusting the top-level Overall boolean instead of the per-category breakdown reads a healthy deploy as broken.

**Instances:**
- 2026-07-16/17 — DevOps: three orthogonal false-red classes plus a CI-fold, all landing on the same Overall FAIL boolean (p/26#12):
  1. **Easy-Auth Sign-In interstitial on API routes** — the smoke hit protected API routes and got Azure Easy-Auth's HTML sign-in interstitial instead of the API response (t/1657, fixed).
  2. **Same interstitial on the `/` SPA root** (t/1657 residual, fixed **6404b682**) — the reclassify step must run **AFTER** the SPA-shell check and must match **any dash** in the title (`[-–—]`, hyphen + en/em dash), or a healthy shell reads as an auth wall.
  3. **Health-phase 15s timeout on scale-from-zero cold start** — a consumption-tier cold start exceeds the 15s health-phase timeout though the app is healthy once warm (t/1696, **open**).
  4. **CI fold:** `OverallPass` folds in the GitHub `ci.yml` conclusion, so a healthy deploy **cannot** show Overall PASS while CI is red — the deploy's health and CI's health are conflated in one boolean.

**Root Cause:** The smoke test collapses independent health dimensions (per-route auth reachability, SPA-shell rendering, health-endpoint latency, and the separate CI conclusion) into a single Overall boolean. Any one false-red — an auth interstitial mistaken for a failure, a cold-start latency blip, a red CI run unrelated to this deploy — forces Overall FAIL even when the deploy is healthy. Same gate-signal-integrity genus as the arm-deploy false-red (#20/#46/#48/#61/#64): an aggregate signal with tolerated/orthogonal failure inputs can't cleanly report the thing it's supposed to gate.

**Prevention:**
1. **On a post-deploy smoke, read the per-category breakdown, not the Overall boolean.** The boolean is a rollup of orthogonal checks; triage from the category rows (auth, SPA-shell, health-latency, CI).
2. **Reclassify ordering + dash matching:** an auth-interstitial reclassify must run AFTER the SPA-shell check (so a healthy shell isn't reclassified as an auth wall) and must match any dash variant (`[-–—]`) in the page title.
3. **Separate cold-start latency from health failure** — a scale-from-zero cold start needs a warm-up retry or a longer health-phase budget than 15s; don't let a first-hit timeout on a consumption-tier app read as unhealthy (t/1696).
4. **Don't fold an unrelated CI conclusion into deploy health** — or if you must, surface it as its own row so a red CI doesn't mask/force the deploy verdict.

**Status:** Active — classes 1 & 2 fixed (t/1657, 6404b682); class 3 open (t/1696, cold-start health-timeout); CI-fold is by-design but must be read per-row. Part of gate-signal-integrity genus (#20/#46/#48/#61/#64).

**Applies To:** DevOps and anyone triaging a post-deploy smoke result — read the category breakdown, never the Overall boolean alone.

## #72 [Build] Landing-Worktree Pre-Push Friction — Verify Dirties Tracked Artifacts + origin/main Advances

**Pattern:** In a landing worktree, the step between `npm run verify` and `git push` hits two recurring, orthogonal frictions that each abort the push/rebase and are easy to misread as a real conflict: **(A)** the verify run (vitest) **regenerates a tracked artifact** — e.g. a `*.snap` snapshot re-written with flipped LF↔CRLF line endings — so the tree is dirty with a change you didn't make, and `git rebase origin/main` fails "cannot rebase: you have unstaged changes"; **(B)** under the active push cadence **origin/main advances every few minutes**, so a `&&`-chained fast-forward guard (`git merge-base --is-ancestor origin/main HEAD`) returns non-zero and the push step exits 1 — and `git diff HEAD..origin/main` **false-flags your OWN unpushed split files as "overlap"** (they differ only because origin doesn't have them yet).

**Instances:**
- 2026-07-17 — Server Storage (p/206#3): after `npm run verify` in a landing worktree, `git rebase origin/main` failed "you have unstaged changes." Cause: verify regenerated `src/server/__tests__/__snapshots__/routeTable.test.ts.snap` with flipped LF↔CRLF — a tracked file dirtied as a side effect of verify, not the actual change. Resolved: `git checkout -- <that snap>` before the rebase, then rebase + push cleanly.
- 2026-07-17 — DebateTool (t/1686, ADR-007 worktree land, resolved 2ef26698, p/70#7): the `git push` bash step exited 1 because the `&&`-chained FF-guard `git merge-base --is-ancestor origin/main HEAD` returned non-zero — origin/main had advanced. Compounding, `git diff HEAD..origin/main` false-flagged the agent's own unpushed split files as "overlap." Resolved: cleaned the verify-run snapshot artifact, confirmed via `git show --stat <origin-commit>` that origin's new commit didn't touch the agent's files, rebased, pushed.

**Root Cause:** (A) Verify is not read-only — vitest rewrites snapshot files, and on Windows a regenerated snapshot can come back with the opposite line endings (LF↔CRLF), leaving a tracked file modified. Git refuses to rebase with a dirty tree, so a side-effect artifact blocks the land. (B) The FF-guard and the `diff` comparison both assume origin/main is stationary, but the fleet's push cadence advances it constantly; the guard's non-zero exit is expected, not an error, and `git diff HEAD..origin/main` shows your own not-yet-pushed files as differences — mistaking either for a real conflict is the same false-witness failure as citing the working tree for committed state (Git Forensics #44/#54/#55).

**Prevention:**
1. **Expect verify to dirty regenerated artifacts; discard them before rebase/push.** After verify in a landing worktree, `git checkout -- <regenerated *.snap / generated file>` (or `git stash`) so the tree is clean before `git rebase origin/main`. Only your intended changed files should remain.
2. **Treat origin/main as moving: `git fetch origin` + rebase immediately before the push**, every land — a `&&`-chained FF-guard returning non-zero usually means "origin advanced, rebase now," not "abort." Don't let the guard's exit code fail the whole step.
3. **Verify overlap at the object level, not with `git diff HEAD..origin/main`** — that diff shows your own unpushed files as differences. Use `git show --stat <origin-commit>` (or `git log --stat origin/main ^HEAD`) to see what origin's new commit actually touched; only a real shared-file change needs conflict handling.

**Status:** Active — 2 instances, 2 agents (Server Storage, DebateTool), both 2026-07-17 on ADR-007 worktree lands. Reinforces the `/land-from-worktree` procedure with the pre-push cleanup + fetch-rebase step.

**Applies To:** All agents using the worktree landing procedure — the window between verify and push, especially during active fleet push cadence.

## #73 [Build] Windows Git Bash Silently Breaks Command Chains — grep Zero-Match Exit + MSYS Path Conversion

**Pattern:** Two independent Windows/Git-Bash behaviors silently abort a Bash-tool command mid-chain even though nothing is actually wrong: **(A)** `grep -c` (and any grep) **exits 1 on ZERO matches** — standard grep behavior — so an `&&`-chained check breaks at that link *even when the printed `0` was the desired result* (e.g. confirming zero `.ts` entries); **(B)** MSYS **auto path-conversion mangles a `git show <ref>:<slashed-path>` argument** — `git show origin/main:.github/workflows/ci.yml` is rewritten to `origin\main;.github\...` (colon→`;`, `/`→`\`), producing a `fatal: unknown revision` on a perfectly valid ref.

**Instances:**
- 2026-07-17 — DevOps (while landing t/1692, p/26#14): (A) a `grep -c ... && ...` chain broke because `grep -c` returned exit 1 on zero matches — the `0` count was the intended answer, but the non-zero exit killed the `&&` chain. (B) `git show origin/main:.github/workflows/ci.yml` failed "unknown revision" because MSYS converted the `<ref>:<path>` arg into `origin\main;.github\...`. Fixes: keep zero-match/count checks OUT of `&&` links (test the value separately), and prefix `MSYS_NO_PATHCONV=1` for `git show <ref>:<slashed-path>`. Both benign, resolved.
- 2026-07-17 — Technical Lead (p/8#79, refines facet B): facet B **does NOT reproduce** in TL's Bash-tool env — `git show HEAD:.github/workflows/ci.yml` and every `git show <ref>:<path>` returned OK all session. So facet B is **MSYS-config-dependent**, not "always breaks on Windows Git Bash": DevOps's MSYS setup mangles the arg, TL's does not. The durable defense is a failure-**signature**, not a blanket prefix (mandating `MSYS_NO_PATHCONV=1` everywhere is noise where it isn't needed).
- 2026-07-17 — ServerAPI (p/79#8, **2nd facet-A instance**): `git show ... | grep -c "^-" && echo ...` reported tool failure (exit 1) because `grep -c` returned 0 deletions (a purely-additive diff — `0` was the desired answer), aborting the `&&` chain. No real error — read the printed count; fix `|| true` after `grep -c` or keep it out of the `&&` chain. Confirms facet A recurs independently across agents (DevOps + ServerAPI, same day).

**Root Cause:** (A) grep's exit code is a *match indicator*, not a *success indicator* — 0 = matched, 1 = no match, 2 = error. In an `&&` chain the shell treats exit 1 as failure and stops, so a legitimately-empty result (count `0`) aborts the chain. Standard POSIX grep behavior, not Windows-specific, but it bites hardest in Bash-tool one-liners that chain a count check into follow-up steps — and it recurs (2 agents in one day: a zero `.ts`-entry count and a zero-deletion diff count). Same "exit code ≠ what you think" family as the "Bash grep Features Fail Silently on Windows/Git Bash" pattern. (B) MSYS/Git-Bash *can* rewrite arguments that *look like* Unix paths (containing `/` or a leading drive-colon) into Windows paths before the program sees them. `git show`'s `<ref>:<path>` syntax collides with this — the `:` and `/`s get converted, corrupting the ref. **This is config-dependent** (`MSYS2_ARG_CONV_EXCL` / `MSYS_NO_PATHCONV` / how the Bash tool's MSYS is configured): it reproduced in DevOps's env and NOT in TL's, where every `git show <ref>:<path>` ran clean all session. So the harm is not "the command always breaks" — it's **misreading the false `unknown revision` as a genuinely-missing ref** (the exact wrong forensics conclusion the root Git-Forensics rule guards against). `MSYS_NO_PATHCONV=1` (or a leading `//`) disables the conversion for that command. Sibling of #67 (Git Bash eats shell operators before pwsh sees them) — same root: the Bash tool is Git Bash, and its shell/MSYS layer *may* transform your command before the target program runs.

**Prevention:**
1. **Keep zero-match/count checks out of `&&` chains.** Capture the value first (`n=$(grep -c ... || true)`) then test it, or append `|| true` so a legitimate zero-match doesn't abort the chain. Never assume `grep`/`grep -c` exit 0 on a successful-but-empty result.
2. **Facet B is a failure-SIGNATURE, not a blanket mandate** (TL, p/8#79): if `git show <ref>:<slashed-path>` reports `unknown revision` on a ref/path you KNOW exists, that's MSYS path-conversion — retry with `MSYS_NO_PATHCONV=1`. Do NOT prefix it unconditionally; it's config-dependent and unnecessary in envs (like TL's) that don't mangle. The critical error to avoid is concluding the ref is genuinely missing — the exact wrong forensics call the root Git-Forensics rule exists to prevent.
3. **So: a valid ref reporting "unknown revision" in the Bash tool is the tell** — suspect MSYS path-conversion before doubting the ref exists; confirm by re-running the same command with `MSYS_NO_PATHCONV=1`.

**Status:** Active — sibling of #67 (Git-Bash-transforms-your-command family). **Facet A now has 2 instances (DevOps + ServerAPI, both 2026-07-17)** — universal grep behavior, recurring; the `|| true` fix is trivial and now documented, so watch for a 3rd before considering a hook (a `grep -c` mid-`&&`-chain guard would be hard to scope without noise). Facet B is **MSYS-config-dependent** (reproduced for DevOps, NOT for TL — p/8#79). TL will propose a root Git-Forensics Common-Trap line framed as the failure-**signature** ("valid ref → `unknown revision` = MSYS conversion; retry `MSYS_NO_PATHCONV=1`"), batched with the pending worktree-landing-rule proposal to the overlay owner for approval (it's overlay-tracked).

**Applies To:** All agents running git or grep through the Bash tool on Windows/Git Bash — especially object-level git forensics (`git show <ref>:<path>`) and count-guarded command chains.

## #74 [Build] Bare `git restore <file>` During an origin/main Divergence Silently Reverts to Local HEAD

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

## #75 [Build] `git checkout -- .` / `git restore .` Reverts ALL Unstaged Tracked Edits — Untracked Survivors Mask the Loss

**Pattern:** To clean ONE verify-dirtied file, an agent runs the **whole-tree** form `git checkout -- .` (or `git restore .`). It reverts **every** unstaged tracked edit in the tree — not just the stray file — silently wiping other tracked changes the current work depends on. Newly-created files are **untracked**, so they survive the revert, which **masks** the loss: the surviving new files make the change look intact while its tracked-file half is gone. The truncated change then lands.

**Instances:**
- 2026-07-17 — DebateTool (t/1686, ADR-007 worktree land, p/70#9): to drop a verify-dirtied snapshot, ran `git checkout -- .`, which reverted ALL unstaged tracked edits — wiping the **barrel-conversion of the original file** and the **eslint-baseline edit** the split depended on. The new module files were untracked, so they survived and masked the loss; the commit landed with ONLY the new files. Caught via the commit's file-count/stat (expected 8, saw fewer). Resolved: `git reset --soft HEAD~1`, rebuilt the barrel + eslint edit, re-verified, recommitted (8 files).

**Root Cause:** The `.` pathspec on `git checkout --` / `git restore` means "the whole working tree," so the command's blast radius is every unstaged tracked modification, not the one file the agent meant to clean. The tracked/untracked asymmetry is what makes it dangerous *and* invisible: `checkout -- .` only touches **tracked** files, so brand-new (untracked) files are untouched and remain in the tree — a partial change where the visible half (new files) survives and the invisible half (edits to existing tracked files) is gone. Sibling of #74 (bare restore takes the wrong *ref*); here the error is the wrong *scope* (`.` = everything) compounded by untracked survivors hiding the damage. Same worktree-land footgun family as #72.

**Prevention:**
1. **Never `git checkout -- .` / `git restore .` (whole-tree) to clean one stray file** — target it by path: `git restore <path>` / `git checkout -- <path>`. Scope the blast radius to exactly the file you mean.
2. **Sanity-check the commit's file count/stat before pushing** — `git show --stat HEAD` and compare against the expected number of touched files. A split/refactor that touches N files but commits fewer is a lost-half signal (untracked survivors won't show as missing any other way).
3. **When a clean-up reverts more than expected, `git reset --soft HEAD~1` and rebuild** the missing tracked edits before re-verifying — don't push the truncated change.

**Status:** Active — sibling of #74; 4th worktree-land/divergence git footgun in the cluster (#72, #74, this, + the #73 facet-B signature). See the consolidated "Worktree-land / divergence-window git footguns" Quick-Reference entry in the lessons INDEX.

**Applies To:** All agents cleaning a dirtied working tree during a worktree land or any multi-file change — especially splits/refactors that mix edits to tracked files with new untracked files.

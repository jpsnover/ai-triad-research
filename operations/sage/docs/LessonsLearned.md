# Lessons Learned

Institutional memory for failure patterns across the AI Triad Research project.

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

**Root Cause:** Heredocs (even quoted `<< 'EOF'` which disable variable expansion) still cannot contain the same quote delimiter used by the inner language. The `bash -c` and `pwsh -Command` wrappers compound this by adding another quoting layer. Any nested single quotes inside a single-quoted outer wrapper will break the shell parser.

**Prevention:**
1. **First choice:** Use the Write tool to create a temp `.py` script file, then execute it with Bash — avoids all quoting issues.
2. Split complex scripts into smaller pieces that each avoid quote conflicts, passing data via temp files (e.g., JSON to `/tmp/`).
3. In Python, use %-formatting or `.format()` instead of f-strings when the content will pass through Bash.
4. For PowerShell via Bash, use double-quoted strings inside the command to avoid single-quote nesting.
5. Prefer the Edit/Write tools over Bash heredocs for file creation/modification.

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

**Root Cause:** Python's `open()` and `sys.stdout` use `locale.getpreferredencoding()` which is cp1252 on most Windows systems, not UTF-8. Both file I/O and subprocess stdout are affected.

**Prevention:**
1. Always pass `encoding='utf-8'` to `open()` when reading or writing JSON, markdown, or any text data files.
2. For stdout with Unicode content, wrap with `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')`.
3. Use `json.loads(Path(f).read_text(encoding='utf-8'))` as an alternative pattern for file reads.
4. Consider setting `PYTHONUTF8=1` env var to force UTF-8 globally for Python processes.

**Applies To:** All agents writing Python that reads/writes text files or prints Unicode, especially on Windows.

---

## [Data] Assumed JSON Schema Without Inspecting Actual Data

**Pattern:** Code assumes a flat or simple data structure for JSON fields, but the actual schema is nested (arrays of objects, sub-properties under intermediate keys).

**Instances:**
- 2026-05-22 — Computational Linguist: lineage analysis script found 0 names because it looked for a flat `intellectual_lineage` string array at the node root, but the actual data is `graph_attributes.intellectual_lineage[].name` — an array of objects nested under `graph_attributes` (p/7#3).
- 2026-05-22 — Computational Linguist: `embeddings.json` parsing failed with `'str' object has no attribute 'get'` because code iterated top-level keys directly, but node entries are nested under `data['nodes']` — top level has metadata keys (`model`, `dimension`, `field_weights`) (p/7#5).
- 2026-05-25 — Computational Linguist: `'list' object has no attribute 'items'` when accessing `stage_diagnostics` — assumed dict but it's a list. Fixed by checking type first and iterating as list (p/7#11).
- 2026-05-26 — Shared Lib: `embed_taxonomy.py` batch-encode passed bare string array but the function expects `[{id, text}]` objects. Fixed by matching the expected input format. Reference: `relinkVocabulary.ts` (p/5#7).

**Root Cause:** Code written based on assumed schema/interface rather than inspecting the actual structure or function signature. Project data files commonly wrap payloads under a key (`nodes`, `graph_attributes`) with metadata at the top level, field types vary (list vs dict, nested objects vs flat strings), and function APIs expect structured objects not bare primitives.

**Prevention:**
1. Always inspect a sample of the actual data before writing code that reads it — `head` a JSON file or `jq` a few records.
2. For taxonomy data specifically: many enriched fields live under `graph_attributes`, not at the node root.
3. Check `type()` / `isinstance()` before calling type-specific methods (`.items()` for dict, iteration for list).
4. When a script returns 0 results, empty data, or an AttributeError, suspect a schema mismatch before debugging logic.

**Status:** Resolved — "Data File Convention" added to root AGENTS.md under Taxonomy Model (p/8#22).

**Applies To:** All agents working with taxonomy JSON data or writing data processing scripts.

---

## [Build] Missing CLI Tools in Dev Environment

**Pattern:** Commands fail because expected CLI tools are not installed in the development environment.

**Instances:**
- 2026-05-23 — DevOps: `az` CLI not found in bash or PowerShell. Used `gh` CLI as fallback for workflow checks (p/26#1).

**Root Cause:** Dev environment setup doesn't include all CLI tools that agents may need. Azure CLI is not installed, though `gh` (GitHub CLI) is available.

**Prevention:**
1. Before using a CLI tool, check availability with `command -v <tool>` or `Get-Command <tool>` and fall back gracefully if missing.
2. Document required vs. available CLI tools for the dev environment.
3. When a tool is unavailable, prefer alternative tools already installed (`gh` instead of `az` for GitHub-hosted workflow checks) over blocking.

**Applies To:** All agents running CLI commands, especially DevOps and CI-related work.

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

**Root Cause:** Multiple agents work in parallel on the same branches. The window between local commits and push allows remote to advance, causing non-fast-forward rejections. More agents = more contention.

**Prevention:**
1. Pull immediately before committing: `git pull --rebase` then commit and push without delay.
2. For generated data files (`embeddings.json`, `policy_actions.json`), prefer "take theirs" conflict resolution unless your changes are the authoritative regeneration.
3. For code conflicts, understand the intent of both changes before resolving — don't blindly take either side.
4. Minimize the commit-to-push window — do both in quick succession.
5. Standard resolution flow: `git stash && git pull --rebase origin main` → resolve conflicts → `git rebase --continue && git stash pop && git push`.

**Applies To:** All agents pushing to shared branches in either repo.

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

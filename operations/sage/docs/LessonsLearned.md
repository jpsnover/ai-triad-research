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

**Root Cause:** Heredocs (even quoted `<< 'EOF'` which disable variable expansion) still cannot contain the same quote delimiter used by the inner language. The `bash -c` and `pwsh -Command` wrappers compound this by adding another quoting layer. Any nested single quotes inside a single-quoted outer wrapper will break the shell parser.

**Prevention:**
1. Split complex multi-step scripts into sequential small `python3 -c` commands, isolating steps that do not have quote conflicts.
2. For steps that require embedded single quotes, use an alternate heredoc delimiter (e.g., `<< 'XEOF'`) combined with Python raw strings to minimize escaping.
3. Prefer the Edit/Write tools over Bash heredocs when writing or modifying files that contain mixed-language quoting (Python + TSX, shell + JS, etc.).
4. When Bash quoting gets complex, consider writing a temp script file with the Write tool and then executing it, rather than inlining code in a heredoc.

**Status:** Resolved — systemic prevention via AGENTS.md File Editing Rule (q/4 approved, p/8#7).

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

## [PowerShell] Strict Mode Crashes on Missing Properties

**Pattern:** Accessing a property that doesn't exist on a PSObject throws a terminating error under `Set-StrictMode -Version Latest`, instead of returning `$null`.

**Instances:**
- 2026-05-22 — `Get-PovLineage` crashed with "The property 'parent_id' cannot be found on this object" when traversing nodes (e.g., situations nodes) that lack a `parent_id` property (p/20#1).

**Root Cause:** PowerShell strict mode disallows accessing non-existent properties. JSON-sourced objects have inconsistent schemas — not every node has every property. Code assumed `parent_id` would always exist, but some node types omit it entirely.

**Prevention:**
1. Guard property access with `$obj.PSObject.Properties['property_name']` before reading the value.
2. When working with JSON-sourced data that has variable schemas, assume any property may be absent and check before accessing.
3. Consider wrapping frequently accessed optional properties in a helper function to reduce boilerplate.

**Applies To:** All agents writing PowerShell that reads JSON data or works with heterogeneous PSObjects under strict mode.

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

**Pattern:** Python `open()` on Windows defaults to cp1252 encoding, not UTF-8. Any `json.load()` or file read on data files containing non-ASCII characters (em dashes, accented names, Unicode quotes) silently corrupts or throws decode errors.

**Instances:**
- 2026-05-22 — Technical Lead: `json.load()` failed on debate JSON files with UTF-8 characters because `open()` defaulted to cp1252 on Windows (p/8#9).

**Root Cause:** Python's `open()` uses `locale.getpreferredencoding()` which is cp1252 on most Windows systems, not UTF-8. JSON files in this project are UTF-8 encoded.

**Prevention:**
1. Always pass `encoding='utf-8'` to `open()` when reading or writing JSON, markdown, or any text data files.
2. Use `json.loads(Path(f).read_text(encoding='utf-8'))` as an alternative pattern.
3. This applies to all Python scripts in the project — generator scripts, data processing, test fixtures.

**Applies To:** All agents writing Python that reads/writes text files, especially on Windows.

---

## [Data] Assumed JSON Schema Without Inspecting Actual Data

**Pattern:** Code assumes a flat or simple data structure for JSON fields, but the actual schema is nested (arrays of objects, sub-properties under intermediate keys).

**Instances:**
- 2026-05-22 — Computational Linguist: lineage analysis script found 0 names because it looked for a flat `intellectual_lineage` string array at the node root, but the actual data is `graph_attributes.intellectual_lineage[].name` — an array of objects nested under `graph_attributes` (p/7#3).
- 2026-05-22 — Computational Linguist: `embeddings.json` parsing failed with `'str' object has no attribute 'get'` because code iterated top-level keys directly, but node entries are nested under `data['nodes']` — top level has metadata keys (`model`, `dimension`, `field_weights`) (p/7#5).

**Root Cause:** Code written based on assumed schema rather than inspecting the actual JSON structure. Project data files commonly wrap payloads under a key (`nodes`, `graph_attributes`) with metadata at the top level — not flat arrays/dicts at root.

**Prevention:**
1. Always inspect a sample of the actual data before writing code that reads it — `head` a JSON file or `jq` a few records.
2. For taxonomy data specifically: many enriched fields live under `graph_attributes`, not at the node root.
3. When a script returns 0 results or empty data, suspect a schema mismatch before debugging logic.

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

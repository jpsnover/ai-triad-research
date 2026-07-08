# PowerShell Patterns

Failure patterns related to PowerShell strict mode, module system, and language quirks.

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

**Status:** Active

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

**Status:** Active

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

**Status:** Active

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

**Status:** Active

**Applies To:** All agents writing PowerShell scripts.

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

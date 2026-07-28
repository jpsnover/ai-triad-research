# Data Patterns

Failure patterns related to JSON schemas, data files, and data repo operations.

---

## [Data] Assumed JSON Schema Without Inspecting Actual Data

**Pattern:** Code assumes a flat or simple data structure for JSON fields, but the actual schema is nested (arrays of objects, sub-properties under intermediate keys).

**Instances:**
- 2026-05-22 — Computational Linguist: lineage analysis script found 0 names because it looked for a flat `intellectual_lineage` string array at the node root, but the actual data is `graph_attributes.intellectual_lineage[].name` — an array of objects nested under `graph_attributes` (p/7#3).
- 2026-05-22 — Computational Linguist: `embeddings.json` parsing failed with `'str' object has no attribute 'get'` because code iterated top-level keys directly, but node entries are nested under `data['nodes']` — top level has metadata keys (`model`, `dimension`, `field_weights`) (p/7#5).
- 2026-05-25 — Computational Linguist: `'list' object has no attribute 'items'` when accessing `stage_diagnostics` — assumed dict but it's a list. Fixed by checking type first and iterating as list (p/7#11).
- 2026-05-26 — Shared Lib: `embed_taxonomy.py` batch-encode passed bare string array but the function expects `[{id, text}]` objects. Fixed by matching the expected input format. Reference: `relinkVocabulary.ts` (p/5#7).
- 2026-07-06 — Computational Linguist: inline Python formatting of `list_tickets` output threw TypeError joining `blocker_summaries` — assumed elements were strings but they're objects. Fixed by coercing each element (`str()`/field access) before join (p/7#16).
- 2026-07-06 — Computational Linguist: inline Python concatenated debate session `origin` field assuming string — it's a dict in some sessions (TypeError). Fixed with `str(d.get(k,''))` coercion at read site (p/7#18).
- 2026-07-26 — Computational Linguist (p/7#36): inline Python inspector crashed calling `len()` on `policy_count` (an int) while probing `policy_actions.json` shape — **printed values before type-checking them**. Trivial + self-correcting: read the shape from the partial output and moved on. Shape learned: `policy_actions.json` keys the list under `policies`, and the name field is `action`. Same inspect-before-coding failure as the others (operate-before-type-check); loud crash, no downstream cost.
- 2026-07-26 — Computational Linguist (**8th instance, same-session recurrence**, p/7#38): scratch script threw `AttributeError: 'str' has no .get` walking `situations.json` interpretations — **1,236 nodes have `interpretations.{pov}` as a dict, 23 have it as a plain string**. Cause: assumed uniform shape instead of type-checking at the read site. `isinstance`-guarding fixed it AND *was* the diagnosis — the string form is the pre-BDI-decomposition format (t/1805). Notable: **recurred within hours of #7 being recorded** — CL flags that recording isn't preventing recurrence, arguing for a hookable check over another doc entry (see #82 tracker — this reversed Sage's earlier not-in-#82 call).
- 2026-07-28 — Computational Linguist (**+4, p/7#47**): **3 probe errors** (t/1826 scoring probes) coded against guessed schemas before sampling — extraction-log `nodes` is a **list not dict**; `aliases` can be **null**; `policy_actions` keys under `policies` with name field `action` not `title`. Sampled + coerced-at-read; benign. **+ 1 PRODUCTION instance (t/1830) — the class in shipped code, not a probe:** the extraction cmdlet **char-explodes bare-string `aliases`** (13/37 records) because the model emits a **string where the schema says array** and the code iterates it unguarded. This is the concrete production data-corruption the pattern warns about. **Correction (CL p/7#49): the t/1830 bug shipped in POWERSHELL (`Invoke-EntityExtraction`), NOT TypeScript** — so `tsc` / a TS `string | string[]` union **cannot** catch it (no type checker runs on that surface). The prevention that would actually have caught it is **PS-side coerce-at-read** — `if ($x -is [string]) { @($x) }` at every AI-JSON boundary, ideally ONE shared helper (Shared Utility Rule) — plus a **bare-string fixture in the Pester tests**. (The TS-union-types strengthening from t/1810 stays right for *TS* surfaces; it just doesn't cover this PS bug — don't record it as a guard that was never in reach here.) The 3 probe errors are #82 offender #5 instances (inspect-before-coding not applied); the production bug is a PS code defect (t/1830).

**Root Cause:** Code written based on assumed schema/interface rather than inspecting the actual structure or function signature. Applies across all project data: taxonomy JSON files wrap payloads under keys with metadata at top level, debate session fields vary in type across sessions (string vs dict), and tool/API return values are structured objects not bare primitives. Field types vary — never assume string without checking.

**Prevention:**
1. Always inspect a sample of the actual data before writing code that reads it — `head` a JSON file or `jq` a few records.
2. For taxonomy data specifically: many enriched fields live under `graph_attributes`, not at the node root.
3. Check `type()` / `isinstance()` before calling type-specific methods (`.items()` for dict, iteration for list).
4. When a script returns 0 results, empty data, or an AttributeError, suspect a schema mismatch before debugging logic.

**Status:** Resolved — "Data File Convention" added to root AGENTS.md under Taxonomy Model (p/8#22).

**Applies To:** All agents working with any JSON field from project data, debate sessions, or tool/API returns — not just taxonomy files.

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

**Status:** Active

**Applies To:** All agents committing to `ai-triad-data`, especially during active debate or enrichment sessions.

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

**Status:** Active

**Applies To:** All agents writing scripts that reference debate files, summaries, or other actively-written data.

---

## [Data] File-Type Discrimination by Presence-of-a-Key Admits Look-Alikes — Gate on the CONTRACT, Not the Key

**Pattern:** A loader/registrar decides "what kind of file is this?" by testing only for **presence of a key** (e.g. "has a `nodes` property → it's a POV"). A **differently-shaped file that happens to share that key** silently passes the check, gets registered as a fake instance of the type, and crashes **downstream** when the real contract (the element shape the consumer needs) is accessed — often as a strict-mode unguarded-property error far from the load site.

**Instances:**
- 2026-07-28 — PowerShell 2 (t/1834, landed 37598a6f, p/228#3): the POV loader's shape check tested only "has a `nodes` property," so the sidecar `entity_extraction_log.json` — which has `nodes[]` but keyed by `node_id`, **not** `id` — registered as a fake POV. `Get-Tax` then crashed on a bare `$Node.id` under strict mode (property absent). Fix: discriminate on the contract (`nodes[].id`), not mere key presence. **Note: `entity_extraction_log.json` is a repeat shape-surprise source** (also t/1830 char-explode + p/7#47 probe errors) — a known sidecar that superficially resembles taxonomy data.

**Root Cause:** Presence-of-a-key is a **weak type discriminator** — common key names (`nodes`, `data`, `id`) are shared across many unrelated files, so duck-typing on one key admits look-alikes. The loader validated the **container** key but not the **element** contract, so a container with the right key but wrong-shaped elements passed. It then compounds with strict-mode unguarded property access (see the Strict Mode Eval Failures pattern): the mismatch surfaces as a crash *downstream* on `$Node.id`, not as a clear rejection at load. Same data-shape-variance / normalize-at-fetch family — here at the **file-classification** layer rather than the field-read layer.

**Prevention:**
1. **Discriminate file types by the CONTRACT the consumer needs, not just key presence** — validate a representative element, not merely the container. "Has `nodes` AND `nodes[0].id` exists" beats "has `nodes`."
2. **Fail fast at LOAD with a clear error** ("file X has `nodes` but no `nodes[].id` — not a POV") rather than admitting the file and crashing downstream on a strict-mode property access.
3. **Exclude known sidecars explicitly** — `entity_extraction_log.json` (and other non-POV files that share `nodes`) should be denylisted/allowlisted where auto-discovery is ambiguous; it's a recurring shape-surprise source, so treat it as a known exception.
4. **Pairs with strict-mode guarding** — even with contract discrimination, guard `$Node.PSObject.Properties['id']` before a bare `$Node.id` so a misclassification degrades to a clear error, not a strict-mode crash.

**Status:** Active — file-classification variant of the data-shape-variance family; compounds with strict-mode unguarded property access. `entity_extraction_log.json` flagged as a repeat offender.

**Applies To:** All loaders/registrars that auto-discover and classify data files by shape — especially the taxonomy/POV loaders in the AITriad PS module.

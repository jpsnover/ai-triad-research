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

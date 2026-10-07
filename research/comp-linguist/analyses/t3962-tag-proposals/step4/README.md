# t/3962 step 4 — the `pov_tags` write

Writes the PI-reviewed Skeptic POV tags (`taxonomy/Origin/pov-tag-proposals.json`, all 377 judged) into
`taxonomy/Origin/skeptic.json` through `Set-PovNodeTags` (t/3969), under `/data-mutation`.
Authorization: PI p/314#192, recorded t/3962#18.

| File | Role |
|---|---|
| `freeze_assignments.py <data_root> [ref]` | The ONLY place the target set is derived. Writes `frozen_assignments.json` (base data commit + side-file and skeptic.json sha256 + 377 `{node_id, tags}` in node order). Refuses on any unjudged proposal, a proposal/node mismatch, or a node that already has `pov_tags`. |
| `frozen_assignments.json` | Frozen at data `b70afaee`: 371 tagged, 6 untagged (written as `[]` = checked, explicitly untagged; t/3969#2 B.6). |
| `apply_pov_tags.ps1 -DataRoot <worktree> [-Apply]` | Refuses unless skeptic.json matches the frozen base sha256. Dry run (`-WhatIf`; validation still runs) by default. Write into a data **worktree**, never the shared checkout. |
| `verify_pov_tags.py <data_root> [ref]` | 0-collateral + end-state check against the base blob: same file keys, node count and order; each node deep-equal to base apart from an added `pov_tags` equal to the frozen tags; textually, the only changed lines are each node's `{` → `{"pov_tags":[...],` (the writer's surgical splice). Run on the committed tree with `ref` = `HEAD` / `origin/main`. |

Failing arms proven: a changed tag (`skp-desires-003`) and a changed unrelated field each FAIL.

**Formatting note.** `Update-JsonNodePath -Upsert` inserts the new key compactly as the first key on the
opening-brace line, not in canonical indented form. Readers parse JSON, so this is semantically inert, but
any later tool that re-serializes the whole file would reflow those 377 lines (unverified for the editor)
— that would be a one-time format-only diff, not a data change.

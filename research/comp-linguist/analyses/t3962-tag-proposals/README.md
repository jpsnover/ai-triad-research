# Skeptic POV-tag proposals: tooling (t/3962, t/4036, t/4066, t/4056)

Everything here reads the data repo and writes **local** files under `out/`, except the writers named in
**Writers of the side file**, which change `taxonomy/Origin/pov-tag-proposals.json` in ai-triad-data. Every
data write runs under `/data-mutation` with PI authorization recorded **before** the write.

| File | What it does | Writes data? |
|---|---|---|
| `propose_tags.py` + `propose.prompt` | LLM proposes `pov_tags` per Skeptic node (step 1). | No (local `out/`) |
| `draw_validation_sample.py`, `score_validation.py`, `validation/` | Blind validation sample and scoring (step 2). | No |
| `justify_tags.py` + `justify.prompt` | Grounds each **fixed** proposed tag in its soul doc's Value Hierarchy (t/4066). | No |
| `combine_runs.py` | Combines two justify runs into firm / uncertain / unsupported. | No |
| `soul_provenance.mts` | Canonical `buildSoulProvenance` for the three souls; `verify` mode checks a written file. | No |
| `append_value_basis.py` | Adds `value_basis*` to the side file, additive only (t/4066). | **Yes** |
| `../t4036-append/append_proposals.py` | Appends proposals for nodes added after the run (t/4036). | **Yes** |
| `check_review_session.py` | Field-only check before committing a review session (t/4056). | No (read-only) |

## Writers of the side file: the hard rule (t/4056, SO e/270#2)

Reviews made in the editor's queue live as an **uncommitted** edit to `pov-tag-proposals.json` in the data
checkout until CL commits them. A script that rewrites the file can silently discard them. So:

**Any script that writes `pov-tag-proposals.json` MUST pin the base sha256 of the file it expects, and refuse
on any mismatch** (or, at minimum, refuse when any item is not `pending`). Both current writers do:
`append_proposals.py` pins `06adb25e…`; `append_value_basis.py` pins the run's `base_side_file_sha256` and
refuses a file that already carries `value_basis`. A new writer without a pin must not be merged.

Related guards outside this folder: the DevOps data-checkout drift check treats a dirty
`pov-tag-proposals.json` as **protected WIP** (never synced, restored or reset; routed to CL) (#3038,
`docs/shared-tree-divergence.md`).

## Committing a review session (t/4056, standing PI authorization t/4056#2)

At the end of each editor review session:

0. **Before the session starts:** the side file in the shared data checkout must be the current one, i.e. the
   same blob as on `origin/main`. If it's stale, the queue reads and saves an old file, for example one without
   `value_basis`. Syncing is DevOps-only.
1. `python check_review_session.py <data_root>` (after `git fetch`) must print **PASS**:
   - the side file at the checkout's HEAD equals `origin/main`'s;
   - only `status`, `final`, `reviewed_by` and `reviewed_at` changed, only on non-pending items;
   - nothing else changed, and the serialization is canonical.

   The checkout being behind on **other** files is fine and expected: the protected-WIP guard blocks syncs
   while reviews are uncommitted.
2. **Commit from a clean worktree at `origin/main`, not the shared checkout.** Copy the reviewed file into the
   worktree and confirm the copy is byte-identical. Commit **that one path only**, with an explicit pathspec
   (`git commit -- taxonomy/Origin/pov-tag-proposals.json`); never `-a` or `add -A`. Committing on a shared
   checkout that's behind would need a rebase, which is forbidden there.
3. Push, verify on `origin/main`, and record the session (count, ids, commit) on t/4056. The shared checkout's
   now-identical edit clears at the next DevOps sync.

A FAIL stops the commit and goes back to the PI. The `pov_tags` write (step 4) is **not** covered by this
authorization.

## Adding nodes later

An append (t/4036 pattern) must also run `justify_tags.py --ids <new>` twice, then `combine_runs.py`, for
the new items in the **same** `/data-mutation` step. Otherwise they land without `value_basis` and show as
"No justification yet" in the queue (t/4066#11). `append_value_basis.py` currently refuses a file that already
carries `value_basis`, so an incremental mode is needed (and must be verified) before the first such append.

# Computational Linguist — Last Session

**Closed:** 2026-07-28 ~02:15 local. Long session spanning a context compaction and one full session restart (API-error recovery).

## Completed this session

- **t/1670 criterion-disclosure A/B — Done.** Verdict: **evaluator relabeling** (preregistered Amendment 2 matrix, row 2). Labeling channel moved `addressed` 73.3% → 100% (+26.7pp) while the unpatched convergence layer stayed flat; transcript hand-checks found both arms near-ceiling and no debater gaming. The disclosure sentence is NOT adopted; the arm-B patch died with its worktree. Bronder F-3 unsupported for our harness. Key commits: scorer `24b18ee3` (blind, pre-data), Amendment 2 `8cb3d03d`, incident log `2248c818`, results `c1529174`. The production `crux_addressed_ratio` would have reported a +0.267 false positive (t/1796 demonstrated).
- **t/1803 entity Phase-1 — Done** (SHA list in t/1803#2). **t/1819 landing — Done:** `enrichment.entity-extraction` + register union + owned-files are on origin/main as `907b214f`, object-verified. t/1806 live runs unblocked (PowerShell pinged, p/23#85).
- **t/1818 (undecided-crux engagement gate):** design reviewed (approve-with-notes, t/1818#2), register row text supplied (t/1818#3), post-land code review of `c070c980` clean (t/1818#6). **My calibration against the frozen 30 is the open follow-up** — precision ≥0.90 AND recall ≥4/6, then fresh holdout N≥10 before the stipulated→derived flip.
- **Register:** affect cutover note (`5692e283`, t/1785 fix landed `b1d39780`, pre/post non-comparable), t/1670 wording-sensitivity row + t/1818 gate row merged (`2b152147`). Register stomp hazard structurally closed by the `907b214f` landing.
- **t/1824 filed** (CLI never exits post-finalization; fixed same night by Debate Tool 2, `b9c56b22`). Sage logged patterns #86 (win32 task-stop kills wrapper, not child trees) and the barrel-path citation lesson.

## Queue (data-repo batches stay serialized, e/43#4)

1. **t/1811** — enrich sit-448..470 (expand-existing, not regenerate); coordinate with PowerShell. Then **t/1805 step 3** (baseline 412→435).
2. **t/1669 AC#2** — absorption batch, N≥30 archived sessions vs recorded terminal `crux.state` (not re-runs); PREREG doc first. Ticket state note at t/1669#8.
3. **t/1818 calibration** — LLM-free, can interleave (no data-repo writes); harness needs a coerce-at-read shim for `taxonomy_refs` on archived sessions.
4. **t/1770 backfill** — eyeball the 18 rounds==3 real rows before 14k rows move.

## Traps hit this session (verify before repeating)

- Batch runners: judge success by **harvest-artifact presence**, never returncode alone (three failure modes misreported by exit codes in one night). After any interruption, process-level check (`Get-CimInstance` command-line grep) for surviving writers before relaunching — "task stopped" is bookkeeping.
- The `q/30` blocking question (WELL_TESTED_MIN_CHALLENGES 2→4/5) is still pending with the human since 07-15.
- Local main remains diverged from origin (owner-gated gemini WIP); land via worktrees only, build worktree files from `git show HEAD:<path>` blobs, never the shared working tree.

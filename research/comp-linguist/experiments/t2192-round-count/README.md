# t/2192 — Per-Phase Round-Count Experiment (reproducibility archive)

Analysis + recommendation: [`../../docs/per-phase-round-count-analysis.md`](../../docs/per-phase-round-count-analysis.md)
Design of record: [`../../docs/per-phase-round-count-experiment-design.md`](../../docs/per-phase-round-count-experiment-design.md)

**Result: NULL** — round budget does not detectably affect convergence in any phase (all
fenceposts tie; IQRs overlap, |Δmedian convergence| < 0.05 MDE). Current bounds defensible;
cost-optimal is the floor.

## Files
- `t2192_phaseA_run.py` — batch runner. 30 new debates across the 6 Phase-A fenceposts (n=6
  each; argumentation cells reuse the 6 banked §5-pilot runs). Idempotent (skips existing
  harvests). Isolation gate keys off **debate_id membership** in the main cal logs, not a raw
  line-count delta (line count is confounded by other agents' concurrent debates on the
  shared machine).
- `t2192_smoke.py` — 3-debate validation smoke used to confirm the t/2228 engine fix + #531
  isolation before the batch.
- `t2192_phaseA_analysis.py` — reads the isolated cal-logs + debate JSON, computes per-
  fencepost convergence/cost distributions and the pre-registered sensitivity verdicts.
- `phaseA-results.txt` — captured analysis output (the numbers cited in the write-up).
- `phaseA-progress.log` — the run log (START/OK/FAIL/SKIP per cell across all relaunches).

## Reproducing
Machine-specific absolute paths are hardcoded (`C:\tmp\wt-t2192-phaseA` worktree at
origin/main with node_modules junctions; `C:\tmp\t2192-phaseA-out` isolated output;
`AI_TRIAD_DATA_ROOT` = the data repo). Per the run recipe
(`reference_situation_injection_debate_run_recipe`). Raw session + calibration output are
large and live only at those scratch paths — not committed. Engine prerequisites: origin/main
at/after `7b35c96c` (t/2208 + t/2228 + #531).

**Ops note:** run the batch in the background and monitor via file reads only — a foreground
Bash call reaps the running background batch in this harness; the runner is idempotent so
relaunch-on-kill loses nothing.

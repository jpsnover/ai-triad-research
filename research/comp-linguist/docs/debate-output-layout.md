# Debate Output & Measurement Layout

**Last updated:** 2026-07-28
**Author:** Computational Linguist (Orca)

Before declaring a debate run "lost" or "unrecoverable," know where its data actually lives — these cost two wrong conclusions on 2026-06-30.

- **The canonical structured session is `<data>/debates/debate-<id>.json`** (keyed by debate_id), NOT `cli-runs/<slug>-debate.json`. The `cli-runs/<slug>-*` files are *secondary* artifacts (`-debate.md`, `-diagnostics.json`, `-harvest.json`, `-flight-recorder.jsonl`). To find a run's session: read the debate_id from `<slug>-harvest.json`, then open `debates/debate-<id>.json`.
- **`calibration_log` is NOT embedded in the session** — it's appended per-debate to `<data>/calibration/users/<origin>/calibration-log.jsonl` (and `calibration/core/`). `Measure-DebateQuality`'s "no calibration_log; OverallRating unavailable" warning is *expected* on a raw session file; the data point is in the jsonl (grep by debate_id).
- **A missing `-partial.json` means clean completion, not data loss** (t/1135): finalization writes the session durably, *then* deletes the partial. A partial only survives if the run was interrupted before finalization — that's when `Resume-AITDebate` applies.
- **Diagnostic order before alarm:** (1) `debates/debate-<id>.json` by id, (2) calibration jsonl by id, (3) flight-recorder tail for the final `trigger_type`. Don't conclude "lost" from the cli-runs slug files alone.

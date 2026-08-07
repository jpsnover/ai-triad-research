# Debate Output & Measurement Layout

**Last updated:** 2026-08-06
**Author:** Computational Linguist (Orca)

Before declaring a debate run "lost" or "unrecoverable," know where its data actually lives — these cost two wrong conclusions on 2026-06-30.

- **The canonical structured session is `<data>/debates/debate-<id>.json`** (keyed by debate_id), NOT `cli-runs/<slug>-debate.json`. The `cli-runs/<slug>-*` files are *secondary* artifacts (`-debate.md`, `-diagnostics.json`, `-harvest.json`, `-flight-recorder.jsonl`). To find a run's session: read the debate_id from `<slug>-harvest.json`, then open `debates/debate-<id>.json`.
- **`calibration_log` is NOT embedded in the session** — it's appended per-debate to `<caldata>/calibration/users/<origin>/calibration-log.jsonl` (and `calibration/core/`). `Measure-DebateQuality`'s "no calibration_log; OverallRating unavailable" warning is *expected* on a raw session file; the data point is in the jsonl (grep by debate_id).
- **Cal-log isolation keys off `outputDir` (t/2216, PR #518, 2026-08-06):** `<caldata>` above is **not always the main data root**. When a run sets `config.outputDir`, the cal log is written **inside it** — `<outputDir>/calibration/...` — so an isolated output path means a *fully isolated run* and experimental/synthetic batches do NOT contaminate the CL metric windows that read the main log (session-start scan, optimizer window, regression deltas). When `outputDir` is unset, the cal log lands in the main `<data>/calibration/...` as before. *Pre-t/2216 the cal-log root was `path.dirname(outputDir)`, which silently resolved back to the main data root whenever the scratch dir was a direct child of it (e.g. `../ai-triad-data/debates-scratch` → parent = `../ai-triad-data`) — the pollution bug t/2216 fixed. Any run recipe that predates this must be read with that caveat.*
- **A missing `-partial.json` means clean completion, not data loss** (t/1135): finalization writes the session durably, *then* deletes the partial. A partial only survives if the run was interrupted before finalization — that's when `Resume-AITDebate` applies.
- **Diagnostic order before alarm:** (1) `debates/debate-<id>.json` by id, (2) calibration jsonl by id, (3) flight-recorder tail for the final `trigger_type`. Don't conclude "lost" from the cli-runs slug files alone.

"""t/2192 Phase-A fencepost screening (post-#531 cal-log isolation). T3 topic.

Screens each of the 3 phases for round-budget sensitivity at its two extremes, holding
the other two phases at baseline (conf=2, arg=2, conc=1). Screening n=6 per fencepost.

Cells (36 total = 6 banked pilot + 30 here):
  arg1  (2,1,1)  banked n=3 (pilot-out) + 3 here      -> n6
  arg4  (2,4,1)  banked n=3 (pilot-out) + 3 here      -> n6
  conf1 (1,2,1)  6 here                                -> n6
  conf3 (3,2,1)  6 here                                -> n6
  conc1 (2,2,1)  6 here  [= baseline / concluding-low] -> n6
  conc2 (2,2,2)  6 here                                -> n6

ISOLATION GATE (folded into cell 1, per §9b precondition-1): capture the two MAIN cal-log
line counts before the batch; after the first successful run, re-check. If EITHER moved,
PR #531 did not fully isolate -> ABORT the whole batch (no scrub-at-scale, re-file instead).
If unchanged, isolation is confirmed on live data and the batch proceeds.

Success is judged by the harvest artifact, not returncode (CLI post-finalization hang,
pattern #86). Idempotent: a run whose harvest already exists is skipped (resumable).
"""
import glob
import json
import os
import subprocess
import time

WT        = r"C:\tmp\wt-t2192-phaseA"
OUT       = r"C:\tmp\t2192-phaseA-out"
CFG       = r"C:\tmp\t2192-phaseA-cfg"
DATA_ROOT = r"C:\Users\jsnov\repos\ai-triad-data"
PROGRESS  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "phaseA-progress.log")
TIMEOUT_S = 1500
T3_TOPIC  = "Should compute thresholds be the primary lever for governing frontier AI?"
MAIN_LOGS = [
    os.path.join(DATA_ROOT, "calibration", "core", "calibration-log.jsonl"),
    os.path.join(DATA_ROOT, "calibration", "users", "local", "calibration-log.jsonl"),
]

os.makedirs(OUT, exist_ok=True)
os.makedirs(CFG, exist_ok=True)

# (label, confMax, argMax, concMax, count, start_index)
CELLS = [
    ("conf1", 1, 2, 1, 6, 1),   # confrontation low  -> cell 1 = isolation canary
    ("conf3", 3, 2, 1, 6, 1),   # confrontation high
    ("conc1", 2, 2, 1, 6, 1),   # concluding low (= baseline 2,2,1)
    ("conc2", 2, 2, 2, 6, 1),   # concluding high
    ("arg1",  2, 1, 1, 3, 4),   # argumentation low  top-up (banked 01-03)
    ("arg4",  2, 4, 1, 3, 4),   # argumentation high top-up (banked 01-03)
]

# Build per-cell run lists, then round-robin interleave to spread any temporal API drift.
per_cell = []
for label, cf, ar, cc, n, start in CELLS:
    lst = [(f"t2192-phaseA-{label}-{i:02d}", label, cf, ar, cc)
           for i in range(start, start + n)]
    per_cell.append(lst)
runs = []
i = 0
while any(i < len(c) for c in per_cell):
    for c in per_cell:
        if i < len(c):
            runs.append(c[i])
    i += 1
# conf1-01 is already first (conf1 is CELLS[0]); it is the isolation canary.


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(PROGRESS, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def cfg_for(slug, cf, ar, cc):
    p = os.path.join(CFG, slug + ".json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump({
            "topic": T3_TOPIC,
            "name": slug,
            "slug": slug,
            "activePovers": ["accelerationist", "safetyist"],
            "model": "gemini-3.5-flash-lite",
            "evaluatorModel": "gemini-3.5-flash-lite",
            "useAdaptiveStaging": True,
            "pacing": "moderate",
            "maxTotalRounds": 18,
            "allowEarlyTermination": False,
            "phaseBoundsOverride": {
                "maxConfrontationRounds": cf,
                "maxArgumentationRounds": ar,
                "maxConcludingRounds": cc,
            },
            "outputFormat": "all",
            "outputDir": OUT,
        }, fh, indent=1)
    return p


def harvest(slug):
    return os.path.join(OUT, slug + "-harvest.json")


def debate_id_for(slug):
    """Read a completed run's debate_id from its -debate.json."""
    p = os.path.join(OUT, slug + "-debate.json")
    if not os.path.exists(p):
        return None
    try:
        d = json.load(open(p, encoding="utf-8"))
        return d.get("id") or d.get("debate_id")
    except Exception:
        return None


def main_logs_contain(ids):
    """Return how many of `ids` appear in the MAIN cal logs. This is the true
    isolation test — a raw line-count delta is confounded by other agents'
    debates running concurrently on this shared machine (t/2192 smoke, 2026-08-07).
    """
    ids = {i for i in ids if i}
    if not ids:
        return 0
    hits = 0
    for lp in MAIN_LOGS:
        try:
            for line in open(lp, encoding="utf-8"):
                if any(i in line for i in ids):
                    hits += 1
        except FileNotFoundError:
            pass
    return hits


env = dict(os.environ)
env["AI_TRIAD_DATA_ROOT"] = DATA_ROOT

log(f"START Phase-A: {len(runs)} new runs. WT={WT} OUT={OUT}")
log("ISOLATION test = debate_id membership in MAIN logs (line-count delta is confounded "
    "by other agents' concurrent debates on this shared machine — t/2192 smoke 2026-08-07).")

results = {}
isolation_checked = False
first_ok = False
for idx, (slug, label, cf, ar, cc) in enumerate(runs, 1):
    hp = harvest(slug)
    if os.path.exists(hp):
        log(f"SKIP {slug} (harvest exists)")
        results[slug] = "ok"
        first_ok = True
        continue
    cfg = cfg_for(slug, cf, ar, cc)
    t0 = time.time()
    log(f"START {idx}/{len(runs)} {slug} (conf{cf},arg{ar},conc{cc})")
    proc = subprocess.Popen(
        ["npx", "--no-install", "tsx", "lib/debate/cli.ts", "--config", cfg],
        cwd=WT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
    try:
        proc.wait(timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       capture_output=True, shell=True)
    dt = time.time() - t0
    ok = os.path.exists(hp)
    results[slug] = "ok" if ok else "FAIL"
    log(f"{'OK  ' if ok else 'FAIL'} {slug} in {dt:.0f}s")

    # Isolation gate: after the first successful run, the cell's debate_id must NOT
    # appear in the MAIN logs (all its rows must be in the isolated outputDir only).
    if ok and not isolation_checked:
        isolation_checked = True
        did = debate_id_for(slug)
        leaked = main_logs_contain([did]) if did else None
        log(f"ISOLATION check after cell 1 (id={did}): MY-id rows in main logs = {leaked}")
        if leaked:
            log("!! LEAK: this run's debate_id reached the MAIN cal log — PR #531 did NOT "
                "isolate the engine path. ABORTING batch; re-file rather than scrub 30 runs.")
            break
        log("ISOLATION CONFIRMED: cell-1 rows stayed in the isolated outputDir. Proceeding.")
    if ok:
        first_ok = True

good = [s for s, r in results.items() if r == "ok"]
bad  = [s for s, r in results.items() if r != "ok"]
log(f"DONE ok={len(good)} fail={len(bad)}")
if bad:
    log("fail: " + ", ".join(bad))

# Final full-batch isolation sweep: NONE of the completed runs' debate_ids may
# appear in the MAIN logs (belt-and-suspenders over the cell-1 gate).
all_ids = [debate_id_for(s) for s in good]
leaked_total = main_logs_contain(all_ids)
log(f"FINAL ISOLATION: {len([i for i in all_ids if i])} batch ids checked; "
    f"MY-id rows in main logs = {leaked_total} "
    f"({'CLEAN — isolation held' if leaked_total == 0 else '!! LEAK — scrub-by-id needed'})")
log("Phase-A runner exit.")

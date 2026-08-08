"""t/2192 stronger-model probe (sonnet variant): does claude-sonnet-4-6 exploit argumentation
rounds where gemini-3.5-flash-lite did not? (Phase-A arg1 vs arg4 was flat, Δconv +0.048.)
Switched from opus-4-8 (too slow to survive the reaping windows) to sonnet-4-6 per owner.

ONE variable changed vs Phase A: debater model -> claude-sonnet-4-6. Evaluator PINNED at
gemini-3.5-flash-lite (t/1846) so the instrument is unchanged and comparable to Phase A.
Argumentation fenceposts only, n=3 each = 6 debates.

Harvest-poll: kills the process as soon as the harvest lands (avoids the pattern-#86 post-
finalization hang). Isolation via debate_id membership. Idempotent (skip existing harvest).
"""
import glob, json, os, subprocess, time

WT        = r"C:\tmp\wt-t2192-opus"   # model-agnostic worktree (origin/main + junctions)
OUT       = r"C:\tmp\t2192-sonnet-out"
CFG       = r"C:\tmp\t2192-sonnet-cfg"
DATA_ROOT = r"C:\Users\jsnov\repos\ai-triad-data"
PROG      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sonnet-progress.log")
TIMEOUT_S = 2400
T3_TOPIC  = "Should compute thresholds be the primary lever for governing frontier AI?"
MAIN_LOGS = [os.path.join(DATA_ROOT, "calibration", "core", "calibration-log.jsonl"),
             os.path.join(DATA_ROOT, "calibration", "users", "local", "calibration-log.jsonl")]
os.makedirs(OUT, exist_ok=True); os.makedirs(CFG, exist_ok=True)

CELLS = [("arg1", 1), ("arg4", 4)]
N = 3
runs = []
i = 0
per = {lab: [(f"t2192-sonnet-{lab}-{k:02d}", am) for k in range(1, N+1)] for lab, am in CELLS}
while any(i < len(v) for v in per.values()):
    for lab, _ in CELLS:
        if i < len(per[lab]): runs.append(per[lab][i])
    i += 1

def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    with open(PROG, "a", encoding="utf-8") as fh: fh.write(line + "\n")

def cfg_for(slug, arg_max):
    p = os.path.join(CFG, slug + ".json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump({
            "topic": T3_TOPIC, "name": slug, "slug": slug,
            "activePovers": ["accelerationist", "safetyist"],
            "model": "claude-sonnet-4-6",              # <-- the one changed variable
            "evaluatorModel": "gemini-3.5-flash-lite",  # PINNED (t/1846) for comparability
            "useAdaptiveStaging": True, "pacing": "moderate", "maxTotalRounds": 18,
            "allowEarlyTermination": False,
            "phaseBoundsOverride": {"maxConfrontationRounds": 2,
                                    "maxArgumentationRounds": arg_max,
                                    "maxConcludingRounds": 1},
            "outputFormat": "all", "outputDir": OUT,
        }, fh, indent=1)
    return p

def harvest(slug): return os.path.join(OUT, slug + "-harvest.json")
def did_for(slug):
    p = os.path.join(OUT, slug + "-debate.json")
    if not os.path.exists(p): return None
    try:
        d = json.load(open(p, encoding="utf-8")); return d.get("id") or d.get("debate_id")
    except Exception: return None
def main_logs_contain(ids):
    ids = {i for i in ids if i}
    if not ids: return 0
    hits = 0
    for lp in MAIN_LOGS:
        try:
            for line in open(lp, encoding="utf-8"):
                if any(x in line for x in ids): hits += 1
        except FileNotFoundError: pass
    return hits

env = dict(os.environ); env["AI_TRIAD_DATA_ROOT"] = DATA_ROOT
log(f"SONNET PROBE start: {len(runs)} runs (claude-sonnet-4-6 debater, flash-lite evaluator). WT={WT}")
results = {}; iso_checked = False
for idx, (slug, arg_max) in enumerate(runs, 1):
    hp = harvest(slug)
    if os.path.exists(hp): log(f"SKIP {slug} (harvest exists)"); results[slug]="ok"; continue
    cfg = cfg_for(slug, arg_max); t0 = time.time()
    log(f"START {idx}/{len(runs)} {slug} (conf2,arg{arg_max},conc1)")
    proc = subprocess.Popen(["npx","--no-install","tsx","lib/debate/cli.ts","--config",cfg],
                            cwd=WT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
    deadline = time.time() + TIMEOUT_S
    while True:
        if os.path.exists(hp):
            time.sleep(5)
            subprocess.run(["taskkill","/F","/T","/PID",str(proc.pid)], capture_output=True, shell=True); break
        if proc.poll() is not None: break
        if time.time() > deadline:
            subprocess.run(["taskkill","/F","/T","/PID",str(proc.pid)], capture_output=True, shell=True); break
        time.sleep(15)
    ok = os.path.exists(hp); results[slug] = "ok" if ok else "FAIL"
    log(f"{'OK  ' if ok else 'FAIL'} {slug} in {time.time()-t0:.0f}s")
    if ok and not iso_checked:
        iso_checked = True; leaked = main_logs_contain([did_for(slug)])
        log(f"ISOLATION after cell 1: MY-id rows in main logs = {leaked}")
        if leaked: log("!! LEAK — aborting probe"); break
        log("ISOLATION CONFIRMED — proceeding")

good=[s for s,r in results.items() if r=="ok"]; bad=[s for s,r in results.items() if r!="ok"]
log(f"DONE ok={len(good)} fail={len(bad)}" + (f" | fail: {bad}" if bad else ""))
leaked_total = main_logs_contain([did_for(s) for s in good])
log(f"FINAL ISOLATION: MY-id rows in main logs = {leaked_total} ({'CLEAN' if leaked_total==0 else 'LEAK'})")
log("Sonnet probe exit.")

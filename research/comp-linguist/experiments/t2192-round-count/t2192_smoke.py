"""t/2228 fix validation smoke (post-#543, origin/main 7b35c96c) + t/2192 §9b isolation check.

3 debates on gemini-3.5-flash-lite spanning a short/long/medium cell:
  smoke-conf1 (1,2,1) short, smoke-arg4 (2,4,1) long (worst case for brief failures),
  smoke-conc2 (2,2,2) medium.

Gates:
  (a) FINALIZE: each run writes a -harvest.json (the whole-debate-abort bug is fixed).
  (b) ISOLATION: main cal-logs' line counts are UNCHANGED (PR #531 engine-path fix holds).
"""
import json
import os
import subprocess
import time

WT        = r"C:\tmp\wt-t2192-phaseA"
OUT       = r"C:\tmp\t2192-smoke-out"
CFG       = r"C:\tmp\t2192-smoke-cfg"
DATA_ROOT = r"C:\Users\jsnov\repos\ai-triad-data"
PROG      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smoke-progress.log")
TIMEOUT_S = 1500
T3_TOPIC  = "Should compute thresholds be the primary lever for governing frontier AI?"
MAIN_LOGS = [
    os.path.join(DATA_ROOT, "calibration", "core", "calibration-log.jsonl"),
    os.path.join(DATA_ROOT, "calibration", "users", "local", "calibration-log.jsonl"),
]
os.makedirs(OUT, exist_ok=True)
os.makedirs(CFG, exist_ok=True)

# (slug, confMax, argMax, concMax)
RUNS = [
    ("t2192-smoke-conf1", 1, 2, 1),
    ("t2192-smoke-arg4",  2, 4, 1),
    ("t2192-smoke-conc2", 2, 2, 2),
]


def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    with open(PROG, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def counts():
    o = {}
    for lp in MAIN_LOGS:
        try:
            with open(lp, encoding="utf-8") as fh:
                o[lp] = sum(1 for _ in fh)
        except FileNotFoundError:
            o[lp] = None
    return o


def cfg_for(slug, cf, ar, cc):
    p = os.path.join(CFG, slug + ".json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump({
            "topic": T3_TOPIC, "name": slug, "slug": slug,
            "activePovers": ["accelerationist", "safetyist"],
            "model": "gemini-3.5-flash-lite", "evaluatorModel": "gemini-3.5-flash-lite",
            "useAdaptiveStaging": True, "pacing": "moderate", "maxTotalRounds": 18,
            "allowEarlyTermination": False,
            "phaseBoundsOverride": {
                "maxConfrontationRounds": cf, "maxArgumentationRounds": ar,
                "maxConcludingRounds": cc,
            },
            "outputFormat": "all", "outputDir": OUT,
        }, fh, indent=1)
    return p


env = dict(os.environ)
env["AI_TRIAD_DATA_ROOT"] = DATA_ROOT
base = counts()
log("SMOKE start (HEAD 7b35c96c). ISOLATION baseline: " +
    "; ".join(f"{os.path.basename(os.path.dirname(k))}={v}" for k, v in base.items()))

res = {}
for slug, cf, ar, cc in RUNS:
    hp = os.path.join(OUT, slug + "-harvest.json")
    if os.path.exists(hp):
        os.remove(hp)
    cfg = cfg_for(slug, cf, ar, cc)
    t0 = time.time()
    log(f"START {slug} (conf{cf},arg{ar},conc{cc})")
    proc = subprocess.Popen(
        ["npx", "--no-install", "tsx", "lib/debate/cli.ts", "--config", cfg],
        cwd=WT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
    try:
        proc.wait(timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       capture_output=True, shell=True)
    ok = os.path.exists(hp)
    res[slug] = ok
    log(f"{'FINALIZED' if ok else 'FAIL(no harvest)'} {slug} in {time.time()-t0:.0f}s")

now = counts()
log("=== SMOKE RESULT ===")
finalized = sum(1 for v in res.values() if v)
log(f"(a) FINALIZE: {finalized}/{len(RUNS)} wrote harvest -> " +
    ", ".join(f"{s}={'OK' if v else 'FAIL'}" for s, v in res.items()))
deltas = {k: (now[k]-base[k]) if (now[k] is not None and base[k] is not None) else None
          for k in base}
iso_ok = all(d == 0 for d in deltas.values())
log("(b) ISOLATION: " + "; ".join(
    f"{os.path.basename(os.path.dirname(k))} {base[k]}->{now[k]} (d={deltas[k]})" for k in base))
log(f"ISOLATION {'HOLDS (main logs unchanged)' if iso_ok else '!! LEAK — main logs grew'}")
log(f"VERDICT: {'PASS — resume Phase A' if (finalized == len(RUNS) and iso_ok) else 'INVESTIGATE'}")

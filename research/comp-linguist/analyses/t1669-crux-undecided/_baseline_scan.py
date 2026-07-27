"""t/1669 AC#2 pre-change baseline: scan all archived debates for crux verdict
distribution under the CURRENT 3-value grammar, BEFORE t/1676 lands `undecided`.
Freezes the golden set + the candidate pool the finalization sweep will convert.
Read-only over the data repo."""
import json, glob, os, collections

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
OUT = r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t1669-crux-undecided/ac2-baseline.json"

files = sorted(glob.glob(os.path.join(DEB, "debate-*.json")))
# exclude secondary artifacts
files = [f for f in files if not any(f.endswith(sfx) for sfx in
         ("-comments.json", "-partial.json", "-diagnostics.json", "-harvest.json"))]

state_dist = collections.Counter()
rstatus_dist = collections.Counter()
per_debate = []
sample_crux = None
n_with_cruxes = 0
total_cruxes = 0

# Calibration proxy for the `identified`->`undecided` candidate pool:
#   history_len == 0            => never advanced (clean "undecided" candidate)
#   distinct speakers >= 2      => >1 camp named as involved (possible cross-engagement flag)
# The intersection (multi-camp AND empty history) is the population a post-landing
# transcript spot-check must adjudicate: genuinely-undecided vs engaged-but-unadvanced.
ident_hist0 = 0
ident_histN = 0
ident_multicamp = 0
ident_multicamp_hist0 = 0
ident_candidate_ids = []  # (file, crux_id) for the golden-set sampling frame

for f in files:
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception as e:
        per_debate.append({"file": os.path.basename(f), "error": str(e)})
        continue
    ct = d.get("crux_tracker") or []
    if not isinstance(ct, list):
        ct = []
    did = d.get("id")
    rounds = d.get("phase")
    model = d.get("debate_model")
    ver = d.get("app_version")
    states = collections.Counter()
    rstatuses = collections.Counter()
    identified_terminal = 0  # candidate pool for -> undecided
    for c in ct:
        if not isinstance(c, dict):
            continue
        st = c.get("state")
        rs = c.get("resolution_status")
        states[st] += 1
        state_dist[st] += 1
        if rs is not None:
            rstatuses[rs] += 1
            rstatus_dist[rs] += 1
        if st == "identified":
            identified_terminal += 1
            hlen = len(c.get("history") or [])
            spk = c.get("speakers_involved") or []
            ncamp = len(set(spk)) if isinstance(spk, list) else 0
            if hlen == 0: ident_hist0 += 1
            else: ident_histN += 1
            if ncamp >= 2:
                ident_multicamp += 1
                if hlen == 0: ident_multicamp_hist0 += 1
            ident_candidate_ids.append({"file": os.path.basename(f), "crux_id": c.get("id"),
                                         "history_len": hlen, "n_camps": ncamp})
        if sample_crux is None and st is not None:
            sample_crux = {"keys": list(c.keys()),
                           "state": st, "resolution_status": rs,
                           "from": os.path.basename(f)}
    if ct:
        n_with_cruxes += 1
        total_cruxes += len(ct)
    per_debate.append({
        "id": did, "file": os.path.basename(f), "app_version": ver,
        "model": model, "n_cruxes": len(ct),
        "states": dict(states), "resolution_statuses": dict(rstatuses),
        "identified_terminal_candidates": identified_terminal,
    })

summary = {
    "generated": "PRE-CHANGE baseline (3-value grammar), t/1669 AC#2 / before t/1676",
    "n_debate_files": len(files),
    "n_with_cruxes": n_with_cruxes,
    "total_cruxes": total_cruxes,
    "runtime_state_distribution": dict(state_dist),
    "synthesis_resolution_status_distribution": dict(rstatus_dist),
    "identified_terminal_candidate_total": sum(pd.get("identified_terminal_candidates", 0)
                                               for pd in per_debate if "id" in pd),
    "identified_candidate_proxy": {
        "empty_history_clean_undecided": ident_hist0,
        "nonempty_history_advanced_then_stuck": ident_histN,
        "multi_camp_involved": ident_multicamp,
        "multi_camp_AND_empty_history": ident_multicamp_hist0,
        "note": "multi-camp+empty-history = surfaced across >1 camp yet zero state "
                "transitions; the population a post-landing transcript spot-check must "
                "adjudicate (genuinely-undecided vs engaged-but-unadvanced).",
    },
    "sample_crux": sample_crux,
}
json.dump({"summary": summary, "per_debate": per_debate,
           "identified_candidate_frame": ident_candidate_ids},
          open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

print(json.dumps(summary, indent=2, ensure_ascii=False))
print(f"\nfroze per-debate baseline -> {OUT}")

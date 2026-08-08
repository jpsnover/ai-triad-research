"""t/2192 Phase-A screening analysis (post-#543). n=6 per fencepost.

For each of the 3 phases, compare its two round-budget fenceposts (holding the other
two phases at baseline), reading un-pooled convergence + crux metrics vs cost.

NOTE ON REACH RATE (design §1): all runs terminate `situation_cap` because
allowEarlyTermination=false forces cap-termination by design — so the reach-rate axis
(natural-decision-point vs cap) is N/A here. The read is conditional convergence + crux
+ cost. termination_reason breakdown is reported so any max_iterations censoring shows.

Per-phase verdict (design §2): INSENSITIVE if the low/high fenceposts tie —
convergence IQRs overlap AND |Δmedian convergence| < 0.05 (the MDE). Crux metrics are
CORROBORATING ONLY (CRUX_AXIS_PARAMS zero-weight gate). Guardrails flag quality-by-noise.
"""
import glob, json, os, statistics as st

PA = r"C:\tmp\t2192-phaseA-out"
PILOT = r"C:\tmp\t2192-pilot-out"

# fencepost -> (manipulated phase substr, [(slug, dir), ...])
def pa(slug): return (slug, PA)
def pilot(slug): return (slug, PILOT)
FENCEPOSTS = {
    "conf1 (conf cap=1)": ("confront", [pa(f"t2192-phaseA-conf1-{i:02d}") for i in range(1,7)]),
    "conf3 (conf cap=3)": ("confront", [pa(f"t2192-phaseA-conf3-{i:02d}") for i in range(1,7)]),
    "arg1 (arg cap=1)":   ("argument", [pilot(f"t2192-pilot-arg1-{i:02d}") for i in range(1,4)] +
                                        [pa(f"t2192-phaseA-arg1-{i:02d}") for i in range(4,7)]),
    "arg4 (arg cap=4)":   ("argument", [pilot(f"t2192-pilot-arg4-{i:02d}") for i in range(1,4)] +
                                        [pa(f"t2192-phaseA-arg4-{i:02d}") for i in range(4,7)]),
    "conc1 (conc cap=1)": ("conclud",  [pa(f"t2192-phaseA-conc1-{i:02d}") for i in range(1,7)]),
    "conc2 (conc cap=2)": ("conclud",  [pa(f"t2192-phaseA-conc2-{i:02d}") for i in range(1,7)]),
}
# phase comparisons (low, high)
PAIRS = [("Confrontation", "conf1 (conf cap=1)", "conf3 (conf cap=3)"),
         ("Argumentation", "arg1 (arg cap=1)",   "arg4 (arg cap=4)"),
         ("Concluding",    "conc1 (conc cap=1)", "conc2 (conc cap=2)")]

# build debate_id -> cal row, per dir
def load_callog(base):
    m = {}
    for lp in glob.glob(os.path.join(base, "calibration", "**", "*.jsonl"), recursive=True):
        for line in open(lp, encoding="utf-8"):
            line = line.strip()
            if not line: continue
            try: r = json.loads(line)
            except json.JSONDecodeError: continue
            if r.get("debate_id"): m[r["debate_id"]] = r
    return m
CAL = {PA: load_callog(PA), PILOT: load_callog(PILOT)}

def debate_id_and_phaserounds(slug, base, phase_substr):
    p = os.path.join(base, slug + "-debate.json")
    if not os.path.exists(p): return None, None, None
    d = json.load(open(p, encoding="utf-8"))
    did = d.get("id") or d.get("debate_id")
    asd = d.get("adaptive_staging_diagnostics") or {}
    manip = None; total = 0
    for ph in (asd.get("phases") or []):
        r = ph.get("rounds"); n = len(r) if isinstance(r, list) else (r if isinstance(r, int) else 0)
        total += n
        if phase_substr in (ph.get("phase") or "").lower(): manip = n
    return did, manip, total

def stats(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return None
    xs2 = sorted(xs)
    med = st.median(xs2)
    q1 = st.median(xs2[:len(xs2)//2]) if len(xs2) > 1 else xs2[0]
    q3 = st.median(xs2[(len(xs2)+1)//2:]) if len(xs2) > 1 else xs2[0]
    mad = st.median([abs(x-med) for x in xs2])
    return {"median": med, "q1": q1, "q3": q3, "mad": mad, "n": len(xs2), "min": xs2[0], "max": xs2[-1]}

def collect(fp):
    phase_substr, cells = FENCEPOSTS[fp]
    rows = []
    for slug, base in cells:
        did, manip, total = debate_id_and_phaserounds(slug, base, phase_substr)
        cal = CAL[base].get(did, {}) if did else {}
        rows.append({
            "slug": slug, "manip_rounds": manip, "total_rounds": total,
            "conv": cal.get("convergence_score_at_termination"),
            "crux": cal.get("crux_addressed_ratio"),
            "sit": cal.get("situation_crux_alignment"),
            "api": cal.get("total_api_calls"),
            "term": cal.get("termination_reason"),
            "rep": cal.get("repetition_rate"),
            "forgot": cal.get("claims_forgotten_rate"),
        })
    return rows

def overlap(a, b):  # IQR overlap
    return not (a["q3"] < b["q1"] or b["q3"] < a["q1"])

print("="*88)
print("t/2192 PHASE-A SCREENING — n=6 per fencepost (2 POVs, T3 topic, gemini-3.5-flash-lite)")
print("="*88)
agg = {}
for fp in FENCEPOSTS:
    rows = collect(fp)
    agg[fp] = rows
    conv = stats([r["conv"] for r in rows]); api = stats([r["api"] for r in rows])
    crux = stats([r["crux"] for r in rows]); sit = stats([r["sit"] for r in rows])
    manip = [r["manip_rounds"] for r in rows]
    terms = {}
    for r in rows: terms[r["term"]] = terms.get(r["term"], 0) + 1
    rep = stats([r["rep"] for r in rows]); forgot = stats([r["forgot"] for r in rows])
    print(f"\n### {fp}   (n={conv['n'] if conv else 0})")
    print(f"  manipulated-phase rounds: {manip}  (should be constant = cap x2)")
    print(f"  termination_reason: {terms}")
    if conv:
        print(f"  convergence_at_termination: median={conv['median']:.3f} IQR=[{conv['q1']:.3f},{conv['q3']:.3f}] MAD={conv['mad']:.3f} range=[{conv['min']:.3f},{conv['max']:.3f}]")
    if api:
        print(f"  cost total_api_calls:       median={api['median']:.0f} IQR=[{api['q1']:.0f},{api['q3']:.0f}] range=[{api['min']:.0f},{api['max']:.0f}]")
    if crux:
        print(f"  [corrob] crux_addressed_ratio median={crux['median']:.3f} IQR=[{crux['q1']:.3f},{crux['q3']:.3f}]")
    if sit:
        print(f"  [corrob] situation_crux_alignment median={sit['median']:.3f}")
    if rep and forgot:
        print(f"  [guardrail] repetition_rate median={rep['median']:.3f} | claims_forgotten_rate median={forgot['median']:.3f}")

print("\n" + "="*88)
print("PER-PHASE SENSITIVITY VERDICTS (design §2: INSENSITIVE if IQRs overlap AND |Δmedian conv| < 0.05)")
print("="*88)
for name, low, high in PAIRS:
    cl = stats([r["conv"] for r in agg[low]]); ch = stats([r["conv"] for r in agg[high]])
    al = stats([r["api"] for r in agg[low]]);  ah = stats([r["api"] for r in agg[high]])
    dconv = ch["median"] - cl["median"]; dapi = ah["median"] - al["median"]
    ov = overlap(cl, ch)
    insensitive = ov and abs(dconv) < 0.05
    print(f"\n{name}: {low.split()[0]} vs {high.split()[0]}")
    print(f"  convergence median: {cl['median']:.3f} -> {ch['median']:.3f}  (Δ={dconv:+.3f}); IQRs overlap={ov}")
    print(f"  cost median: {al['median']:.0f} -> {ah['median']:.0f} api calls (Δ={dapi:+.0f})")
    print(f"  VERDICT: {'INSENSITIVE — recommend the CHEAPER bound' if insensitive else 'SENSITIVE — candidate for Phase-B bisect'}"
          f"  ({'|Δconv|<0.05 & IQRs overlap' if insensitive else f'|Δconv|={abs(dconv):.3f}, overlap={ov}'})")

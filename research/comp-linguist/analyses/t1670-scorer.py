"""t/1670 A/B scorer. WRITTEN BEFORE RESULTS WERE SEEN (blind), so the analysis
choices cannot be tuned to the outcome. Implements PREREG-t1670 + Amendment 1.

Primary  : three-way final-checkpoint crux status distribution per arm.
Secondary: crux_addressed_ratio exactly as production computes it (diagnostic only).
Required : per-debate spread (Amendment 1) + separate debate-level / crux-level n.
Rule 1   : "changed behaviour" iff any category shifts >= 10 percentage points.
"""
import json, os, glob
from collections import Counter

DEB = r"C:\Users\jsnov\repos\ai-triad-data\debates"

# Labeling channel — the neutral evaluator's own rubric, which arm B PATCHED.
# Can move without any change in debate behaviour. (neutralEvaluator.ts:37)
STATUSES = ["addressed", "partially_addressed", "unaddressed"]

# Substance channel (Amendment 2) — convergence layer, NOT patched in arm B.
# Can only move if the debaters behaved differently. (types.ts:1152 CruxResolutionState)
# Note there is no 'undecided' state: crux_undecided_rate is DERIVED from a
# terminal 'identified' with no history transitions (t/1676), not stored.
STATES = ["identified", "engaged", "one_side_conceded", "resolved", "irreducible"]

# Slugs are NOT the config `name`. Rev-1 configs went through generateSlug,
# which drops STOP_WORDS segments, so "t1670-A-01/02" landed as "t1670-smoke-01"
# and "t1670-02" (the 'a' segment was stripped as a stop word). Rev-2 passes an
# explicit `slug` that bypasses that path. Both banked arm-A runs are kept under
# their original names rather than re-run.
ARM_A = ["t1670-smoke-01", "t1670-02"] + [f"t1670-ctrl-{i:02d}" for i in range(3, 8)]
ARM_B = [f"t1670-disc-{i:02d}" for i in range(1, 8)]

def load(name):
    p = os.path.join(DEB, f"{name}-debate.json")
    if not os.path.exists(p):
        return None
    return json.load(open(p, encoding="utf-8"))

def final_cruxes(d):
    """Final-checkpoint cruxes — the same checkpoint calibrationLogger uses."""
    ne = d.get("neutral_evaluations") or []
    fin = next((e for e in ne if e.get("checkpoint") == "final"), None)
    return (fin.get("cruxes") or []) if fin else []

def tracker_states(d):
    """Substance channel: terminal state of every tracked crux (Amendment 2)."""
    return [c.get("state") for c in (d.get("crux_tracker") or [])]


def score_arm(label, names):
    per_debate, missing, all_st, all_tr = [], [], [], []
    for n in names:
        d = load(n)
        if d is None:
            missing.append(n); continue
        cx = final_cruxes(d)
        st = [c.get("status") for c in cx]
        tr = tracker_states(d)
        all_st += st
        all_tr += tr
        # production ratio: only 'addressed' in numerator, ALL cruxes in denominator
        ratio = (sum(1 for s in st if s == "addressed") / len(st)) if st else None
        per_debate.append((n, Counter(st), len(st), ratio, Counter(tr), len(tr)))
    return {"label": label, "per_debate": per_debate, "missing": missing,
            "counts": Counter(all_st), "n_cruxes": len(all_st),
            "tracker": Counter(all_tr), "n_tracked": len(all_tr),
            "n_debates": len(per_debate)}

def pct(c, tot):
    return (100.0 * c / tot) if tot else 0.0

def report(a, b):
    print("=" * 68)
    print("t/1670 CRITERION-DISCLOSURE A/B — scored against PREREG + Amendment 1")
    print("=" * 68)
    for arm in (a, b):
        print(f"\n--- ARM {arm['label']} --- debates={arm['n_debates']}  cruxes={arm['n_cruxes']}")
        if arm["missing"]:
            print(f"    MISSING (not scored): {arm['missing']}")
        print("    per-debate spread (Amendment 1 requirement):")
        for n, c, tot, r, tc, ttot in arm["per_debate"]:
            rs = f"{r:.2f}" if r is not None else "n/a"
            print(f"      {n}: addr={c['addressed']} part={c['partially_addressed']} "
                  f"un={c['unaddressed']} (n={tot}) prod_ratio={rs} | tracked n={ttot}")
        print("    PRIMARY three-way distribution (LABELING channel, arm-B patched):")
        for s in STATUSES:
            print(f"      {s:20s} {arm['counts'][s]:3d}  ({pct(arm['counts'][s], arm['n_cruxes']):5.1f}%)")
        print("    AMENDMENT-2 distribution (SUBSTANCE channel, unpatched):")
        for s in STATES:
            print(f"      {s:20s} {arm['tracker'][s]:3d}  ({pct(arm['tracker'][s], arm['n_tracked']):5.1f}%)")

    print("\n" + "=" * 68)
    print("RULE 1 — category shifts (B minus A), threshold >= 10 pp")
    print("=" * 68)
    moved = []
    for s in STATUSES:
        pa, pb = pct(a["counts"][s], a["n_cruxes"]), pct(b["counts"][s], b["n_cruxes"])
        d = pb - pa
        flag = "SHIFT" if abs(d) >= 10 else "     "
        if abs(d) >= 10:
            moved.append((s, d))
        print(f"  {s:20s} A={pa:5.1f}%  B={pb:5.1f}%  delta={d:+6.1f}pp  {flag}")

    # Secondary diagnostic: how much the production metric hides
    def pooled_ratio(arm):
        tot = arm["n_cruxes"]
        return (arm["counts"]["addressed"] / tot) if tot else None
    ra, rb = pooled_ratio(a), pooled_ratio(b)
    print("\nSECONDARY (diagnostic only) production crux_addressed_ratio, pooled:")
    print(f"  A={ra if ra is None else f'{ra:.3f}'}   B={rb if rb is None else f'{rb:.3f}'}"
          f"   delta={'n/a' if None in (ra, rb) else f'{rb - ra:+.3f}'}")
    print("  (bins partially_addressed with unaddressed — see t/1796)")

    print("\n" + "=" * 68)
    print("AMENDMENT 2 — substance-channel shifts (B minus A), same 10 pp threshold")
    print("=" * 68)
    moved_sub = []
    for s in STATES:
        pa, pb = pct(a["tracker"][s], a["n_tracked"]), pct(b["tracker"][s], b["n_tracked"])
        dd = pb - pa
        if abs(dd) >= 10:
            moved_sub.append((s, dd))
        print(f"  {s:20s} A={pa:5.1f}%  B={pb:5.1f}%  delta={dd:+6.1f}pp  "
              f"{'SHIFT' if abs(dd) >= 10 else ''}")

    # Amendment 2 interpretation matrix — fixed before results, applied mechanically.
    lab, sub = bool(moved), bool(moved_sub)
    print("\n" + "=" * 68)
    print("VERDICT — Amendment 2 matrix (labeling x substance)")
    print("=" * 68)
    print(f"  labeling channel moved : {lab}   {[(s, f'{d:+.1f}pp') for s, d in moved]}")
    print(f"  substance channel moved: {sub}   {[(s, f'{d:+.1f}pp') for s, d in moved_sub]}")
    if lab and sub:
        print("  -> DISCLOSURE CHANGED BEHAVIOUR. Apply rule 2 (direction).")
        print("     Rule 3 hand-check still required before adoption.")
    elif lab and not sub:
        print("  -> EVALUATOR RELABELING (instrument effect). The rubric renamed the")
        print("     same debates; substance did not move. Disclosure NOT adopted.")
    elif sub and not lab:
        print("  -> RUBRIC UNDER-DETECTS. Debate substance moved but the evaluator")
        print("     failed to register it. A finding about the rubric, not the prompt.")
    else:
        print("  -> NULL (rule 4). Report it; do not re-run with a different sentence.")

    print(f"\nPOWER NOTE: debate-level n={a['n_debates']}/{b['n_debates']} (floor was 10);"
          f" crux-level n={a['n_cruxes']}/{b['n_cruxes']};"
          f" tracked-crux n={a['n_tracked']}/{b['n_tracked']}.")
    if a["n_cruxes"] and b["n_cruxes"]:
        print(f"  One labeling crux ~= {100.0 / min(a['n_cruxes'], b['n_cruxes']):.1f}pp, so the 10pp"
              f" rule needs >= {int(-(-10 // (100.0 / min(a['n_cruxes'], b['n_cruxes'])))) } cruxes to move.")
    print("  Per Amendment 2, anything short of a large, distributed, direction-consistent")
    print("  move is reported as UNDERPOWERED, INCONCLUSIVE.")

if __name__ == "__main__":
    report(score_arm("A (control, undisclosed)", ARM_A),
           score_arm("B (disclosed)", ARM_B))

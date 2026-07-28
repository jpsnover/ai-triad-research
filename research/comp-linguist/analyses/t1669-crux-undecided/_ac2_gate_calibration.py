"""t/1669 AC#2 calibration — POST engagement-gate (t/1818, c070c980).

Faithfully replicates lib/debate/cruxResolution.ts `wasCruxAdjudicated` (signal A) over the frozen
30-crux golden sample, and scores the new `identified`->`undecided` gate against the frozen
hand-labels from t/1669#7 (the pre-registered ground truth: 6 genuinely-undecided, 24 adjudicated-
in-prose). Read-only over the data repo; LLM-free (pure predicate + existing labels).

Gate semantics (cruxResolution.ts:355-433):
  wasCruxAdjudicated == True  => crux STAYS `identified` (NOT undecided)
  wasCruxAdjudicated == False => crux transitions to terminal `undecided`
So the `undecided` label is the NEGATION of the predicate.

Positive class for precision/recall = "genuinely undecided" (per hand-labels).
  TP = truly-undecided & gate labels undecided (predicate False)
  FP = truly-adjudicated & gate labels undecided (predicate False)  <- the error the gate must cut
  FN = truly-undecided & gate labels adjudicated (predicate True)   <- recall loss
Promotion rule (t/1818#2 note 1): precision >= 0.90 AND recall >= 4/6.
"""
import json, os, collections

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"

# Frozen 30-crux sample (analyses/.../ac2-prereg-and-baseline.md, locked pre-landing 2026-07-27).
SAMPLE = [
    ("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5", "AN-12"),
    ("debate-0b5dee92-4837-4bff-bd20-206aeef9b118", "AN-24"),
    ("debate-1418ee11-5641-4033-a400-c26c9f5e4f45", "AN-29"),
    ("debate-1685da89-0e7b-432b-8827-fc927200dbd5", "AN-35"),
    ("debate-1be82941-4020-478a-b334-64bb5c23e015", "AN-13"),
    ("debate-1ffff43a-4aff-4f58-b126-f020de713f8a", "AN-29"),
    ("debate-3210eb8a-e4a4-4421-8150-56a06fc4aaed", "AN-14"),
    ("debate-396208e0-60d6-4d60-a9e4-3af6b4cf9501", "AN-66"),
    ("debate-39d97d44-0a48-4da6-87d7-80a1763e6db0", "AN-51"),
    ("debate-400f834d-50c8-45f8-ba30-9936fb0e8b28", "AN-13"),
    ("debate-4c766822-edf7-43a1-b27b-413c554d6efd", "D-1"),
    ("debate-57c14a81-9e4a-45d6-91d4-db23b61bdb86", "AN-18"),
    ("debate-5c33db20-2135-4360-b269-e61d7ad8d89f", "AN-15"),
    ("debate-5ff58b8b-8097-402c-bd32-6e0573f7e022", "AN-10"),
    ("debate-6502276d-8247-40b0-8f37-44342ea5a339", "AN-11"),
    ("debate-7490d9c2-74d3-4e6d-8064-d15d8f821f11", "AN-11"),
    ("debate-835bff57-5a78-454e-b263-2e51fc3e1832", "AN-8"),
    ("debate-9152a7fd-d477-44d3-a5e1-29fa06943ba4", "AN-44"),
    ("debate-9dccfcbe-14d8-46d2-b363-6b2962fbe5c7", "AN-2"),
    ("debate-a0eaaca9-3732-43f6-b386-44d049c065d1", "AN-62"),
    ("debate-aa493447-2b1a-42b8-93cd-5f64f982e86b", "AN-1"),
    ("debate-ad01203f-b1db-4425-8682-32fb2dd4f41a", "AN-5"),
    ("debate-bd1d6c61-83ea-4029-9efd-1444c5cb1975", "AN-22"),
    ("debate-c4fe24f0-f967-4378-baa6-a845c4d768fc", "AN-8"),
    ("debate-cbf5bb79-b02b-47af-9e4a-d1baa79373b0", "AN-1"),
    ("debate-cff6b797-64fb-447c-b738-b5b67b0ede37", "AN-26"),
    ("debate-d6a1b446-8e05-4873-8422-3a16763a3b7d", "AN-25"),
    ("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8", "AN-23"),
    ("debate-f2a29ea0-b7a3-4b93-8ece-85b8ae8e9ad4", "AN-22"),
    ("debate-f9c54c70-dfc3-4255-b125-0c49da39c519", "AN-9"),
]

# Ground truth (t/1669#7 RESULTS, hand-scored pre-registered): the 6 genuinely-undecided cruxes.
# Everything else in the sample was adjudicated in prose (FALSE undecided under the old proxy).
TRUE_UNDECIDED = {
    ("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5", "AN-12"),   # asserted-and-echoed
    ("debate-0b5dee92-4837-4bff-bd20-206aeef9b118", "AN-24"),   # asserted-and-echoed
    ("debate-1418ee11-5641-4033-a400-c26c9f5e4f45", "AN-29"),   # Ford stat (evidentiary premise)
    ("debate-1ffff43a-4aff-4f58-b126-f020de713f8a", "AN-29"),   # Copyright-Office stat
    ("debate-4c766822-edf7-43a1-b27b-413c554d6efd", "D-1"),     # China-ban fact
    ("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8", "AN-23"),   # Iceberg stat
}


def was_crux_adjudicated(crux, nodes, min_turns_per_camp=1, min_shared_refs_per_turn=1, transcript=None):
    """Port of cruxResolution.ts wasCruxAdjudicated (signal A). transcript passed separately."""
    cnode = next((n for n in nodes if n.get("id") == crux.get("id")), None)
    raw = (cnode or {}).get("taxonomy_refs") or []
    # Crux node refs are bare strings on disk; coerce defensively (normalize-at-fetch) in case any
    # entry is a dict — the shipped TS assumes strings, so a dict there is a real (separate) defect.
    crux_refs = set()
    dict_shaped = 0
    for r in raw:
        if isinstance(r, str):
            crux_refs.add(r)
        elif isinstance(r, dict):
            dict_shaped += 1
            crux_refs.add(r.get("node_id"))  # what a corrected predicate would use
    # No anchor => predicate returns False (stays undecided-eligible). Faithful to TS line 368.
    if not crux_refs:
        return False, {"reason": "no_crux_taxonomy_anchor", "dict_shaped_refs": dict_shaped, "camps": {}}

    camps_engaged = 0
    per_camp = {}
    for camp in dict.fromkeys(crux.get("speakers_involved") or []):  # de-dup, order-stable
        qualifying = 0
        for entry in (transcript or []):
            if entry.get("speaker") != camp:
                continue
            shared = 0
            for ref in (entry.get("taxonomy_refs") or []):
                nid = ref.get("node_id") if isinstance(ref, dict) else ref
                if nid in crux_refs:
                    shared += 1
            if shared >= min_shared_refs_per_turn:
                qualifying += 1
        per_camp[camp] = qualifying
        if qualifying >= min_turns_per_camp:
            camps_engaged += 1
    return camps_engaged >= 2, {"reason": "signal_A", "dict_shaped_refs": dict_shaped,
                                "camps": per_camp, "n_crux_refs": len(crux_refs)}


def run(min_turns_per_camp, min_shared_refs_per_turn):
    rows = []
    for fn, cid in SAMPLE:
        path = os.path.join(DEB, fn + ".json")
        d = json.load(open(path, encoding="utf-8"))
        crux = next((c for c in (d.get("crux_tracker") or []) if c.get("id") == cid), None)
        an = d.get("argument_network") or {}
        nodes = an.get("nodes") or []
        transcript = d.get("transcript") or []
        adjudicated, dbg = was_crux_adjudicated(
            crux, nodes, min_turns_per_camp, min_shared_refs_per_turn, transcript)
        gate_label = "identified" if adjudicated else "undecided"
        truth = "undecided" if (fn, cid) in TRUE_UNDECIDED else "adjudicated"
        rows.append({"file": fn[:15], "crux": cid, "state": crux.get("state"),
                     "camps": crux.get("speakers_involved"),
                     "gate_adjudicated": adjudicated, "gate_label": gate_label,
                     "truth": truth, "dbg": dbg})
    return rows


def score(rows):
    tp = sum(1 for r in rows if r["truth"] == "undecided" and r["gate_label"] == "undecided")
    fp = sum(1 for r in rows if r["truth"] == "adjudicated" and r["gate_label"] == "undecided")
    fn = sum(1 for r in rows if r["truth"] == "undecided" and r["gate_label"] == "identified")
    tn = sum(1 for r in rows if r["truth"] == "adjudicated" and r["gate_label"] == "identified")
    n_und = tp + fp
    precision = tp / n_und if n_und else float("nan")
    recall = tp / (tp + fn) if (tp + fn) else float("nan")
    return dict(tp=tp, fp=fp, fn=fn, tn=tn, n_undecided_labeled=n_und,
                precision=precision, recall=recall)


print("Frozen 30-crux sample | ground truth: 6 genuinely-undecided, 24 adjudicated (t/1669#7)\n")
for mtpc in (1, 2):
    rows = run(min_turns_per_camp=mtpc, min_shared_refs_per_turn=1)
    s = score(rows)
    print(f"===== knob minTurnsPerCamp={mtpc}, minSharedRefsPerTurn=1 =====")
    print(f"  undecided-labeled={s['n_undecided_labeled']}  "
          f"precision={s['precision']:.3f}  recall={s['recall']:.3f} ({s['tp']}/6)")
    print(f"  confusion: TP={s['tp']} FP={s['fp']} FN={s['fn']} TN={s['tn']}")
    # show the misclassifications
    fps = [(r['file'], r['crux'], r['dbg']['camps']) for r in rows
           if r['truth'] == 'adjudicated' and r['gate_label'] == 'undecided']
    fns = [(r['file'], r['crux'], r['dbg']['camps']) for r in rows
           if r['truth'] == 'undecided' and r['gate_label'] == 'identified']
    print(f"  FP (adjudicated wrongly -> undecided): {len(fps)}")
    for f in fps:
        print(f"      {f[0]} {f[1]}  per_camp_qualifying_turns={f[2]}")
    print(f"  FN (true-undecided wrongly kept identified): {len(fns)}")
    for f in fns:
        print(f"      {f[0]} {f[1]}  per_camp_qualifying_turns={f[2]}")
    dictshaped = [r for r in rows if r['dbg'].get('dict_shaped_refs')]
    if dictshaped:
        print(f"  NOTE dict-shaped crux-node taxonomy_refs on {len(dictshaped)} cruxes (shipped TS would miss these)")
    print()

# Full per-crux table at the default (shipped) knob for the record.
print("===== per-crux detail @ shipped default (minTurnsPerCamp=1, minSharedRefsPerTurn=1) =====")
rows = run(1, 1)
print(f"{'file':16} {'crux':6} {'truth':11} {'gate':11} {'match':5} camps_qualifying")
for r in rows:
    match = "OK" if ((r['truth'] == 'undecided') == (r['gate_label'] == 'undecided')) else "XX"
    print(f"{r['file']:16} {r['crux']:6} {r['truth']:11} {r['gate_label']:11} {match:5} {r['dbg']['camps']}")

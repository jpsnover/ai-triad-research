"""t/1669 AC#2 — root-cause diagnostic for the signal-A null result.
Hypothesis: crux nodes are anchored ONLY to the owner camp's taxonomy nodes (acc-/saf-/skp- prefix),
so an opposing camp that rebuts in prose never shares a ref with the crux node => signal A cannot
see cross-camp engagement. Quantify the camp-prefix composition of each frozen crux node's
taxonomy_refs and the per-camp shared-ref counts. Read-only."""
import json, os, collections

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
OUT = r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t1669-crux-undecided/ac2-gate-results.json"

SAMPLE = [
    ("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5","AN-12"),("debate-0b5dee92-4837-4bff-bd20-206aeef9b118","AN-24"),
    ("debate-1418ee11-5641-4033-a400-c26c9f5e4f45","AN-29"),("debate-1685da89-0e7b-432b-8827-fc927200dbd5","AN-35"),
    ("debate-1be82941-4020-478a-b334-64bb5c23e015","AN-13"),("debate-1ffff43a-4aff-4f58-b126-f020de713f8a","AN-29"),
    ("debate-3210eb8a-e4a4-4421-8150-56a06fc4aaed","AN-14"),("debate-396208e0-60d6-4d60-a9e4-3af6b4cf9501","AN-66"),
    ("debate-39d97d44-0a48-4da6-87d7-80a1763e6db0","AN-51"),("debate-400f834d-50c8-45f8-ba30-9936fb0e8b28","AN-13"),
    ("debate-4c766822-edf7-43a1-b27b-413c554d6efd","D-1"),("debate-57c14a81-9e4a-45d6-91d4-db23b61bdb86","AN-18"),
    ("debate-5c33db20-2135-4360-b269-e61d7ad8d89f","AN-15"),("debate-5ff58b8b-8097-402c-bd32-6e0573f7e022","AN-10"),
    ("debate-6502276d-8247-40b0-8f37-44342ea5a339","AN-11"),("debate-7490d9c2-74d3-4e6d-8064-d15d8f821f11","AN-11"),
    ("debate-835bff57-5a78-454e-b263-2e51fc3e1832","AN-8"),("debate-9152a7fd-d477-44d3-a5e1-29fa06943ba4","AN-44"),
    ("debate-9dccfcbe-14d8-46d2-b363-6b2962fbe5c7","AN-2"),("debate-a0eaaca9-3732-43f6-b386-44d049c065d1","AN-62"),
    ("debate-aa493447-2b1a-42b8-93cd-5f64f982e86b","AN-1"),("debate-ad01203f-b1db-4425-8682-32fb2dd4f41a","AN-5"),
    ("debate-bd1d6c61-83ea-4029-9efd-1444c5cb1975","AN-22"),("debate-c4fe24f0-f967-4378-baa6-a845c4d768fc","AN-8"),
    ("debate-cbf5bb79-b02b-47af-9e4a-d1baa79373b0","AN-1"),("debate-cff6b797-64fb-447c-b738-b5b67b0ede37","AN-26"),
    ("debate-d6a1b446-8e05-4873-8422-3a16763a3b7d","AN-25"),("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8","AN-23"),
    ("debate-f2a29ea0-b7a3-4b93-8ece-85b8ae8e9ad4","AN-22"),("debate-f9c54c70-dfc3-4255-b125-0c49da39c519","AN-9"),
]
TRUE_UNDECIDED = {("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5","AN-12"),
    ("debate-0b5dee92-4837-4bff-bd20-206aeef9b118","AN-24"),("debate-1418ee11-5641-4033-a400-c26c9f5e4f45","AN-29"),
    ("debate-1ffff43a-4aff-4f58-b126-f020de713f8a","AN-29"),("debate-4c766822-edf7-43a1-b27b-413c554d6efd","D-1"),
    ("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8","AN-23")}

PREFIX = ("acc", "saf", "skp")
def camp_prefix(ref):
    return ref.split("-", 1)[0] if isinstance(ref, str) and ref.split("-", 1)[0] in PREFIX else "other"

detail = []
single_camp_anchor = 0
for fn, cid in SAMPLE:
    d = json.load(open(os.path.join(DEB, fn + ".json"), encoding="utf-8"))
    crux = next((c for c in (d.get("crux_tracker") or []) if c.get("id") == cid), None)
    nodes = (d.get("argument_network") or {}).get("nodes") or []
    cnode = next((n for n in nodes if n.get("id") == cid), None)
    refs = (cnode or {}).get("taxonomy_refs") or []
    pref = collections.Counter(camp_prefix(r) for r in refs)
    distinct_camps = {p for p in pref if p in PREFIX}
    if len(distinct_camps) <= 1:
        single_camp_anchor += 1
    detail.append({
        "file": fn[:15], "crux": cid, "n_refs": len(refs),
        "ref_camp_prefixes": dict(pref), "distinct_owner_camps_in_refs": sorted(distinct_camps),
        "crux_speakers_involved": crux.get("speakers_involved"),
        "truth": "undecided" if (fn, cid) in TRUE_UNDECIDED else "adjudicated",
    })

print(f"Crux-node taxonomy_ref camp composition (frozen 30) — is the crux node single-camp-anchored?\n")
print(f"{'file':16}{'crux':6}{'truth':12}{'#refs':6}{'owner-camps-in-refs':22}{'ref_prefixes'}")
for r in detail:
    print(f"{r['file']:16}{r['crux']:6}{r['truth']:12}{r['n_refs']:<6}"
          f"{str(r['distinct_owner_camps_in_refs']):22}{r['ref_camp_prefixes']}")
print(f"\nSINGLE-camp-anchored crux nodes: {single_camp_anchor}/30 "
      f"({single_camp_anchor/30*100:.0f}%) — the ceiling on signal-A's ability to see 2 opposing camps.")

json.dump({"anchor_diagnostic": detail, "single_camp_anchor_count": single_camp_anchor,
           "n_sample": len(SAMPLE)}, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"\nwrote -> {OUT}")

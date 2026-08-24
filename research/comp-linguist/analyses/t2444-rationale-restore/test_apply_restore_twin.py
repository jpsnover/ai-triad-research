#!/usr/bin/env python3
"""Twin-aware identity conformance for apply_restore.py (t/2946).

The restore is the THIRD consumer of the identity model TL prescribed in e/120#37 — alongside
`lib/edges/mergeEdgesPreservingRationale` (TS, t/2957) and the PS Arm-1 guard (t/2956). Literal
code reuse is impossible across Python/TS/PowerShell, so drift is prevented the same way it is
for the PS guard: all three conform to ONE shared fixture, loaded BY PATH, never transcribed.
A copied fixture makes divergence undetectable, which is the whole failure this guards.

Run: python test_apply_restore_twin.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "twin-fixture.json")   # shared with the TS + PS suites

sys.path.insert(0, HERE)
from apply_restore import resolve_source, twin_id, ckey, has_rat   # noqa: E402

failures = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        failures.append(f"{name} — {detail}")
    return cond


def main():
    with open(FIXTURE, encoding="utf-8") as f:
        fx = json.load(f)

    print(f"fixture: {FIXTURE}")
    print(f"identity_rule: {fx['identity_rule'][:88]}...\n")

    # ---- case_a (observed): distinguishable twins → each twin gets ITS OWN rationale ----
    a = fx["case_a_distinguishable"]
    print("case_a_distinguishable (observed — real ba3128f5 pair):")
    on_disk = a["on_disk"]["edges"]
    payload = a["save_payload"]["edges"]
    cands = [e for e in on_disk if has_rat(e)]
    check("both on-disk twins carry a rationale", len(cands) == 2, f"got {len(cands)}")

    resolved = []
    for p in payload:
        src, disp = resolve_source(p, cands)
        resolved.append((p, src, disp))
        check(f"twin {twin_id(p)} resolves via tie-break",
              src is not None and disp == "twin-resolved", f"disp={disp}")

    # The load-bearing assertion: NO CROSSOVER. Each payload twin must get the rationale of the
    # on-disk edge sharing its (discovered_at, model) — not the other twin's.
    for p, src, _ in resolved:
        if src is None:
            continue
        expected = next(c["rationale"] for c in cands if twin_id(c) == twin_id(p))
        check(f"twin {twin_id(p)} got its OWN rationale (no crossover)",
              src["rationale"] == expected,
              f"got {src['rationale'][:48]!r}, expected {expected[:48]!r}")

    texts = {src["rationale"] for _, src, _ in resolved if src}
    check("the two twins received DIFFERENT rationales", len(texts) == 2,
          "both twins got the same text — this is the last-wins bug t/2946#16 found")

    # ---- case_b (constructed): indistinguishable twins → refuse, never guess ----
    b = fx["case_b_indistinguishable"]
    print("\ncase_b_indistinguishable (constructed — no such pair exists live):")
    on_disk_b = b["on_disk"]["edges"]
    payload_b = b["save_payload"]["edges"]
    cands_b = [e for e in on_disk_b if has_rat(e)]
    check("both on-disk twins carry a rationale", len(cands_b) == 2, f"got {len(cands_b)}")
    check("the twins are genuinely indistinguishable",
          twin_id(cands_b[0]) == twin_id(cands_b[1]), "fixture twins differ — case_b is vacuous")

    for p in payload_b:
        src, disp = resolve_source(p, cands_b)
        check("indistinguishable twin REFUSES (returns nothing)", src is None, f"got {src}")
        check("disposition is twin-ambiguous", disp == "twin-ambiguous", f"disp={disp}")

    # ---- unique key still resolves (no regression on the 33,393 non-twin edges) ----
    print("\nunique-key control:")
    solo = [dict(on_disk[0])]
    src, disp = resolve_source(payload[0], solo)
    check("single candidate resolves as 'unique'", src is not None and disp == "unique",
          f"disp={disp}")

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f_ in failures:
            print(f"  - {f_}")
        return 1
    print("ALL TWIN-CONFORMANCE CHECKS PASS — apply_restore.py matches the shared identity model.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

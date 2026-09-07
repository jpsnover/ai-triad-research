#!/usr/bin/env python3
"""t/3381 about[]-component blind golden builder (Option A re-measure, SO e/145).

Builds the BLIND labeling worksheet + a frozen sample manifest for the `about[]`-component
floor measurement — the load-bearing axis of the pre-committed acceptance rule
(register § "Pre-committed acceptance rule": concept-anchored about-component ≥ 0.80).

Blindness (t/3342): the worksheet shows the Proposition + ALL candidate refs (entity_refs +
concept_refs) and asks the labeler to build the REFERENCE about-set from scratch — it does NOT
show the generator's produced about[]. The scorer then compares generator-about vs the blind
reference to get about-component precision/recall on concept-anchored rows.

Sampling (deterministic, no RNG — stable/re-runnable, per the existing golden tool):
- production `about[]` is concept-dominant (605 concept-only / 13 mixed / 10 entity-only nodes),
  so a representative sample is concept-dominant — exactly what the floor axis needs.
- oversample the tiny entity minority (23 nodes) as the control arm, and FORCE-INCLUDE the lone
  `instance_of` node (skp-beliefs-170) so match_level diversity is exercised.
Frozen manifest = the golden distribution record (ids + profile + match_levels), committed so the
re-measure is reproducible and never re-derived at score time.

Usage: python build_about_golden_worksheet.py [--n-concept 35] [--n-entity 15] [--out-dir .]
"""
import argparse, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")

DATA_ROOT = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "..", "ai-triad-data")
ORIGIN = os.path.join(DATA_ROOT, "taxonomy", "Origin")
FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")
CAMPS, CATS = ("acc", "saf", "skp"), ("Beliefs", "Desires", "Intentions")
FORCE_INCLUDE = ("skp-beliefs-170",)  # the only instance_of about-rows — match_level diversity


def _kind(ref):
    return "term:" if ref.startswith("term:") else ("ent-" if ref.startswith("ent-") else "other")


def load():
    names, nodes = {}, []
    ep = os.path.join(ORIGIN, "entities.json")
    if os.path.exists(ep):
        names = {e["id"]: e.get("name", "") for e in json.load(open(ep, encoding="utf-8")).get("entities", [])}
    for fn in FILES:
        p = os.path.join(ORIGIN, fn)
        if not os.path.exists(p):
            sys.stderr.write(f"WARN fallback: origin file missing, skipped {p} (AI_TRIAD_DATA_ROOT unset/wrong)\n")
            continue
        for n in json.load(open(p, encoding="utf-8"))["nodes"]:
            ab = (n.get("logical_form") or {}).get("about") or []
            if ab:
                kinds = {_kind(a.get("ref", "")) for a in ab}
                n["_profile"] = ("mixed" if {"term:", "ent-"} <= kinds
                                 else "concept-only" if kinds == {"term:"}
                                 else "entity-only" if kinds == {"ent-"} else "other")
                nodes.append(n)
    return names, nodes


def stride(ordered, k):
    ordered = sorted(ordered, key=lambda n: n["id"])
    if len(ordered) <= k:
        return ordered
    s = len(ordered) / k
    return [ordered[int(i * s)] for i in range(k)]


def sample(nodes, n_concept, n_entity):
    by_id = {n["id"]: n for n in nodes}
    entity_bearing = [n for n in nodes if n["_profile"] in ("mixed", "entity-only")]
    concept = [n for n in nodes if n["_profile"] == "concept-only"]
    picked = {}
    # concept arm: stride within camp×category strata for spread
    per_cell = max(1, n_concept // (len(CAMPS) * len(CATS)))
    for c in CAMPS:
        for k in CATS:
            cell = [n for n in concept if n["id"].split("-")[0] == c and n.get("category") == k]
            for n in stride(cell, per_cell):
                picked[n["id"]] = n
    # entity arm (control) + forced match_level-diversity node
    for n in stride(entity_bearing, n_entity):
        picked[n["id"]] = n
    for fid in FORCE_INCLUDE:
        if fid in by_id:
            picked[fid] = by_id[fid]
    return [picked[i] for i in sorted(picked)]


def candidate_refs(n, names):
    rows = []
    for r in (n.get("entity_refs") or []):
        eid = r.get("ref", "")
        rows.append(f"  - {eid}  (entity: {names.get(eid, r.get('surface',''))})")
    for r in (n.get("concept_refs") or []):
        rows.append(f"  - {r.get('ref','')}  (concept: {r.get('surface','')})")
    return "\n".join(rows) or "  (none)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-concept", type=int, default=35)
    ap.add_argument("--n-entity", type=int, default=15)
    ap.add_argument("--out-dir", default=os.path.dirname(os.path.abspath(__file__)))
    a = ap.parse_args()
    names, nodes = load()
    picked = sample(nodes, a.n_concept, a.n_entity)

    manifest = {"ticket": "t/3381", "purpose": "about[]-component blind golden (Option A re-measure)",
                "acceptance_axis": "concept-anchored about-component >= 0.80 (register pre-committed rule)",
                "count": len(picked),
                "profile_counts": {p: sum(1 for n in picked if n["_profile"] == p)
                                   for p in ("concept-only", "mixed", "entity-only")},
                "ids": [{"id": n["id"], "profile": n["_profile"],
                         "prod_about": [{"ref": x.get("ref"), "match_level": x.get("match_level")}
                                        for x in n["logical_form"]["about"]]} for n in picked]}
    mpath = os.path.join(a.out_dir, "sample-manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False); f.write("\n")

    lines = [
        "# about[] blind golden worksheet (t/3381, Option A re-measure)",
        "",
        "**Blind task.** For each node, read the Proposition + Candidate refs, then — WITHOUT looking at",
        "the production data — list in `REFERENCE_ABOUT:` the ref-ids the claim is genuinely *about* (its",
        "topical subject(s)). `about[]` is a typed topical index: a ref may be `ent-*` OR `term:*`; include",
        "a ref iff the claim is topically about that entity/concept. This reference set is compared against",
        "the generator's produced about[] to score the about-component (concept-anchored floor >= 0.80).",
        "",
        "Do not edit anything but the `REFERENCE_ABOUT:` (comma-separated ref-ids, or `none`) and `NOTES:`",
        f"lines. Sample: {len(picked)} nodes ({manifest['profile_counts']}); deterministic.",
        "", "---", "",
    ]
    for i, n in enumerate(picked, 1):
        prop = (n.get("label", "") + ". " + (n.get("description") or n.get("plain_description") or "")).strip()
        lines += [
            f"## [{i}] {n['id']}   (camp={n['id'].split('-')[0]}, category={n.get('category','?')}, profile={n['_profile']})",
            f"**Proposition:** {prop}",
            "**Candidate refs:**", candidate_refs(n, names),
            "", "**REFERENCE_ABOUT:** ", "**NOTES:** ", "", "---", "",
        ]
    wpath = os.path.join(a.out_dir, "about-golden-worksheet.md")
    with open(wpath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {len(picked)} nodes -> {wpath}")
    print(f"manifest -> {mpath}")
    print("profile:", manifest["profile_counts"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

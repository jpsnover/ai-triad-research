"""
t/1069 Phase A human eval — safety-sharing topic.
Samples 5 turns per debate (seed=1069). For each turn prints:
  - Debater content (first 400 chars)
  - Extracted AN claims with bdi_category, extraction_confidence, taxonomy_refs
  - Outbound edges (relationship type + warrant)
  - turn_validation quality score
Then prints BDI distribution and edge-type distribution for the full AN.
"""
import json, random, textwrap

SEED = 1069
CTRL  = "C:/Users/jsnov/repos/ai-triad-data/debates/exp-1069-ctrl-safety-sharing-debate.json"
TREAT = "C:/Users/jsnov/repos/ai-triad-data/debates/exp-1069-allcheap-safety-sharing-debate.json"

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def build_edge_index(edges):
    """source_id -> list of edges"""
    idx = {}
    for e in edges:
        idx.setdefault(e["source"], []).append(e)
    return idx

def eval_debate(path, label):
    d = load(path)
    tr   = d.get("transcript", [])
    tv   = d.get("turn_validations", {})
    an   = d.get("argument_network", {})
    nodes = an.get("nodes", [])
    edges = an.get("edges", [])
    es   = d.get("extraction_summary", {})

    by_source = {}
    for n in nodes:
        by_source.setdefault(n.get("source_entry_id", ""), []).append(n)

    edge_idx = build_edge_index(edges)

    debater_turns = [t for t in tr
                     if t.get("speaker") in ("accelerationist", "safetyist", "skeptic")]

    rng = random.Random(SEED)
    sampled = rng.sample(debater_turns, min(5, len(debater_turns)))
    sampled.sort(key=lambda t: tr.index(t))

    print(f"\n{'#'*72}")
    print(f"# {label}")
    print(f"# model={d.get('debate_model')}  evaluator={d.get('evaluator_model')}")
    print(f"# AN: {len(nodes)} nodes / {len(edges)} edges")
    print(f"# Extraction summary: {es.get('total_accepted')} accepted / "
          f"{es.get('total_rejected')} rejected / "
          f"acceptance_rate={round(es.get('acceptance_rate', 0), 3)} / "
          f"unattributed={es.get('unattributed_claim_ratio', 'n/a')}")
    rr = es.get("rejection_reason_totals", {})
    if rr:
        print(f"# Rejection reasons: {dict(sorted(rr.items(), key=lambda x: -x[1]))}")

    # --- Per-turn eval ---
    for i, turn in enumerate(sampled):
        tid     = turn["id"]
        speaker = turn.get("speaker", "?")
        content = turn.get("content", "")
        claims  = by_source.get(tid, [])
        val     = tv.get(tid, {})
        final   = val.get("final", {}) if isinstance(val, dict) else {}

        print(f"\n{'='*72}")
        print(f"TURN {i+1}/5 | {speaker.upper()} | turn_id={tid[:8]}...")
        print(f"CONTENT:\n{textwrap.fill(content[:400], 70)}")
        if len(content) > 400:
            print("  [...]")

        # Evaluator quality score
        print(f"\nEVALUATOR: judge_quality={final.get('judge_quality_score','?')} | "
              f"outcome={final.get('outcome','?')} | process_reward={final.get('process_reward','?')}")
        dims = final.get("dimensions", {})
        if dims:
            for dim, dval in dims.items():
                if isinstance(dval, dict):
                    issues = dval.get("issues", [])
                    status = "OK" if dval.get("pass") else "FAIL"
                    print(f"  dim.{dim}: {status}" + (f" — {issues[0][:80]}" if issues else ""))

        # Claims extracted from this turn
        print(f"\nCLAIMS EXTRACTED: {len(claims)}")
        for c in claims:
            nid   = c.get("id", "?")
            text  = c.get("text", "")[:90]
            bdi   = c.get("bdi_category", "?")
            conf  = round(c.get("extraction_confidence", 0), 3)
            txrefs = c.get("taxonomy_refs", [])
            out_edges = edge_idx.get(nid, [])
            print(f"  [{nid}] bdi={bdi} conf={conf} refs={txrefs[:3]}")
            print(f"    \"{text}\"")
            for e in out_edges[:2]:
                tgt    = e.get("target", "?")
                etype  = e.get("type", "?")
                scheme = e.get("scheme", "?")
                warrant = e.get("warrant", "")[:80]
                print(f"    --{etype}--> {tgt} ({scheme}): {warrant}")

        # RepairHints (signal of quality issues)
        hints = final.get("repairHints", [])
        if hints:
            print(f"\nREPAIR HINTS ({len(hints)}):")
            for h in hints[:2]:
                hint_text = h if isinstance(h, str) else str(h)[:120]
                print(f"  - {hint_text[:120]}")

    # --- Full AN summary ---
    print(f"\n{'='*72}")
    print(f"AN SUMMARY — {label}")

    bdi_counts = {}
    for n in nodes:
        bdi = n.get("bdi_category", "unknown")
        bdi_counts[bdi] = bdi_counts.get(bdi, 0) + 1
    print(f"  BDI distribution: {bdi_counts}")

    edge_types = {}
    for e in edges:
        et = e.get("type", "?")
        edge_types[et] = edge_types.get(et, 0) + 1
    print(f"  Edge types: {dict(sorted(edge_types.items(), key=lambda x: -x[1]))}")

    schemes = {}
    for e in edges:
        s = e.get("scheme", "?")
        schemes[s] = schemes.get(s, 0) + 1
    top_schemes = sorted(schemes.items(), key=lambda x: -x[1])[:8]
    print(f"  Top schemes: {top_schemes}")

    # Duplication check on claim text (first 60 chars)
    prefixes = [n.get("text", "")[:60].lower() for n in nodes]
    seen, dups = set(), []
    for p in prefixes:
        if p in seen and p:
            dups.append(p[:40])
        seen.add(p)
    print(f"  Text-prefix duplicates (60 chars): {len(dups)}")
    if dups:
        for dup in dups[:3]:
            print(f"    \"{dup}\"")

    # Taxonomy attribution quality: nodes with ≥1 BDI ref (not just sit-)
    bdi_refs = 0
    for n in nodes:
        refs = n.get("taxonomy_refs", [])
        if any(r.startswith(("acc-", "saf-", "skp-")) for r in refs):
            bdi_refs += 1
    print(f"  Nodes with BDI taxonomy refs: {bdi_refs}/{len(nodes)} "
          f"({round(100*bdi_refs/max(len(nodes),1))}%)")

    conf_vals = [n.get("extraction_confidence", 0) for n in nodes]
    if conf_vals:
        avg_conf = round(sum(conf_vals)/len(conf_vals), 3)
        low_conf = sum(1 for c in conf_vals if c < 0.7)
        print(f"  Avg extraction_confidence: {avg_conf}  "
              f"Low-confidence (<0.7): {low_conf}/{len(conf_vals)}")


eval_debate(CTRL,  "CONTROL (all Opus)")
eval_debate(TREAT, "TREATMENT (flash-lite evaluator)")

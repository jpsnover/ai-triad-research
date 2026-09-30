"""
Steelman-engagement baseline instrument (t/3787, e/230, e/231).

Measures how often opening-statement steelman nodes are engaged by LATER debate
turns, as inbound argument-network edges into steelman nodes (nodes carrying a
truthy `steelman_of`). This is the direct operationalisation of the PI's
"nothing connected to those statements" observation and the pre-registered
primary metric for the steelman-engagement hypothesis.

IMPORTANT: this measures the PRE-FIX state (the t/3787 misfiling bug is live),
so it is the "before" baseline, deliberately measured on the confounded circuit.
Re-run after t/3787 lands to test the hypothesis.

Usage:  AI_TRIAD_DATA_ROOT=<data repo>  python measure_steelman_engagement.py [N]
        N = recency window of debates by mtime (default 120).

Data model (confirmed 2026-09-30):
  debate.argument_network.nodes[] : {id, speaker, steelman_of?, turn_number, ...}
  debate.argument_network.edges[] : {id, source, target, type(supports|attacks|...), ...}
  A steelman node: steelman_of truthy (names the steelmanned camp); speaker = author camp.
  "Later-turn inbound edge": edge.target == steelman.id AND source.turn_number > steelman.turn_number.
"""
import json, os, glob, collections, statistics, sys

DATA = os.environ["AI_TRIAD_DATA_ROOT"]
N = int(sys.argv[1]) if len(sys.argv) > 1 else 120

debs = glob.glob(os.path.join(DATA, "debates", "debate-*.json"))
debs.sort(key=os.path.getmtime, reverse=True)
debs = debs[:N]


def turn_of(node):
    try:
        return int(node.get("turn_number"))
    except (TypeError, ValueError):
        return None


def main():
    total_steel = 0
    later_inbound = []            # later-turn inbound edge count, per steelman node
    any_later = 0
    type_counter = collections.Counter()        # edge types, later-turn inbound
    src_camp_rel = collections.Counter()         # source camp relative to the steelman
    debates_with_steel = 0

    for p in debs:
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        an = d.get("argument_network")
        if not isinstance(an, dict):
            continue
        nodes = an.get("nodes") or []
        edges = an.get("edges") or []
        if not nodes:
            continue
        byid = {n.get("id"): n for n in nodes if isinstance(n, dict)}
        steel = {n.get("id"): n for n in nodes
                 if isinstance(n, dict) and n.get("steelman_of")}
        if steel:
            debates_with_steel += 1
        for e in edges:
            if not isinstance(e, dict):
                continue
            tgt = e.get("target")
            if tgt not in steel:
                continue
            sn = byid.get(e.get("source"))
            stn = steel[tgt]
            s_turn = turn_of(sn) if sn else None
            t_turn = turn_of(stn)
            if s_turn is None or t_turn is None or s_turn <= t_turn:
                continue
            type_counter[e.get("type")] += 1
            steel_of = stn.get("steelman_of")   # steelmanned camp
            author = stn.get("speaker")          # author camp
            src_sp = sn.get("speaker") if sn else None
            if src_sp == steel_of:
                src_camp_rel["from_steelmanned_camp"] += 1
            elif src_sp == author:
                src_camp_rel["from_author_camp"] += 1
            else:
                src_camp_rel["from_third_camp"] += 1
        for nid, n in steel.items():
            total_steel += 1
            t_turn = turn_of(n)
            cnt = 0
            for e in edges:
                if isinstance(e, dict) and e.get("target") == nid:
                    sn = byid.get(e.get("source"))
                    s_turn = turn_of(sn) if sn else None
                    if s_turn is not None and t_turn is not None and s_turn > t_turn:
                        cnt += 1
            later_inbound.append(cnt)
            if cnt > 0:
                any_later += 1

    print(f"debates scanned (recent by mtime): {len(debs)}")
    print(f"debates with >=1 steelman node: {debates_with_steel}")
    print(f"total steelman nodes (n): {total_steel}")
    if not later_inbound:
        print("NO steelman nodes found.")
        return
    print()
    print("PRIMARY METRIC - later-turn inbound edges per steelman node:")
    print(f"  mean={statistics.mean(later_inbound):.2f} median={statistics.median(later_inbound)} "
          f"max={max(later_inbound)}")
    print(f"  connection rate (>=1 later inbound edge): {any_later}/{len(later_inbound)} "
          f"({any_later/len(later_inbound):.0%})")
    print(f"  distribution: {dict(sorted(collections.Counter(later_inbound).items()))}")
    print()
    print(f"later-turn inbound edge TYPES: {dict(type_counter)}")
    print(f"source camp of later inbound edges: {dict(src_camp_rel)}")
    tot = sum(src_camp_rel.values()) or 1
    print(f"  steelmanned-camp ADOPTION rate of its own steelman: "
          f"{src_camp_rel['from_steelmanned_camp']}/{tot} "
          f"({src_camp_rel['from_steelmanned_camp']/tot:.0%})")


if __name__ == "__main__":
    main()

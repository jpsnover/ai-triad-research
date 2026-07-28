"""Probe the real data shapes wasCruxAdjudicated relies on, before replicating it.
Crux node taxonomy_refs (set membership target) vs transcript entry taxonomy_refs (ref.node_id).
Read-only."""
import json, os

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
# one frozen-sample file with a known terminal-identified crux
FN, CID = "debate-400f834d-50c8-45f8-ba30-9936fb0e8b28", "AN-13"

d = json.load(open(os.path.join(DEB, FN + ".json"), encoding="utf-8"))

crux = next((c for c in (d.get("crux_tracker") or []) if c.get("id") == CID), None)
print("=== CRUX (crux_tracker) ===")
print("keys:", sorted(crux.keys()))
print("id:", crux.get("id"), "state:", crux.get("state"))
print("speakers_involved:", crux.get("speakers_involved"))
print("identified_turn:", crux.get("identified_turn"))

an = d.get("argument_network") or {}
nodes = an.get("nodes") or []
edges = an.get("edges") or []
print("\n=== ARGUMENT_NETWORK ===")
print("n_nodes:", len(nodes), "n_edges:", len(edges))
cnode = next((n for n in nodes if n.get("id") == CID), None)
print("crux node found in AN nodes?", cnode is not None)
if cnode is not None:
    print("crux node keys:", sorted(cnode.keys()))
    tr = cnode.get("taxonomy_refs")
    print("crux node taxonomy_refs TYPE:", type(tr).__name__, "sample:", (tr[:3] if isinstance(tr, list) else tr))

print("\n=== TRANSCRIPT ENTRY taxonomy_refs ===")
tx = d.get("transcript") or []
print("n_transcript:", len(tx))
speakers = {}
for t in tx:
    speakers[t.get("speaker")] = speakers.get(t.get("speaker"), 0) + 1
print("speaker counts:", speakers)
for t in tx:
    tr = t.get("taxonomy_refs")
    if isinstance(tr, list) and tr:
        print("entry speaker:", t.get("speaker"))
        print("  taxonomy_refs TYPE:", type(tr).__name__, "len:", len(tr))
        print("  first elem TYPE:", type(tr[0]).__name__, "value:", tr[0])
        break

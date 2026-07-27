"""Probe one debate session to locate crux structures and verdict fields. Read-only."""
import json, sys

p = r"C:/Users/jsnov/repos/ai-triad-data/debates/debate-59aae356-5c7c-4c13-907d-7a466acdce8d.json"
d = json.load(open(p, encoding="utf-8"))
print("TOP-LEVEL KEYS:", list(d.keys()))

def find_paths(obj, path="", hits=None, depth=0):
    if hits is None: hits = []
    if depth > 6: return hits
    if isinstance(obj, dict):
        for k, v in obj.items():
            kp = f"{path}.{k}"
            if any(t in k.lower() for t in ("crux", "resolution_status", "resolvability", "disagreement_type")):
                hits.append((kp, type(v).__name__, (len(v) if isinstance(v, (list, dict)) else v)))
            find_paths(v, kp, hits, depth+1)
    elif isinstance(obj, list) and obj:
        find_paths(obj[0], path+"[0]", hits, depth+1)
    return hits

for kp, t, meta in find_paths(d):
    print(f"  {kp}  ({t}, {meta})")

# Try to dump one crux object if we can find a crux list
def first_crux(obj, depth=0):
    if depth > 6: return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "crux" in k.lower() and isinstance(v, list) and v and isinstance(v[0], dict):
                return v[0]
            r = first_crux(v, depth+1)
            if r: return r
    elif isinstance(obj, list) and obj:
        return first_crux(obj[0], depth+1)
    return None

c = first_crux(d)
if c:
    print("\nSAMPLE CRUX OBJECT KEYS:", list(c.keys()))
    for k in ("id", "state", "resolution_status", "status", "resolvability"):
        if k in c:
            print(f"  {k} = {c[k]!r}")

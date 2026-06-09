import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
m = d["metadata"]
for k, v in m.items():
    print(f"  {k}: {v}")

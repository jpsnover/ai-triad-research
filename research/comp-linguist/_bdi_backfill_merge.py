#!/usr/bin/env python3
"""t/1306 merge: validate the 283 staged BDI decompositions, then (with --apply) back up and
merge into situations.json. Default is dry-run (validate + report convergence only)."""
import json, sys, shutil, collections
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SIT = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/situations.json"
STAGE = r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_bdi_backfill_staging.json"
APPLY = "--apply" in sys.argv
POVS = ['accelerationist', 'safetyist', 'skeptic']
FIELDS = ['belief', 'desire', 'intention']

stage = json.load(open(STAGE, encoding='utf-8'))
ok = {k: v for k, v in stage.items() if v.get('ok')}

# validate: schema complete + convergence check (are all 3 POVs identical on any field = sycophancy)
bad_schema, convergent = [], []
for k, v in ok.items():
    it = v['interpretations']
    complete = all(pov in it and all(it[pov].get(f, '').strip() for f in FIELDS) for pov in POVS)
    if not complete:
        bad_schema.append(k); continue
    for f in FIELDS:
        vals = [it[pov][f].strip() for pov in POVS]
        if len(set(vals)) < 3:  # two+ POVs identical on this field
            convergent.append((k, f)); break

print(f"staged ok: {len(ok)} | schema-incomplete: {len(bad_schema)} | convergent (sycophancy flag): {len(convergent)}")
if bad_schema: print("  schema-incomplete:", bad_schema[:10])
if convergent: print("  convergent:", convergent[:10])

if not APPLY:
    print("\nDRY RUN — no changes. Re-run with --apply to back up + merge.")
    sys.exit(0)

if bad_schema or convergent:
    print("\nABORT: fix flagged entries before applying."); sys.exit(1)

# backup + merge
shutil.copyfile(SIT, SIT + ".bak-t1306")
doc = json.load(open(SIT, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
merged = 0
for n in doc['nodes']:
    nid = str(n.get('id'))
    if nid in ok:
        it = ok[nid]['interpretations']
        n['interpretations'] = collections.OrderedDict(
            (pov, collections.OrderedDict((f, it[pov][f]) for f in FIELDS + ['summary'] if f in it[pov]))
            for pov in POVS)
        merged += 1
json.dump(doc, open(SIT, "w", encoding='utf-8'), indent=2, ensure_ascii=False)

# re-validate counts
reload = json.load(open(SIT, encoding='utf-8'))
def is_bdi(n):
    it = n.get('interpretations')
    return isinstance(it, dict) and all(isinstance(it.get(p), dict) and it[p].get('belief') for p in POVS)
def is_dep(n):
    return (n.get('description') or '').strip().upper().startswith('[DEPRECATED]')
tot = len(reload['nodes']); bdi = sum(1 for n in reload['nodes'] if is_bdi(n))
dep = sum(1 for n in reload['nodes'] if is_dep(n))
print(f"\nMERGED {merged} situations. Backup: {SIT}.bak-t1306")
print(f"situations now: {tot} total | {bdi} BDI-decomposed | {dep} deprecated | non-dep un-decomposed: {tot - bdi - dep}")

#!/usr/bin/env python3
"""t/3673 merge: 7 staged BDI decompositions → situations.json.
Default DRY-RUN: proves byte-identity serializer + 0-collateral structural asserts (TL points 2-5).
--apply: backup + merge (byte-identical json.dump), then re-verify on the written file.
"""
import json, sys, shutil, collections, copy
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SIT   = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/situations.json"
STAGE = r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t3673/staging.json"
FROZEN= r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t3673/frozen-ids.json"
APPLY = "--apply" in sys.argv
POVS  = ['accelerationist', 'safetyist', 'skeptic']
FIELDS= ['belief', 'desire', 'intention']

frozen = list(json.load(open(FROZEN, encoding='utf-8'))['ids'])
stage  = json.load(open(STAGE, encoding='utf-8'))
raw    = open(SIT, encoding='utf-8').read()
doc    = json.loads(raw, object_pairs_hook=collections.OrderedDict)

def fail(msg):
    print("ABORT:", msg); sys.exit(1)

# --- Frozen-set integrity: staging must cover exactly the frozen ids, all ok ---
staged_ok = {k for k, v in stage.items() if v.get('ok')}
if staged_ok != set(frozen):
    fail(f"staged-ok {sorted(staged_ok)} != frozen {sorted(frozen)}")

# --- 0-collateral serializer proof: json.dump(indent=2, ensure_ascii=False) must
#     round-trip the CURRENT file byte-for-byte on the UNCHANGED doc (modulo a single
#     trailing newline). If not, applying would reformat untouched nodes = collateral. ---
reser = json.dumps(doc, indent=2, ensure_ascii=False)
trailing_nl = raw.endswith("\n")
candidate = reser + ("\n" if trailing_nl else "")
if candidate != raw:
    # locate first divergence for diagnosis
    for i, (a, b) in enumerate(zip(candidate, raw)):
        if a != b:
            ctx = 40
            fail(f"serializer NOT byte-identical at char {i}: "
                 f"reser={candidate[i:i+ctx]!r} vs file={raw[i:i+ctx]!r} "
                 f"(len reser={len(candidate)} file={len(raw)})")
    fail(f"serializer length differs: reser={len(candidate)} file={len(raw)} (prefix matches)")
print(f"[OK] serializer byte-identical to current file (trailing_nl={trailing_nl}, {len(raw)} bytes)")

# --- Node/count invariants (TL point 4) ---
def is_dep(n): return str(n.get('description') or '').strip().upper().startswith('[DEPRECATED]')
total_before = len(doc['nodes'])
nondep_before = sum(1 for n in doc['nodes'] if not is_dep(n))
print(f"[OK] before: {total_before} total nodes, {nondep_before} non-deprecated")

# --- Build merged doc in a deep copy; replace ONLY interpretations on the frozen 7 ---
merged_doc = copy.deepcopy(doc)
changed_ids = []
for n in merged_doc['nodes']:
    nid = str(n.get('id'))
    if nid in staged_ok:
        it = stage[nid]['interpretations']
        n['interpretations'] = collections.OrderedDict(
            (pov, collections.OrderedDict(
                (f, it[pov][f]) for f in FIELDS + ['summary'] if f in it[pov]))
            for pov in POVS)
        changed_ids.append(nid)

# --- Structural asserts against the ORIGINAL doc (TL points 2,3,5) ---
if sorted(changed_ids) != sorted(frozen):
    fail(f"changed {sorted(changed_ids)} != frozen {sorted(frozen)}")
print(f"[OK] exactly {len(changed_ids)} nodes targeted, ids == frozen list")

if len(merged_doc['nodes']) != total_before:
    fail(f"node count changed {total_before} -> {len(merged_doc['nodes'])}")

orig_by_id = {str(n.get('id')): n for n in doc['nodes']}
diff_nodes = []
for i, mn in enumerate(merged_doc['nodes']):
    on = doc['nodes'][i]
    if str(mn.get('id')) != str(on.get('id')):
        fail(f"node ORDER changed at index {i}: {on.get('id')} -> {mn.get('id')}")
    if mn != on:
        diff_nodes.append(str(mn.get('id')))
        # everything except 'interpretations' must be byte-equal
        mk = {k: v for k, v in mn.items() if k != 'interpretations'}
        ok = {k: v for k, v in on.items() if k != 'interpretations'}
        if mk != ok:
            changed_keys = [k for k in set(mk) | set(ok) if mk.get(k) != ok.get(k)]
            fail(f"{mn.get('id')}: non-interpretations field changed: {changed_keys}")
if sorted(diff_nodes) != sorted(frozen):
    fail(f"nodes that DIFFER {sorted(diff_nodes)} != frozen {sorted(frozen)}")
print(f"[OK] on the 7, ONLY 'interpretations' differs; all other fields byte-identical; order preserved")

# --- Predicate check (TL point 5): non-empty B+D+I x 3 POV, no null-sentinels ---
SENT = {'null', 'none', 'n/a', 'tbd', '-'}
for nid in frozen:
    it = {n['id']: n for n in merged_doc['nodes']}[nid]['interpretations']
    for pov in POVS:
        for f in FIELDS:
            v = str(it[pov][f]).strip()
            if not v or v.lower() in SENT:
                fail(f"{nid}.{pov}.{f} empty/sentinel: {v!r}")
print(f"[OK] all 7 x 3 POV x (belief,desire,intention) non-empty, no null-sentinels")

# --- convergence / sycophancy guard (CL): 3 POVs must differ on each field ---
conv = []
for nid in frozen:
    it = {n['id']: n for n in merged_doc['nodes']}[nid]['interpretations']
    for f in FIELDS:
        vals = [str(it[p][f]).strip() for p in POVS]
        if len(set(vals)) < 3:
            conv.append((nid, f))
if conv:
    fail(f"cross-POV convergence (sycophancy): {conv}")
print(f"[OK] no cross-POV convergence on any field")

if not APPLY:
    print("\nDRY RUN — all asserts passed, no write. Re-run with --apply (after Electron quiesce).")
    sys.exit(0)

# ================= APPLY =================
shutil.copyfile(SIT, SIT + ".bak-t3673")
out = json.dumps(merged_doc, indent=2, ensure_ascii=False) + ("\n" if trailing_nl else "")
open(SIT, "w", encoding='utf-8', newline='').write(out)
print(f"\n[APPLIED] backup: {SIT}.bak-t3673")

# re-verify on the WRITTEN file
reload_raw = open(SIT, encoding='utf-8').read()
reload = json.loads(reload_raw)
tot = len(reload['nodes'])
def is_bdi(n):
    it = n.get('interpretations')
    return isinstance(it, dict) and all(
        isinstance(it.get(p), dict) and str(it[p].get('belief','')).strip()
        and str(it[p].get('desire','')).strip() and str(it[p].get('intention','')).strip()
        for p in POVS)
bdi = sum(1 for n in reload['nodes'] if is_bdi(n))
dep = sum(1 for n in reload['nodes'] if is_dep(n))
print(f"written file: {tot} total | {bdi} BDI-decomposed | {dep} deprecated | non-dep un-decomposed: {tot - bdi - dep}")

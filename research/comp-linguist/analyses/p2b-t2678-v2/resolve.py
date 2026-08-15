"""Resolution pass for Rule 5 (0 wrong links). Matches each gated variant_hint proposal by
exact/alias name against approved entities.json ∪ organizations.json. A proposal that matches an
existing referent is a LINK (correct only if it is the same real-world thing); an unmatched
high-confidence proposal is a curation candidate (designed behavior, not an error).
"""
import json, os

DATA = os.environ['AI_TRIAD_DATA_ROOT']
ORIGIN = os.path.join(DATA, 'taxonomy', 'Origin')
HERE = os.path.dirname(os.path.abspath(__file__))
GATE = 0.6

ent = json.load(open(os.path.join(ORIGIN, 'entities.json'), encoding='utf-8'))
org = json.load(open(os.path.join(ORIGIN, 'organizations.json'), encoding='utf-8'))


def names_from(obj, kind):
    """Yield (id, canonical_name, [aliases]) tuples, tolerant of schema shape."""
    rows = obj.get(kind) if isinstance(obj, dict) else obj
    if rows is None:
        # try common wrappers
        for k in ('data', 'entities', 'organizations', 'nodes', 'items'):
            if isinstance(obj, dict) and k in obj:
                rows = obj[k]
                break
    if isinstance(rows, dict):
        rows = list(rows.values())
    out = []
    for r in (rows or []):
        if not isinstance(r, dict):
            continue
        rid = r.get('id') or r.get('entity_id') or r.get('org_id') or r.get('name')
        nm = r.get('name') or r.get('canonical_name') or r.get('label') or ''
        al = r.get('aliases') or r.get('alt_names') or []
        if isinstance(al, str):
            al = [al]
        # approved only, if a status field exists
        status = (r.get('status') or r.get('approval_status') or 'approved')
        out.append((rid, nm, [a for a in al if isinstance(a, str)], status))
    return out


def index(rows):
    idx = {}
    for rid, nm, al, status in rows:
        for label in [nm] + al:
            if label:
                idx.setdefault(label.strip().lower(), (rid, nm, status))
    return idx


ent_rows = names_from(ent, 'entities')
org_rows = names_from(org, 'organizations')
ENT = index(ent_rows)
ORG = index(org_rows)
print(f'entities indexed: {len(ent_rows)} rows / {len(ENT)} labels; '
      f'orgs indexed: {len(org_rows)} rows / {len(ORG)} labels')

variant = json.load(open(os.path.join(HERE, 'run_variant_hint.json'), encoding='utf-8'))

print('\n=== gated variant_hint proposals — resolution ===')
links, candidates = 0, 0
for key, r in variant.items():
    for p in r.get('proposals', []):
        if float(p.get('confidence', 0)) < GATE:
            continue
        nm = p.get('name', '')
        lo = nm.strip().lower()
        hit_e = ENT.get(lo)
        hit_o = ORG.get(lo)
        if hit_e:
            links += 1
            print(f'  LINK(entity)  {nm!r} [{p.get("entity_type")}] -> {hit_e[0]} {hit_e[1]!r} ({hit_e[2]})')
        elif hit_o:
            links += 1
            print(f'  LINK(org)     {nm!r} [{p.get("entity_type")}] -> {hit_o[0]} {hit_o[1]!r} ({hit_o[2]})')
        else:
            candidates += 1
            print(f'  candidate     {nm!r} [{p.get("entity_type")}] c={p.get("confidence")}')
print(f'\nlinks: {links} | curation candidates: {candidates}')

"""G7 grounding reconciler (t/3160, TL ruling A). Hash-gated, idempotent, path-agnostic.

DISJOINT-SCOPE CONTRACT (TL condition 1): this reconciler OWNS the node-grounding family —
node.concept_refs, node.entity_refs, term.used_by_nodes, and the `node:*` containers of
entity_mentions.json. It NEVER writes `sei:*` containers (those stay with
Update-EntityMentionIndex.ps1, which after the handoff owns sei:* ONLY). A no-double-write
assertion enforces the split. Handoff sequencing (condition 2): this ships and writes node:*
BEFORE the PS cmdlet is reduced to drop node:*, so no node:* mention is ever orphaned.

Per changed node (text_sha256 over label+description+plain_description): resolve concept_refs
(surface->linked, embedding cosine>=0.55->proposed) + entity_refs (surface/alias->linked) and
the node:* mention record; used_by_nodes is DERIVED from the forward concept_refs (condition 4:
guarantees forward<->reverse consistency, which a union cannot). Removed nodes are purged from
ALL reverse maps incl. node:* mentions (condition 5).

Usage: --selftest (tests, no write) | --apply (write) | default dry-run summary.
       --nodes id1,id2,... : G8a scoped mode (t/3171) — re-resolve ONLY those node ids (the
       inline write-hook's dirty-set), leaving every other node's stored grounding untouched.
       used_by_nodes is still re-derived globally so forward<->reverse consistency holds under
       partial refresh; writes are bounded to touched POV files + changed dict files. Combine
       with --apply to persist. The CALLER MUST serialize this against Update-EntityMentionIndex
       (shared entity_mentions.json is a full read-merge-write; TL concurrency caveat t/3160#7).
"""
import json, re, os, glob, sys, hashlib
from datetime import datetime, timezone
import numpy as np

D = r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")
STD = os.path.join(D, "dictionary", "standardized")
MENTIONS = os.path.join(O, "entity_mentions.json")
SIDECAR = os.path.join(O, "grounding_index.json")
CON_TAU = 0.55
APPLY = "--apply" in sys.argv
SELFTEST = "--selftest" in sys.argv

def _arg(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None

# G8a scoped mode: --nodes id1,id2,... limits re-resolution to the caller's declared dirty-set.
# Guard against a following flag being swallowed as a value (e.g. `--nodes --apply`).
SCOPED = "--nodes" in sys.argv
SCOPED_IDS = [x.strip() for x in (_arg("--nodes") or "").split(",")
              if x.strip() and not x.strip().startswith("--")]

def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def node_text(n):
    parts = [n.get("label", ""), n.get("description", "")]
    if n.get("plain_description"):
        parts.append(n["plain_description"])
    return "\n".join(parts)

def word_span(surface, text_lower):
    m = re.search(r"\b" + re.escape(surface.lower()) + r"\b", text_lower)
    return m.start() if m else None

def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def dump_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

# ---------- load resolver inputs ----------
def load_terms():
    out = []
    for f in glob.glob(os.path.join(STD, "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        phrases = [p for p in ((d.get("characteristic_phrases") or []) + (d.get("translates_from_colloquial") or []))
                   if len(p.split()) >= 2 and len(p) > 5]
        out.append({"cf": d["canonical_form"], "phrases": phrases, "file": f})
    return out

def load_entities():
    with open(os.path.join(O, "entities.json"), encoding="utf-8") as f:
        store = json.load(f)
    out = []
    for e in store["entities"]:
        if e.get("status") != "approved":
            continue
        surfs = [("exact", e["name"])]
        al = e.get("aliases")
        if isinstance(al, list): surfs += [("alias", a) for a in al]
        elif isinstance(al, str) and al: surfs.append(("alias", al))
        out.append((e["id"], [(m, s) for m, s in surfs if s and len(s) > 2]))
    return out

def load_situations():
    """Situation nodes (sit-*) own node:sit-* mention containers (TL ruling: all node:* is
    node-grounding). Text = concatenated interpretation belief/desire/intention across POVs."""
    p = os.path.join(O, "situations.json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        raw = json.load(f)
    out = []
    for s in raw.get("nodes", []):
        parts = []
        for v in (s.get("interpretations") or {}).values():
            if isinstance(v, dict):
                parts += [str(v[k]) for k in ("belief", "desire", "intention") if v.get(k)]
            elif isinstance(v, str) and v:
                parts.append(v)
        text = "\n".join(parts)
        if text.strip():
            out.append((s["id"], text))
    return out

def entity_mentions_for(text, low, ents):
    mentions = []
    for eid, surfs in ents:
        hit = next(((meth, s, word_span(s, low)) for meth, s in surfs if word_span(s, low) is not None), None)
        if hit:
            meth, s, off = hit
            mentions.append({"entity_ref": eid, "quote": text[off:off + len(s)], "offset": off, "discovered_by": meth})
    return mentions

def load_vectors():
    emb = json.load(open(os.path.join(O, "embeddings.json"), encoding="utf-8")).get("nodes", {})
    nv = {}
    for nid, e in emb.items():
        v = e.get("vector") or e.get("embedding")
        if v:
            a = np.array(v, dtype=np.float64); nv[nid] = a / (np.linalg.norm(a) + 1e-9)
    sense = json.load(open(os.path.join(STD.replace("standardized", "sense_embeddings.json")), encoding="utf-8")).get("entries", {}) \
        if os.path.exists(STD.replace("standardized", "sense_embeddings.json")) else {}
    return nv, sense

# ---------- resolve one node ----------
def resolve(n, terms, ents, nv, sense):
    txt = node_text(n); low = txt.lower()
    crefs = []
    surfaced = set()
    for t in terms:
        m = next((ph for ph in t["phrases"] if word_span(ph, low) is not None), None)
        if m:
            crefs.append({"ref": "term:" + t["cf"], "surface": m, "method": "surface", "link_confidence": 1.0, "status": "linked"})
            surfaced.add(t["cf"])
    # embedding-proposed concepts (not already surface-linked)
    vec = nv.get(n["id"])
    if vec is not None and sense:
        for t in terms:
            if t["cf"] in surfaced or t["cf"] not in sense:
                continue
            sv = np.array(sense[t["cf"]]["embedding"], dtype=np.float64); sv = sv / (np.linalg.norm(sv) + 1e-9)
            cos = float(vec @ sv)
            if cos >= CON_TAU:
                crefs.append({"ref": "term:" + t["cf"], "surface": "", "method": "embedding", "link_confidence": round(cos, 4), "status": "proposed"})
    erefs, mentions = [], []
    for eid, surfs in ents:
        hit = next(((meth, s, word_span(s, low)) for meth, s in surfs if word_span(s, low) is not None), None)
        if hit:
            meth, s, off = hit
            erefs.append({"ref": eid, "surface": s, "method": meth, "link_confidence": 1.0, "match_level": "exact", "status": "linked"})
            mentions.append({"entity_ref": eid, "quote": txt[off:off + len(s)], "offset": off, "discovered_by": meth})
    return crefs, erefs, mentions

# ---------- core reconcile (in-memory) ----------
def reconcile(pov_data, mentions_store, sidecar, terms, ents, nv, sense, situations=()):
    """Mutates pov_data nodes + mentions_store node:* + returns stats. Pure over inputs.
    `situations` = [(sit_id, text)] whose node:sit-* entity-mention containers are also owned here
    (TL ruling: all node:* is node-grounding). Situation forward concept_refs/entity_refs await a
    situation-schema field and are out of scope for this pass."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    current_ids = set()
    changed = skipped = 0
    for data in pov_data.values():
        for n in data["nodes"]:
            if not n.get("description"):
                continue
            nid = n["id"]; current_ids.add(nid)
            h = sha(node_text(n))
            if sidecar.get(nid) == h:
                skipped += 1; continue
            crefs, erefs, mentions = resolve(n, terms, ents, nv, sense)
            if crefs: n["concept_refs"] = crefs
            elif "concept_refs" in n: del n["concept_refs"]
            if erefs: n["entity_refs"] = erefs
            elif "entity_refs" in n: del n["entity_refs"]
            key = "node:" + nid
            if mentions:
                mentions_store["containers"][key] = {"text_sha256": h, "extracted_at": now, "mentions": mentions}
            elif key in mentions_store["containers"]:
                del mentions_store["containers"][key]
            sidecar[nid] = h; changed += 1
    # situations (sit-*): own their node:sit-* entity-mention containers (TL ruling)
    for sid, stext in situations:
        current_ids.add(sid)
        h = sha(stext)
        if sidecar.get(sid) == h:
            skipped += 1; continue
        mentions = entity_mentions_for(stext, stext.lower(), ents)
        key = "node:" + sid
        if mentions:
            mentions_store["containers"][key] = {"text_sha256": h, "extracted_at": now, "mentions": mentions}
        elif key in mentions_store["containers"]:
            del mentions_store["containers"][key]
        sidecar[sid] = h; changed += 1
    # purge removed nodes from ALL reverse maps (condition 5)
    removed = [nid for nid in list(sidecar) if nid not in current_ids]
    for nid in removed:
        del sidecar[nid]
        mentions_store["containers"].pop("node:" + nid, None)
    # derive used_by_nodes from forward concept_refs (condition 4)
    by_term = {}
    for data in pov_data.values():
        for n in data["nodes"]:
            for r in (n.get("concept_refs") or []):
                by_term.setdefault(r["ref"][len("term:"):], set()).add(n["id"])
    return {"changed": changed, "skipped": skipped, "removed": len(removed)}, by_term

# ---------- scoped reconcile (G8a inline entry point, t/3171) ----------
def reconcile_scoped(pov_data, mentions_store, sidecar, dirty_ids, terms, ents, nv, sense, situations=()):
    """Re-resolve ONLY nodes whose id is in `dirty_ids` (the PUT's changed set); every other node's
    stored grounding is left untouched. used_by_nodes is STILL re-derived globally from the current
    forward concept_refs (dirty nodes freshly resolved, all others as-stored) so the forward<->reverse
    consistency invariant (condition 4) holds under partial refresh. A dirty id absent from the current
    taxonomy+situations is a removal and is purged from ALL reverse maps (condition 5). Non-dirty nodes
    whose text changed are intentionally NOT re-resolved here — the caller declares the dirty-set and the
    scheduled full sweep (G8b) is the backstop. Returns (stats, by_term, touched_povs).

    The hash-gate still applies within the dirty-set (a dirty id whose text is unchanged is skipped), so
    this stays idempotent. Same disjoint-scope contract as reconcile(): sei:*/summary:* are never written.
    Caller MUST serialize against Update-EntityMentionIndex (shared-file read-merge-write; TL #7)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dirty = set(dirty_ids)
    sit_map = dict(situations)
    current_ids = {n["id"] for data in pov_data.values() for n in data["nodes"]} | set(sit_map)
    changed = skipped = removed = 0
    touched_povs = set()
    for pov_name, data in pov_data.items():
        for n in data["nodes"]:
            nid = n["id"]
            if nid not in dirty or not n.get("description"):
                continue
            h = sha(node_text(n))
            if sidecar.get(nid) == h:
                skipped += 1; continue
            crefs, erefs, mentions = resolve(n, terms, ents, nv, sense)
            if crefs: n["concept_refs"] = crefs
            elif "concept_refs" in n: del n["concept_refs"]
            if erefs: n["entity_refs"] = erefs
            elif "entity_refs" in n: del n["entity_refs"]
            key = "node:" + nid
            if mentions:
                mentions_store["containers"][key] = {"text_sha256": h, "extracted_at": now, "mentions": mentions}
            elif key in mentions_store["containers"]:
                del mentions_store["containers"][key]
            sidecar[nid] = h; changed += 1; touched_povs.add(pov_name)
    # dirty situations (sit-*): own node:sit-* containers
    for sid in dirty:
        if sid not in sit_map:
            continue
        stext = sit_map[sid]
        h = sha(stext)
        if sidecar.get(sid) == h:
            skipped += 1; continue
        mentions = entity_mentions_for(stext, stext.lower(), ents)
        key = "node:" + sid
        if mentions:
            mentions_store["containers"][key] = {"text_sha256": h, "extracted_at": now, "mentions": mentions}
        elif key in mentions_store["containers"]:
            del mentions_store["containers"][key]
        sidecar[sid] = h; changed += 1
    # removal-purge: dirty ids no longer present in taxonomy+situations (condition 5), scoped to the dirty-set
    for nid in dirty:
        if nid not in current_ids:
            if nid in sidecar:
                del sidecar[nid]; removed += 1
            mentions_store["containers"].pop("node:" + nid, None)
    # derive used_by_nodes GLOBALLY from current forward concept_refs (condition 4 holds under partial refresh)
    by_term = {}
    for data in pov_data.values():
        for n in data["nodes"]:
            for r in (n.get("concept_refs") or []):
                by_term.setdefault(r["ref"][len("term:"):], set()).add(n["id"])
    return {"changed": changed, "skipped": skipped, "removed": removed}, by_term, touched_povs

# ---------- selftest ----------
def selftest():
    terms, ents = load_terms(), load_entities()
    nv, sense = load_vectors()
    sit = load_situations()
    pov = {p: load_json(os.path.join(O, p + ".json")) for p in ("accelerationist", "safetyist", "skeptic")}
    ms = {"containers": {}}
    for c, v in load_json(MENTIONS).get("containers", {}).items():
        ms["containers"][c] = v
    sc = {}
    sei_before = {k for k in ms["containers"] if k.startswith("sei:")}
    summary_before = {k for k in ms["containers"] if k.startswith("summary:")}
    # run 1 (cold): everything changes
    s1, ubn = reconcile(pov, ms, sc, terms, ents, nv, sense, sit)
    # SITUATION coverage: node:sit-* containers are owned + written here
    assert any(k.startswith("node:sit") for k in ms["containers"]), "FAIL: no node:sit-* container written"
    # CONSISTENCY (load-bearing): used_by_nodes == {nodes whose concept_refs include term}
    fwd = {}
    for data in pov.values():
        for n in data["nodes"]:
            for r in (n.get("concept_refs") or []):
                fwd.setdefault(r["ref"][len("term:"):], set()).add(n["id"])
    assert fwd == {k: v for k, v in ubn.items()}, "FAIL: forward<->reverse mismatch"
    # DISJOINT: sei:* untouched
    sei_after = {k for k in ms["containers"] if k.startswith("sei:")}
    assert sei_before == sei_after, "FAIL: sei:* containers modified (double-write)"
    assert {k for k in ms["containers"] if k.startswith("summary:")} == summary_before, "FAIL: summary:* containers modified (double-write; PS owns sei:*+summary:*)"
    # IDEMPOTENCE: run 2 (warm) with same sidecar -> 0 changed
    s2, _ = reconcile(pov, ms, sc, terms, ents, nv, sense, sit)
    assert s2["changed"] == 0, f"FAIL: not idempotent, {s2['changed']} changed on warm run"
    # CHANGE-DETECTION: edit one node -> only it re-resolves
    tgt = pov["accelerationist"]["nodes"][0]; tgt["description"] = (tgt.get("description") or "") + " strict liability regime."
    s3, _ = reconcile(pov, ms, sc, terms, ents, nv, sense, sit)
    assert s3["changed"] == 1, f"FAIL: change-detection re-resolved {s3['changed']} nodes, expected 1"
    # REMOVAL-PURGE: drop a node -> purged from mentions + sidecar
    victim = pov["safetyist"]["nodes"][0]["id"]
    pov["safetyist"]["nodes"] = pov["safetyist"]["nodes"][1:]
    s4, ubn4 = reconcile(pov, ms, sc, terms, ents, nv, sense, sit)
    assert victim not in sc, "FAIL: removed node still in sidecar"
    assert ("node:" + victim) not in ms["containers"], "FAIL: removed node still has node:* mention"
    assert all(victim not in v for v in ubn4.values()), "FAIL: removed node still in used_by_nodes"
    # SCOPED (G8a, t/3171): re-resolve only the dirty-set; non-dirty nodes preserved; consistency holds
    pov2 = {p: load_json(os.path.join(O, p + ".json")) for p in ("accelerationist", "safetyist", "skeptic")}
    ms2 = {"containers": dict(load_json(MENTIONS).get("containers", {}))}
    sc2 = {}
    reconcile(pov2, ms2, sc2, terms, ents, nv, sense, sit)  # cold baseline: full refs + sidecar
    a, b = pov2["accelerationist"]["nodes"][0], pov2["accelerationist"]["nodes"][1]
    bump = " adaptive governance oversight, strict liability regime."
    a["description"] = (a.get("description") or "") + bump
    b["description"] = (b.get("description") or "") + bump  # b edited too but NOT in the scoped set
    b_refs_before = b.get("concept_refs")
    ssc, sub, touched = reconcile_scoped(pov2, ms2, sc2, [a["id"]], terms, ents, nv, sense, sit)
    assert ssc["changed"] == 1, f"FAIL: scoped re-resolved {ssc['changed']} nodes, expected 1"
    assert b.get("concept_refs") == b_refs_before, "FAIL: scoped run mutated a non-dirty node's refs"
    assert touched == {"accelerationist"}, f"FAIL: scoped touched_povs {touched}, expected {{accelerationist}}"
    fwd2 = {}
    for data in pov2.values():
        for n in data["nodes"]:
            for r in (n.get("concept_refs") or []):
                fwd2.setdefault(r["ref"][len("term:"):], set()).add(n["id"])
    assert fwd2 == {k: v for k, v in sub.items()}, "FAIL: scoped forward<->reverse mismatch"
    assert {k for k in ms2["containers"] if k.startswith("sei:")} == sei_before, "FAIL: scoped touched sei:*"
    assert {k for k in ms2["containers"] if k.startswith("summary:")} == summary_before, "FAIL: scoped touched summary:*"
    # SCOPED removal: a dirty id absent from taxonomy is purged; a re-run over unchanged dirty-set = 0 changed
    ssc2, _, _ = reconcile_scoped(pov2, ms2, sc2, [a["id"]], terms, ents, nv, sense, sit)
    assert ssc2["changed"] == 0, f"FAIL: scoped not idempotent, {ssc2['changed']} changed on re-run"
    print("SELFTEST PASS: consistency, disjoint-scope, idempotence, change-detection, removal-purge, scoped")
    print(f"  cold run: {s1}   used_by_nodes terms: {len(ubn)}")

if SELFTEST:
    selftest(); sys.exit(0)

# ---------- dry-run / apply over live data ----------
terms, ents = load_terms(), load_entities()
nv, sense = load_vectors()
sit = load_situations()
pov = {p: load_json(os.path.join(O, p + ".json")) for p in ("accelerationist", "safetyist", "skeptic")}
ms = load_json(MENTIONS)
sc = load_json(SIDECAR) if os.path.exists(SIDECAR) else {}
if SCOPED:
    # G8a scoped mode (t/3171): re-resolve only the dirty-set; bound writes to touched POV + changed dict files.
    # Presence of --nodes forces scoped mode; an empty/malformed id list is a safe no-op, NEVER a full apply.
    stats, ubn, touched = reconcile_scoped(pov, ms, sc, SCOPED_IDS, terms, ents, nv, sense, sit)
    print(json.dumps(stats, indent=2))
    print(f"scoped nodes: {len(SCOPED_IDS)}  touched POVs: {sorted(touched)}  used_by_nodes terms: {len(ubn)}")
    if APPLY:
        for p in touched:
            dump_json(os.path.join(O, p + ".json"), pov[p])
        dict_writes = 0
        for t in terms:
            d = load_json(t["file"])
            new = sorted(ubn.get(t["cf"], set()))
            if d.get("used_by_nodes") != new:  # write only terms whose reverse-set actually changed
                d["used_by_nodes"] = new
                dump_json(t["file"], d)
                dict_writes += 1
        dump_json(MENTIONS, ms)
        dump_json(SIDECAR, sc)
        print(f"APPLIED (scoped): {len(touched)} POV file(s), {dict_writes} dict file(s)")
    else:
        print("DRY RUN (scoped)")
else:
    stats, ubn = reconcile(pov, ms, sc, terms, ents, nv, sense, sit)
    print(json.dumps(stats, indent=2))
    print(f"used_by_nodes terms: {len(ubn)}  total node-links: {sum(len(v) for v in ubn.values())}")
    if APPLY:
        for p, data in pov.items():
            dump_json(os.path.join(O, p + ".json"), data)
        # write used_by_nodes into standardized files
        for t in terms:
            d = load_json(t["file"])
            d["used_by_nodes"] = sorted(ubn.get(t["cf"], set()))
            dump_json(t["file"], d)
        dump_json(MENTIONS, ms)
        dump_json(SIDECAR, sc)
        print("APPLIED")
    else:
        print("DRY RUN")

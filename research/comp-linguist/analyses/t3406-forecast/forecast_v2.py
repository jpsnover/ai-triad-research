#!/usr/bin/env python3
"""t/3406 forecast metric v2 (READ-ONLY, valence-aware). Fixes the v1 topical-inflation caveat:
match anticipated_challenges against ATOMIC opponent ATTACK moves only (AN nodes that stand in an
'attacks' edge targeting one of the debater's own AN nodes), not raw sentences. Now blindside_rate
is properly computable. Embeddings all-MiniLM-L6-v2; outputs hit/blindside at tau + eyeball examples."""
import json, glob, os, re, sys
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
from sentence_transformers import SentenceTransformer
DATA = r"C:\Users\jsnov\repos\ai-triad-data"

def speaker_from_prompt(p):
    m = re.search(r"You are (Safetyist|Accelerationist|Skeptic)", p or "", re.I)
    return m.group(1).lower() if m else None

def challenges_by_speaker(s):
    out = {}
    ents = (s.get("diagnostics") or {}).get("entries") or {}
    it = ents.items() if isinstance(ents, dict) else enumerate(ents)
    for _, ent in it:
        sp = speaker_from_prompt(ent.get("prompt", ""))
        if not sp:
            continue
        for stage in (ent.get("stage_diagnostics") or []):
            wp = stage.get("work_product") or {}
            ac = wp.get("anticipated_challenges")
            if ac:
                out.setdefault(sp, []).extend([c for c in ac if isinstance(c, str)])
    return out

def opponent_attacks(s):
    """Return {debater_speaker: [attack_texts...]} = atomic opponent claims that ATTACK that debater's nodes."""
    an = s.get("argument_network") or (s.get("session") or {}).get("argument_network")
    if not an:
        return {}
    nodes = {n["id"]: n for n in an.get("nodes", []) if n.get("id")}
    res = {}
    for ed in an.get("edges", []):
        if ed.get("type") != "attacks":
            continue
        src = nodes.get(ed.get("source")); tgt = nodes.get(ed.get("target"))
        if not src or not tgt:
            continue
        atk_sp = (src.get("speaker") or "").lower()
        def_sp = (tgt.get("speaker") or "").lower()
        if atk_sp and def_sp and atk_sp != def_sp and src.get("text"):
            res.setdefault(def_sp, []).append(src["text"])
    return res

fs = [f for f in sorted(glob.glob(os.path.join(DATA, "debates", "debate-*.json"))) if "undefined" not in f][-60:]
print("loading model..."); model = SentenceTransformer("all-MiniLM-L6-v2")
THRS = [0.60]
hit = {t: [] for t in THRS}; blind = {t: [] for t in THRS}
examples = []; n_used = 0
for f in fs:
    try: s = json.load(open(f, encoding="utf-8"))
    except: continue
    chs = challenges_by_speaker(s); atks = opponent_attacks(s)
    if not chs or not atks: continue
    used = False
    for sp, clist in chs.items():
        alist = atks.get(sp, [])
        if not clist or not alist: continue
        used = True
        ce = model.encode(clist, normalize_embeddings=True)
        ae = model.encode(alist, normalize_embeddings=True)
        sims = ce @ ae.T
        ch_best = sims.max(axis=1); atk_best = sims.max(axis=0)
        for t in THRS:
            hit[t].append(float((ch_best >= t).mean()))          # of my forecasts, frac that matched a real opp attack
            blind[t].append(float((atk_best < t).mean()))          # of real opp attacks, frac I did NOT foresee
        if len(examples) < 10:
            j = int(ch_best.argmax())
            examples.append((round(float(ch_best[j]), 2), clist[j][:130], alist[int(sims[j].argmax())][:130]))
    if used: n_used += 1

print(f"\ndebates used (had both challenges + AN attacks): {n_used}")
print(f"opponent-attack counts/debater-side: mean={np.mean([len(atks.get(sp,[])) for f in [] for sp in []]) if False else ''}")
for t in THRS:
    if hit[t]:
        print(f"  tau>={t}: hit_rate mean={np.mean(hit[t]):.3f}  blindside_rate mean={np.mean(blind[t]):.3f}  (n_sides={len(hit[t])})")
print("\n=== EXAMPLE matches (cosine | anticipated_challenge | matched opponent ATTACK claim) — eyeball valence now ===")
for c, a, o in sorted(examples, reverse=True):
    print(f"[{c}] CH : {a}")
    print(f"      ATK: {o}")

#!/usr/bin/env python3
"""t/3406 pre/post-t3404 payoff read (READ-ONLY). Reuses v2's atomic-attack matching
(calibrated tau=0.60, t/3406#6). Splits debates by presence of ATTACK:/ASSUMPTION: tags
in anticipated_challenges (the t/3404 tagging signal); for post-t3404 debates, filters
the matchable set to ATTACK:-tagged challenges only (per the original design)."""
import json, glob, os, re, sys
import numpy as np
sys.path.insert(0, r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\analyses\t3406-forecast")
from forecast_v2 import speaker_from_prompt, opponent_attacks
from sentence_transformers import SentenceTransformer

DATA = r"C:\Users\jsnov\repos\ai-triad-data"
TAU = 0.60

def challenges_by_speaker_tagged(s):
    """Return {speaker: (all_raw_challenges, attack_tagged_challenges, is_tagged_run)}."""
    out = {}
    any_tag = False
    ents = (s.get("diagnostics") or {}).get("entries") or {}
    it = ents.items() if isinstance(ents, dict) else enumerate(ents)
    for _, ent in it:
        sp = speaker_from_prompt(ent.get("prompt", ""))
        if not sp:
            continue
        for stage in (ent.get("stage_diagnostics") or []):
            wp = stage.get("work_product") or {}
            ac = wp.get("anticipated_challenges")
            if not ac:
                continue
            for c in ac:
                if not isinstance(c, str):
                    continue
                raw, atk = out.setdefault(sp, ([], []))
                raw.append(c)
                if re.match(r"^\s*ATTACK\s*:", c, re.I):
                    atk.append(re.sub(r"^\s*ATTACK\s*:\s*", "", c, flags=re.I))
                    any_tag = True
                elif re.match(r"^\s*ASSUMPTION\s*:", c, re.I):
                    any_tag = True
    return out, any_tag

fs = [f for f in sorted(glob.glob(os.path.join(DATA, "debates", "debate-*.json"))) if "undefined" not in f]
print(f"scanning {len(fs)} debate files...")
print("loading model..."); model = SentenceTransformer("all-MiniLM-L6-v2")

groups = {"pre": {"hit": [], "blind": []}, "post": {"hit": [], "blind": []}}
n_pre_sides = n_post_sides = n_pre_debates = n_post_debates = 0
examples_post = []

for f in fs:
    try:
        s = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    chs, tagged = challenges_by_speaker_tagged(s)
    atks = opponent_attacks(s)
    if not chs or not atks:
        continue
    used_this_debate = False
    for sp, (raw, atk_only) in chs.items():
        alist = atks.get(sp, [])
        if not alist:
            continue
        clist = atk_only if tagged else raw   # post: ATTACK-tagged only; pre: all raw (no tag info available)
        if not clist:
            continue
        used_this_debate = True
        ce = model.encode(clist, normalize_embeddings=True)
        ae = model.encode(alist, normalize_embeddings=True)
        sims = ce @ ae.T
        ch_best = sims.max(axis=1)
        atk_best = sims.max(axis=0)
        grp = "post" if tagged else "pre"
        groups[grp]["hit"].append(float((ch_best >= TAU).mean()))
        groups[grp]["blind"].append(float((atk_best < TAU).mean()))
        if grp == "post":
            n_post_sides += 1
            if len(examples_post) < 6:
                j = int(ch_best.argmax())
                examples_post.append((round(float(ch_best[j]), 2), clist[j][:120], alist[int(sims[j].argmax())][:120]))
        else:
            n_pre_sides += 1
    if used_this_debate:
        if tagged: n_post_debates += 1
        else: n_pre_debates += 1

print(f"\ndebates used: pre={n_pre_debates} post={n_post_debates}")
print(f"debater-sides: pre={n_pre_sides} post={n_post_sides}")
for grp in ("pre", "post"):
    h, b = groups[grp]["hit"], groups[grp]["blind"]
    if h:
        print(f"  {grp:4}: hit_rate mean={np.mean(h):.3f} (sd={np.std(h):.3f})  blindside_rate mean={np.mean(b):.3f} (sd={np.std(b):.3f})  n={len(h)}")
    else:
        print(f"  {grp:4}: NO DATA")

if groups["pre"]["hit"] and groups["post"]["hit"]:
    try:
        from scipy import stats
        tstat, p = stats.ttest_ind(groups["post"]["hit"], groups["pre"]["hit"], equal_var=False)
        print(f"\nWelch t-test (post vs pre hit_rate): t={tstat:.2f} p={p:.4f}")
    except ImportError:
        print("\n(scipy not available — no significance test; compare means/sd above)")

print("\n=== POST-t3404 example matches (cosine | ATTACK-tagged challenge | matched opponent attack) ===")
for c, a, o in sorted(examples_post, reverse=True):
    print(f"[{c}] CH : {a}")
    print(f"      ATK: {o}")

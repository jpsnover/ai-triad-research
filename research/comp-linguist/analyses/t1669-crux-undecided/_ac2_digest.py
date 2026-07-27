"""t/1669 AC#2 calibration read (v2, content-anchored).
Transcript entries carry no turn_number, so we anchor by CONTENT: for each frozen-sample
crux we score every non-system turn by distinctive-term overlap with the crux proposition and
surface the top engaging turns per camp. The CL judgment per crux: was the crux PROPOSITION
adversarially adjudicated by >=2 opposing camps (=> `undecided` is a FALSE label), or only
asserted/echoed/topically-adjacent (=> genuinely un-adjudicated => `undecided` correct)?"""
import json, os, re

DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
OUT = r"C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t1669-crux-undecided/ac2-digests.txt"

SAMPLE = [
    ("debate-04167ebc-7c5d-489e-b82f-c1b5dd4a5dd5","AN-12"),("debate-0b5dee92-4837-4bff-bd20-206aeef9b118","AN-24"),
    ("debate-1418ee11-5641-4033-a400-c26c9f5e4f45","AN-29"),("debate-1685da89-0e7b-432b-8827-fc927200dbd5","AN-35"),
    ("debate-1be82941-4020-478a-b334-64bb5c23e015","AN-13"),("debate-1ffff43a-4aff-4f58-b126-f020de713f8a","AN-29"),
    ("debate-3210eb8a-e4a4-4421-8150-56a06fc4aaed","AN-14"),("debate-396208e0-60d6-4d60-a9e4-3af6b4cf9501","AN-66"),
    ("debate-39d97d44-0a48-4da6-87d7-80a1763e6db0","AN-51"),("debate-400f834d-50c8-45f8-ba30-9936fb0e8b28","AN-13"),
    ("debate-4c766822-edf7-43a1-b27b-413c554d6efd","D-1"),("debate-57c14a81-9e4a-45d6-91d4-db23b61bdb86","AN-18"),
    ("debate-5c33db20-2135-4360-b269-e61d7ad8d89f","AN-15"),("debate-5ff58b8b-8097-402c-bd32-6e0573f7e022","AN-10"),
    ("debate-6502276d-8247-40b0-8f37-44342ea5a339","AN-11"),("debate-7490d9c2-74d3-4e6d-8064-d15d8f821f11","AN-11"),
    ("debate-835bff57-5a78-454e-b263-2e51fc3e1832","AN-8"),("debate-9152a7fd-d477-44d3-a5e1-29fa06943ba4","AN-44"),
    ("debate-9dccfcbe-14d8-46d2-b363-6b2962fbe5c7","AN-2"),("debate-a0eaaca9-3732-43f6-b386-44d049c065d1","AN-62"),
    ("debate-aa493447-2b1a-42b8-93cd-5f64f982e86b","AN-1"),("debate-ad01203f-b1db-4425-8682-32fb2dd4f41a","AN-5"),
    ("debate-bd1d6c61-83ea-4029-9efd-1444c5cb1975","AN-22"),("debate-c4fe24f0-f967-4378-baa6-a845c4d768fc","AN-8"),
    ("debate-cbf5bb79-b02b-47af-9e4a-d1baa79373b0","AN-1"),("debate-cff6b797-64fb-447c-b738-b5b67b0ede37","AN-26"),
    ("debate-d6a1b446-8e05-4873-8422-3a16763a3b7d","AN-25"),("debate-eb21ef39-614d-43f9-91c0-be2ed00a5df8","AN-23"),
    ("debate-f2a29ea0-b7a3-4b93-8ece-85b8ae8e9ad4","AN-22"),("debate-f9c54c70-dfc3-4255-b125-0c49da39c519","AN-9"),
]
STOP = set("the a an and or of to in for on with by is are be as that this it its from at into their our we not".split())

def terms(txt):
    return {w for w in re.findall(r"[a-z]{5,}", (txt or "").lower()) if w not in STOP}

def content(t):
    c = t.get("content", "")
    if isinstance(c, dict): c = c.get("text") or c.get("content") or ""
    return str(c)

out = []
for fname, cid in SAMPLE:
    try:
        d = json.load(open(os.path.join(DEB, fname + ".json"), encoding="utf-8"))
    except Exception as e:
        out.append(f"### {fname} {cid}\n  ERROR {e}\n"); continue
    crux = next((c for c in (d.get("crux_tracker") or []) if c.get("id") == cid), None)
    if not crux:
        out.append(f"### {fname} {cid}\n  CRUX NOT FOUND\n"); continue
    desc = crux.get("description", "")
    ct = terms(desc)
    scored = []
    for t in (d.get("transcript") or []):
        spk = (t.get("speaker") or "").lower()
        if spk in ("system", "moderator", "document", ""): continue
        txt = content(t)
        ov = len(ct & terms(txt))
        if ov > 0:
            scored.append((ov, spk, txt))
    scored.sort(key=lambda x: -x[0])
    camps = sorted({s for _, s, _ in scored[:6]})
    seg = [f"### {fname}  {cid}",
           f"  CRUX: {desc[:220]}",
           f"  engaging camps (top turns): {camps}   surfaced_turn={crux.get('identified_turn')}"]
    for ov, spk, txt in scored[:5]:
        # pull the sentence(s) around the densest term hit for a focused snippet
        seg.append(f"    [{spk} ov={ov}] {txt[:300].strip()}")
    out.append("\n".join(seg) + "\n")

open(OUT, "w", encoding="utf-8").write("\n".join(out))
print(f"wrote {len(SAMPLE)} content-anchored digests -> {OUT}")
print(f"chars: {sum(len(s) for s in out)}")

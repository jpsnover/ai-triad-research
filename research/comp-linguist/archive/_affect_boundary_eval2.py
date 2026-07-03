#!/usr/bin/env python3
"""t/1249 pass 2: compare 3 matchers — substring (current), strict \bterm\b, and
suffix-aware \bterm(s|es|ing|ed)?\b — to find the one that removes fragment FPs
without dropping legitimate inflections. Reports the recalibration delta."""
import json, os, re, glob, sys
from collections import Counter, defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
TS = r"C:/Users/jsnov/repos/ai-triad-research/lib/debate/affectSignals.ts"
DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
MIN_WORDS = 20

src = open(TS, encoding='utf-8').read()
block = re.search(r'AFFECT_LEXICONS[^{]*\{(.*?)\n\};', src, re.S).group(1)
LEX = {m.group(1): re.findall(r"'([^']*)'", m.group(2))
       for m in re.finditer(r'(\w+):\s*\[(.*?)\]', block, re.S)}
SAT = {m.group(1): float(m.group(2)) for m in re.finditer(r'(\w+):\s*([\d.]+),', re.search(r'AFFECT_SATURATION_RATE[^{]*\{(.*?)\}', src, re.S).group(1))}

def mk(term, mode):
    e = re.escape(term)
    if mode == 'strict': return re.compile(r'\b' + e + r'\b')
    if mode == 'suffix': return re.compile(r'\b' + e + r'(s|es|ing|ed)?\b')
RX = {mode: {cat: [(t, mk(t, mode)) for t in LEX[cat]] for cat in LEX} for mode in ('strict', 'suffix')}

texts = []
for f in glob.glob(os.path.join(DEB, 'debate-*.json')):
    try: d = json.load(open(f, encoding='utf-8'))
    except Exception: continue
    for e in d.get('transcript', []):
        if e.get('type') in ('statement', 'opening') and e.get('speaker') not in ('system', 'moderator'):
            c = e.get('content')
            if isinstance(c, str) and len(c.split()) >= MIN_WORDS:
                texts.append((c.lower(), max(1, len(c.split()))))

def cat_score(txt, wc, cat, mode):
    if mode == 'substr': hits = sum(1 for t in LEX[cat] if t in txt)
    else: hits = sum(1 for t, rx in RX[mode][cat] if rx.search(txt))
    return min(1.0, (hits / wc) * 100 / SAT[cat])

print(f"corpus {len(texts)} statements\n")
print(f"{'category':10} {'meanScore substr':>16} {'strict':>10} {'suffix':>10}  {'suffix Δ vs substr':>18}")
for cat in LEX:
    ms = sum(cat_score(t, w, cat, 'substr') for t, w in texts) / len(texts)
    mst = sum(cat_score(t, w, cat, 'strict') for t, w in texts) / len(texts)
    msf = sum(cat_score(t, w, cat, 'suffix') for t, w in texts) / len(texts)
    print(f"{cat:10} {ms:>16.4f} {mst:>10.4f} {msf:>10.4f}  {msf-ms:>+17.4f}")

# fragment FPs the SUFFIX matcher still removes vs substring, and legit inflections it KEEPS vs strict
print("\n=== terms suffix-matcher removes vs substring (true fragment FPs eliminated) ===")
for cat in LEX:
    fp = Counter()
    for txt, _ in texts:
        for t, rx in RX['suffix'][cat]:
            if t in txt and not rx.search(txt): fp[t] += 1
    top = fp.most_common(5)
    if top: print(f"  {cat}: " + ", ".join(f"'{t}'×{n}" for t, n in top))
print("\n=== inflections suffix KEEPS that strict would drop (why not naive \\bterm\\b) ===")
for cat in LEX:
    keep = Counter()
    for txt, _ in texts:
        for t, rxs in RX['strict'][cat]:
            rxf = dict(RX['suffix'][cat])[t]
            if rxf.search(txt) and not rxs.search(txt): keep[t] += 1
    top = keep.most_common(5)
    if top: print(f"  {cat}: " + ", ".join(f"'{t}'×{n}" for t, n in top))

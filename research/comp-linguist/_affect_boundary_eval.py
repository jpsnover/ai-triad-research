#!/usr/bin/env python3
"""t/1249: quantify affect lexicon false-positives — substring includes() vs word-boundary matching,
over real speaker statements. Parses AFFECT_LEXICONS from source to stay faithful."""
import json, os, re, glob, sys
from collections import Counter, defaultdict
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TS = r"C:/Users/jsnov/repos/ai-triad-research/lib/debate/affectSignals.ts"
DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
MIN_WORDS = 20

# ── parse AFFECT_LEXICONS from the TS source ──
src = open(TS, encoding='utf-8').read()
block = re.search(r'AFFECT_LEXICONS[^{]*\{(.*?)\n\};', src, re.S).group(1)
LEX = {}
for m in re.finditer(r'(\w+):\s*\[(.*?)\]', block, re.S):
    cat = m.group(1)
    terms = re.findall(r"'([^']*)'", m.group(2))
    LEX[cat] = terms
print("parsed lexicon sizes:", {k: len(v) for k, v in LEX.items()})

# precompile word-boundary regexes
WB = {cat: [(t, re.compile(r'\b' + re.escape(t) + r'\b')) for t in terms] for cat, terms in LEX.items()}

# ── gather speaker statements ──
texts = []
for f in glob.glob(os.path.join(DEB, 'debate-*.json')):
    try:
        d = json.load(open(f, encoding='utf-8'))
    except Exception:
        continue
    for e in d.get('transcript', []):
        if e.get('type') not in ('statement', 'opening'):
            continue
        if e.get('speaker') in ('system', 'moderator'):
            continue
        c = e.get('content')
        if isinstance(c, str) and len(c.split()) >= MIN_WORDS:
            texts.append(c.lower())
print(f"corpus: {len(texts)} speaker statements")

# ── compare matchers ──
sub_hits = Counter()      # total substring hits per category
wb_hits = Counter()       # total word-boundary hits per category
frag_examples = defaultdict(Counter)  # (cat) -> Counter of substring-only terms (fragment FPs)
stmts_changed = Counter()  # statements whose category hit-count changes

for txt in texts:
    for cat in LEX:
        s = sum(1 for t in LEX[cat] if t in txt)
        w = sum(1 for t, rx in WB[cat] if rx.search(txt))
        sub_hits[cat] += s
        wb_hits[cat] += w
        if s != w:
            stmts_changed[cat] += 1
        # which terms are substring-only (fragment false positives)
        for t, rx in WB[cat]:
            if t in txt and not rx.search(txt):
                frag_examples[cat][t] += 1

print("\n=== substring vs word-boundary total hits per category ===")
print(f"{'category':10} {'substr':>8} {'wordbnd':>8} {'inflation':>10} {'stmts_changed':>14}")
for cat in LEX:
    infl = (sub_hits[cat] - wb_hits[cat]) / sub_hits[cat] * 100 if sub_hits[cat] else 0
    print(f"{cat:10} {sub_hits[cat]:>8} {wb_hits[cat]:>8} {infl:>9.1f}% {stmts_changed[cat]:>14}")

print("\n=== top fragment false-positive terms (substring-only matches) per category ===")
for cat in LEX:
    top = frag_examples[cat].most_common(6)
    if top:
        print(f"  {cat}: " + ", ".join(f"'{t}'×{n}" for t, n in top))
    else:
        print(f"  {cat}: (none)")

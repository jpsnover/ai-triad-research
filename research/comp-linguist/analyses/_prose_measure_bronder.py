import re, sys

path = r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\analyses\bronder-2026-instrument-effects-relevance.md"
text = open(path, encoding="utf-8").read()

# Strip code blocks, tables, frontmatter-ish header lines from scan where noted.
# For counts we scan the prose body. Tables (lines starting with |) are exempt.
lines = text.splitlines()
prose_lines = [l for l in lines if not l.strip().startswith("|")]
prose = "\n".join(prose_lines)

def count(pat, s=prose, flags=0):
    return len(re.findall(pat, s, flags=flags))

sentences = re.split(r"(?<=[.!?])\s+", prose)
n_sent = len([s for s in sentences if s.strip()])

results = {
    "em_dashes (thr 0)": count(r"—"),
    "colon_hinge (thr <5% of sentences)": count(r"[a-z]: [a-z]"),
    "formulaic_transitions (thr 0)": count(r"\b(Furthermore|Moreover|Ultimately|Additionally|In conclusion)\b") + count(r"(?m)^However\b"),
    "bureaucratic (thr 0)": count(r"\b(robust|holistic|leverag\w+|utiliz\w+|stakeholder\w*|facilitate\w*)\b"),
    "empty_intensifiers (thr <=1)": count(r"\b(fundamentally|deeply|crucially|critically|truly|very)\b"),
    "emphasis_tics (thr <=1)": count(r"\b(precisely|exactly|specifically)\b"),
    "meta_assertions (thr 0)": count(r"(important to note|worth noting|stated plainly|a candor note|needs scoping|must be read|it should be emphasized)"),
    "antithesis (thr <=2)": count(r"is not \w[^.;]*; it is") + count(r"not \w[^,]*, but"),
    "sentence_count": n_sent,
}
for k, v in results.items():
    print(f"{k}: {v}")
print(f"colon_hinge % = {results['colon_hinge (thr <5% of sentences)']/max(n_sent,1)*100:.1f}%")

import re, sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    text = f.read()

# Strip code blocks, tables, frontmatter-ish bold-label lines for essay-prose checks
lines = text.splitlines()
prose_lines = []
in_code = False
for ln in lines:
    if ln.strip().startswith("```"):
        in_code = not in_code
        continue
    if in_code:
        continue
    if ln.lstrip().startswith("|"):   # table
        continue
    prose_lines.append(ln)
prose = "\n".join(prose_lines)

# sentence split (rough)
sentences = re.split(r"(?<=[.!?])\s+", prose)
sentences = [s for s in sentences if s.strip()]

def count(pat, s, flags=0):
    return len(re.findall(pat, s, flags))

results = {}
results["em_dashes"] = count(r"—", text)
# colon-hinge: [a-z]: [a-z], exclude bold-label lines and list intros
hinge = 0
hinge_ex = []
for s in sentences:
    for m in re.finditer(r"[a-z]: [a-z]", s):
        # exempt if the colon follows a **bold label** or line starts with '- **'
        hinge += 1
        hinge_ex.append(s.strip()[:80])
results["colon_hinge_raw"] = hinge
results["colon_hinge_pct"] = round(100*hinge/len(sentences), 1)
results["n_sentences"] = len(sentences)
results["formulaic_trans"] = count(r"\b(Furthermore|Moreover|Ultimately|Additionally|In conclusion)\b", prose)
results["however_initial"] = count(r"(^|\n)\s*However\b", prose)
results["bureaucratic"] = count(r"\b(robust|holistic|leverag\w+|utiliz\w+|stakeholder\w*|facilitate\w*)\b", prose)
results["intensifiers"] = count(r"\b(fundamentally|deeply|crucially|critically|truly|very)\b", prose)
results["emphasis_tics"] = count(r"\b(precisely|exactly|specifically)\b", prose)
results["meta_assert"] = count(r"important to note|worth noting|stated plainly|a candor note|needs scoping|must be read|it should be emphasized", prose)
results["antithesis"] = count(r"is not \w+; it is|not \w+, but", prose)

for k, v in results.items():
    print(f"{k}: {v}")

if hinge:
    print("--- colon-hinge instances ---")
    for h in hinge_ex:
        print("  ", h)

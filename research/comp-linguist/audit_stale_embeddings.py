"""
Audit script: Find POV taxonomy nodes with stale or missing synthetic phrases,
attribution_text, search_text, and embeddings.

Staleness heuristic for attribution_text:
  Extract distinctive content words (non-stopwords, length >= 5) from description.
  If < 40% of the top-20 distinctive description words appear anywhere in
  attribution_text, flag as SUSPECTED_STALE.
  (Close paraphrases naturally share most domain vocabulary; a mismatch
   indicates the description was substantially rewritten after attribution_text
   was generated.)
"""

import json
import re
from pathlib import Path
from collections import Counter

DATA_ROOT = Path("C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin")
POV_FILES = ["accelerationist.json", "safetyist.json", "skeptic.json"]
EMBEDDINGS_FILE = DATA_ROOT / "embeddings.json"

# ── stop-word list (minimal, domain-aware) ──────────────────────────────────
STOPWORDS = {
    "a","an","the","and","or","of","in","to","for","with","that","this",
    "is","are","be","been","been","being","was","were","has","have","had",
    "it","its","at","by","on","as","from","into","through","within","which",
    "not","no","nor","but","also","both","each","their","they","them","these",
    "those","such","more","most","other","when","where","while","than","then",
    "about","above","across","after","against","along","among","around",
    "because","before","between","during","over","under","upon","within","without",
    "would","could","should","may","might","must","shall","will","can","do","does",
    "did","use","used","using","all","any","some","one","two","three","four","five",
    "every","only","even","much","many","own","new","first","second","third",
    "make","made","making","based","related","known","given","include","including",
    "provide","provides","provided","require","requires","required","ensure",
    "ensures","ensured","allow","allows","allowed","across","towards","toward",
    "position","positions","approach","approaches","thus","thereby","therefore",
    "however","whether","rather","further","although","whereas","whereby",
    "within","without","between","beyond","through","throughout","although",
}

def extract_content_words(text: str, top_n: int = 20) -> list[str]:
    """Return top_n most-frequent content words (lowercase, len>=5, non-stop)."""
    words = re.findall(r"[a-z]{5,}", text.lower())
    filtered = [w for w in words if w not in STOPWORDS]
    counts = Counter(filtered)
    return [w for w, _ in counts.most_common(top_n)]

def stale_ratio(desc_words: list[str], attr_text: str) -> float:
    """Fraction of description's top content words present in attribution_text."""
    if not desc_words:
        return 1.0
    attr_lower = attr_text.lower()
    hits = sum(1 for w in desc_words if w in attr_lower)
    return hits / len(desc_words)

def run_audit():
    # Load embeddings index (just the set of IDs present)
    emb_data = json.loads(EMBEDDINGS_FILE.read_text(encoding="utf-8"))
    embedding_ids = set(emb_data.get("nodes", {}).keys())

    results = []  # list of dicts: id, label, pov, issues[]

    for pov_file in POV_FILES:
        pov_path = DATA_ROOT / pov_file
        pov_name = pov_file.replace(".json", "")
        data = json.loads(pov_path.read_text(encoding="utf-8"))
        nodes = data.get("nodes", [])

        for node in nodes:
            node_id = node.get("id", "")
            label = node.get("label", "")
            description = node.get("description", "")
            debate_refs = node.get("debate_refs") or []
            has_debate_refs = bool(debate_refs)

            ga = node.get("graph_attributes") or {}
            attribution_text = ga.get("attribution_text", "")
            synthetic_phrases = ga.get("synthetic_phrases")
            search_text = ga.get("search_text", "")

            issues = []

            # 1. Missing attribution_text
            if not attribution_text:
                issues.append("NO_ATTRIBUTION_TEXT")

            # 2. Missing synthetic_phrases (always missing — only flag if node
            #    also has attribution_text, i.e. it's in the "enriched" set,
            #    OR if it has debate_refs, i.e. it was debate-modified)
            if not synthetic_phrases:
                if attribution_text or has_debate_refs:
                    issues.append("NO_SYNTHETIC_PHRASES")

            # 3. Missing search_text (flag same scope as synthetic_phrases)
            if not search_text:
                if attribution_text or has_debate_refs:
                    issues.append("NO_SEARCH_TEXT")

            # 4. Stale attribution_text — only checkable when both fields exist
            if attribution_text and description:
                desc_words = extract_content_words(description, top_n=20)
                ratio = stale_ratio(desc_words, attribution_text)
                if ratio < 0.40:
                    issues.append(
                        f"SUSPECTED_STALE_ATTRIBUTION (overlap={ratio:.0%}, "
                        f"desc_words={desc_words[:8]})"
                    )

            # 5. Missing embedding
            if node_id not in embedding_ids:
                issues.append("NO_EMBEDDING")

            if issues:
                results.append({
                    "id": node_id,
                    "label": label,
                    "pov": pov_name,
                    "debate_refs": len(debate_refs),
                    "has_attribution_text": bool(attribution_text),
                    "has_synthetic_phrases": bool(synthetic_phrases),
                    "has_search_text": bool(search_text),
                    "issues": issues,
                })

    return results

def main():
    results = run_audit()

    # Summarise
    total = len(results)
    issue_counts: Counter = Counter()
    for r in results:
        for iss in r["issues"]:
            # Normalise the stale key for counting
            key = iss.split(" ")[0]
            issue_counts[key] += 1

    print(f"TOTAL FLAGGED NODES: {total}\n")
    print("ISSUE SUMMARY:")
    for issue, count in issue_counts.most_common():
        print(f"  {issue}: {count}")
    print()

    # Group output by issue category for readability
    # Show NO_EMBEDDING nodes first (most actionable)
    # Then NO_ATTRIBUTION_TEXT nodes with debate_refs (debate-modified but unenriched)
    # Then nodes with attribution_text but NO_SYNTHETIC_PHRASES
    # Then STALE nodes

    sections = [
        ("NO_EMBEDDING", "Nodes missing from embeddings.json"),
        ("SUSPECTED_STALE_ATTRIBUTION", "Nodes with suspected stale attribution_text"),
        ("NO_ATTRIBUTION_TEXT", "Nodes with debate_refs but no attribution_text"),
        ("NO_SYNTHETIC_PHRASES", "Nodes with attribution_text but no synthetic_phrases"),
        ("NO_SEARCH_TEXT", "Nodes with attribution_text but no search_text"),
    ]

    for issue_key, section_title in sections:
        matching = [
            r for r in results
            if any(iss.startswith(issue_key) for iss in r["issues"])
        ]
        if not matching:
            continue

        print(f"{'='*70}")
        print(f"{section_title} ({len(matching)} nodes)")
        print(f"{'='*70}")

        # For NO_ATTRIBUTION_TEXT, only show debate-ref nodes (not the whole corpus)
        if issue_key == "NO_ATTRIBUTION_TEXT":
            debate_subset = [r for r in matching if r["debate_refs"] > 0]
            no_debate = len(matching) - len(debate_subset)
            if no_debate:
                print(f"  (+ {no_debate} non-debate nodes also lack attribution_text — omitted for brevity)")
            matching = debate_subset

        for r in matching:
            relevant_issues = [i for i in r["issues"] if i.startswith(issue_key)]
            detail = relevant_issues[0] if len(relevant_issues[0]) > len(issue_key) else ""
            print(f"  {r['id']:<30}  [{r['pov']}]  {r['label']}")
            if detail and detail != issue_key:
                print(f"    {detail}")
        print()

if __name__ == "__main__":
    main()

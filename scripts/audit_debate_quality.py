#!/usr/bin/env python3

"""
audit_debate_quality.py — Compare pre-vocabulary and post-vocabulary debate sessions.

Loads debate session transcripts and compares vocabulary usage patterns,
term consistency, and disambiguation quality between sessions run before
and after the vocabulary system was introduced.

Usage:
    python scripts/audit_debate_quality.py [--data-root PATH] [--sessions-dir PATH] [--output PATH]
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent


def _resolve_data_root(override=None):
    if override:
        return Path(override).resolve()
    config_path = _SCRIPT_DIR.parent / ".aitriad.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            data_root = cfg.get("data_root", ".")
            base = Path(data_root) if Path(data_root).is_absolute() else (_SCRIPT_DIR.parent / data_root)
            return base.resolve()
        except (json.JSONDecodeError, OSError):
            pass
    return _SCRIPT_DIR.parent.resolve()


def load_colloquial_terms(dict_dir: Path) -> dict[str, dict]:
    """Load all colloquial terms and their resolution rules."""
    terms = {}
    col_dir = dict_dir / "colloquial"
    if col_dir.exists():
        for f in col_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                terms[data["colloquial_term"]] = data
            except (json.JSONDecodeError, KeyError):
                pass
    return terms


def load_standardized_terms(dict_dir: Path) -> dict[str, dict]:
    """Load all standardized terms."""
    terms = {}
    std_dir = dict_dir / "standardized"
    if std_dir.exists():
        for f in std_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                terms[data["canonical_form"]] = data
            except (json.JSONDecodeError, KeyError):
                pass
    return terms


def extract_text_from_session(session: dict) -> str:
    """Extract all text content from a debate session."""
    parts = []
    # Transcript entries (primary format)
    for entry in session.get("transcript", []):
        if isinstance(entry, dict) and entry.get("content"):
            parts.append(str(entry["content"]))
    # Turns (alternative format)
    for turn in session.get("turns", []):
        if isinstance(turn, dict):
            for field in ["content", "text", "message", "statement"]:
                if field in turn and turn[field]:
                    parts.append(str(turn[field]))
    # Opening statements (alternative format)
    if "opening_statements" in session:
        for stmt in session["opening_statements"].values():
            if isinstance(stmt, str):
                parts.append(stmt)
            elif isinstance(stmt, dict) and "text" in stmt:
                parts.append(stmt["text"])
    # Synthesis
    if "synthesis" in session:
        syn = session["synthesis"]
        if isinstance(syn, str):
            parts.append(syn)
        elif isinstance(syn, dict):
            for field in ["text", "content", "summary"]:
                if field in syn:
                    parts.append(str(syn[field]))
    # Topic text
    topic = session.get("topic", {})
    if isinstance(topic, dict):
        for field in ["original", "final"]:
            if topic.get(field):
                parts.append(str(topic[field]))
    return "\n".join(parts)


def count_bare_colloquial_usage(text: str, colloquial_terms: dict[str, dict]) -> dict[str, int]:
    """Count bare colloquial term usage in text."""
    counts = {}
    for term in colloquial_terms:
        pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
        matches = pattern.findall(text)
        if matches:
            counts[term] = len(matches)
    return counts


def count_standardized_usage(text: str, standardized_terms: dict[str, dict]) -> dict[str, int]:
    """Count standardized term usage (canonical or display form) in text."""
    counts = {}
    for canonical, term in standardized_terms.items():
        display = term.get("display_form", "")
        pattern_canonical = re.compile(rf"\b{re.escape(canonical)}\b", re.IGNORECASE)
        pattern_display = re.compile(re.escape(display), re.IGNORECASE) if display else None

        total = len(pattern_canonical.findall(text))
        if pattern_display:
            total += len(pattern_display.findall(text))
        if total > 0:
            counts[canonical] = total
    return counts


def analyze_session(session: dict, colloquial_terms: dict, standardized_terms: dict) -> dict:
    """Analyze a single debate session for vocabulary quality."""
    text = extract_text_from_session(session)
    word_count = len(text.split())

    bare_usage = count_bare_colloquial_usage(text, colloquial_terms)
    std_usage = count_standardized_usage(text, standardized_terms)

    total_bare = sum(bare_usage.values())
    total_std = sum(std_usage.values())
    total_vocab = total_bare + total_std

    standardization_rate = total_std / total_vocab if total_vocab > 0 else 0.0

    # Check for disambiguation — cases where a bare term co-occurs with its standardized form
    disambiguation_signals = []
    for bare_term, col_data in colloquial_terms.items():
        if bare_term not in bare_usage:
            continue
        for resolution in col_data.get("resolves_to", []):
            std_term = resolution["standardized_term"]
            if std_term in std_usage:
                disambiguation_signals.append({
                    "colloquial": bare_term,
                    "standardized": std_term,
                    "bare_count": bare_usage[bare_term],
                    "standardized_count": std_usage[std_term],
                })

    return {
        "session_id": session.get("id", session.get("session_id", "unknown")),
        "topic": session.get("topic", session.get("title", "unknown")),
        "word_count": word_count,
        "bare_colloquial_usage": bare_usage,
        "standardized_usage": std_usage,
        "total_bare": total_bare,
        "total_standardized": total_std,
        "standardization_rate": round(standardization_rate, 3),
        "disambiguation_signals": disambiguation_signals,
        "unique_bare_terms": len(bare_usage),
        "unique_standardized_terms": len(std_usage),
    }


def main():
    parser = argparse.ArgumentParser(description="Audit debate vocabulary quality")
    parser.add_argument("--data-root", help="Override data root directory")
    parser.add_argument("--sessions-dir", help="Directory containing debate session JSON files")
    parser.add_argument("--output", help="Output path for audit results")
    args = parser.parse_args()

    data_root = _resolve_data_root(args.data_root)
    dict_dir = data_root / "dictionary"
    sessions_dir = Path(args.sessions_dir) if args.sessions_dir else data_root / "debates"
    output_path = Path(args.output) if args.output else dict_dir / "debate_audit_results.json"

    print(f"Data root: {data_root}", file=sys.stderr)
    print(f"Sessions dir: {sessions_dir}", file=sys.stderr)

    colloquial_terms = load_colloquial_terms(dict_dir)
    standardized_terms = load_standardized_terms(dict_dir)
    print(f"Loaded {len(colloquial_terms)} colloquial, {len(standardized_terms)} standardized terms", file=sys.stderr)

    if not sessions_dir.exists():
        print(f"No sessions directory at {sessions_dir}", file=sys.stderr)
        print("Creating empty audit report.", file=sys.stderr)
        results = {
            "generated_at": datetime.now().isoformat(),
            "note": "No debate sessions found. Run debates and re-run this script.",
            "sessions_analyzed": 0,
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"Wrote {output_path}", file=sys.stderr)
        return

    session_files = sorted(sessions_dir.glob("*.json"))
    print(f"Found {len(session_files)} session files", file=sys.stderr)

    analyses = []
    for sf in session_files:
        try:
            session = json.loads(sf.read_text(encoding="utf-8"))
            analysis = analyze_session(session, colloquial_terms, standardized_terms)
            analysis["file"] = sf.name
            analyses.append(analysis)
        except (json.JSONDecodeError, OSError) as e:
            print(f"WARNING: Skipping {sf.name}: {e}", file=sys.stderr)

    # Sort by standardization rate to identify pre/post vocabulary
    analyses.sort(key=lambda a: a["standardization_rate"])

    # Aggregate stats
    total_sessions = len(analyses)
    avg_standardization = (
        sum(a["standardization_rate"] for a in analyses) / total_sessions
        if total_sessions > 0 else 0.0
    )
    avg_bare = sum(a["total_bare"] for a in analyses) / total_sessions if total_sessions > 0 else 0.0
    avg_std = sum(a["total_standardized"] for a in analyses) / total_sessions if total_sessions > 0 else 0.0

    most_common_bare = defaultdict(int)
    for a in analyses:
        for term, count in a["bare_colloquial_usage"].items():
            most_common_bare[term] += count

    results = {
        "generated_at": datetime.now().isoformat(),
        "sessions_analyzed": total_sessions,
        "aggregate": {
            "avg_standardization_rate": round(avg_standardization, 3),
            "avg_bare_per_session": round(avg_bare, 1),
            "avg_standardized_per_session": round(avg_std, 1),
            "most_common_bare_terms": dict(sorted(most_common_bare.items(), key=lambda x: -x[1])[:10]),
        },
        "sessions": analyses,
        "review_instructions": (
            "Compare sessions with low standardization_rate (likely pre-vocabulary) against "
            "those with high rates (post-vocabulary). Check: (1) Are standardized terms used correctly? "
            "(2) Do debates surface more precise disagreements with vocabulary? "
            "(3) Has readability changed? Hand-review at least 10 sessions."
        ),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote audit results to {output_path}", file=sys.stderr)

    print(f"\n{'='*60}", file=sys.stderr)
    print("DEBATE AUDIT SUMMARY", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"Sessions analyzed: {total_sessions}", file=sys.stderr)
    print(f"Avg standardization rate: {avg_standardization:.1%}", file=sys.stderr)
    print(f"Avg bare terms/session: {avg_bare:.1f}", file=sys.stderr)
    print(f"Avg standardized terms/session: {avg_std:.1f}", file=sys.stderr)
    if most_common_bare:
        print(f"\nMost common bare terms:", file=sys.stderr)
        for term, count in sorted(most_common_bare.items(), key=lambda x: -x[1])[:5]:
            print(f"  {term}: {count}", file=sys.stderr)


if __name__ == "__main__":
    main()

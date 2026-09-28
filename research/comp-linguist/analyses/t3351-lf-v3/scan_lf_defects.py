#!/usr/bin/env python3
"""Deterministic clear-defect scan for node `logical_form` frames (t/3351).

Reproduces the two clear-defect classes the t/3239 v2 promotion left as a residual
(~4.2%, 27/641). The 27 were NOT enumerated in any committed file — the scan code did
not survive — so this tool re-adds it as a durable, committed instrument: the defect
count is now reproducible from the live corpus instead of living only in one analysis.

Two classes (both deterministic, no LLM):

  A. STANCE-VERB PREDICATE — `predicate` is one of the stance/reporting verbs the prompt's
     MANDATORY PREDICATE SELF-CHECK (logical-form-formalization.prompt, the {...} set) bans:
     the stance is already carried in modality, so a stance verb as predicate duplicates it.
     NOTE: `hold`/`report` have legitimate CONTENT senses (hold-liable, mandated-disclosure
     report-to-body) — flagged separately as `borderline` so a fix cannot silently over-strip
     them (t/3351 v3 design).

  B. DISCOURSE-AS-AGENT — an args[] entry whose ref names a meta-descriptive collective
     ("<camp> discourse", "the discourse", "the document", "the view") as an AGENT. The prompt
     bans this; the residual comes from the description's literal "…within <camp> discourse
     that…" wrapper (v3 strips it at source in formalize_node_lf.py).

Run:  python scan_lf_defects.py            # scans the live corpus, prints counts + ids
      python scan_lf_defects.py --json OUT # also writes the id lists
"""
import argparse, json, os, re, sys, collections

sys.stdout.reconfigure(encoding="utf-8")
DATA = os.environ.get("AI_TRIAD_DATA_ROOT", r"C:\Users\jsnov\repos\ai-triad-data")
ORIGIN = os.path.join(DATA, "taxonomy", "Origin")
POV_FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")

# The stance/reporting verbs banned as predicates by the prompt's MANDATORY PREDICATE
# SELF-CHECK. Kept in sync with logical-form-formalization.prompt (the {...} set on the
# self-check line); if that list changes, update here and note it in the ticket.
BAN_STANCE = frozenset({
    "support", "oppose", "reject", "advocate", "endorse", "favor", "call", "believe",
    "think", "hold", "want", "desire", "aim", "seek", "intend", "view", "prioritize",
    "value", "prefer", "promote", "champion", "emphasize", "stress", "recognize",
    "acknowledge", "address", "discuss", "highlight", "report", "note", "argue", "claim",
    "assert", "maintain", "contend", "reflect", "align", "frame", "position", "consider",
})
# Banned verbs that ALSO have a legitimate content sense — flag as borderline so a v3 fix
# does not over-strip them (t/3351 v3 design: hold-liable / mandated report-to-body are content).
BORDERLINE = frozenset({"hold", "report"})

# Meta-descriptive collectives that must never be an args[] AGENT (prompt ban).
DISCOURSE_AGENT_RE = re.compile(r"\b(discourse|the document|the view)\b", re.IGNORECASE)


def norm_pred(p):
    """Lower + strip a trailing inflection so 'maintains'/'prioritizes' match the base ban form."""
    p = (p or "").strip().lower()
    for suf in ("es", "s", "ed", "ing"):
        if p.endswith(suf) and len(p) - len(suf) >= 3:
            return p[: -len(suf)]
    return p


def _iter_frames(from_json):
    """Yield (node_id, logical_form) from the live corpus, or from a formalize_node_lf.py
    --out file ({"all"|"sample": {id: lf}}) when --from-json is given (dry-run re-scan)."""
    if from_json:
        blob = json.load(open(from_json, encoding="utf-8"))
        frames = blob.get("all") or blob.get("sample") or {}
        for nid, lf in frames.items():
            yield nid, lf
    else:
        for fn in POV_FILES:
            doc = json.load(open(os.path.join(ORIGIN, fn), encoding="utf-8"))
            for n in doc["nodes"]:
                yield n["id"], n.get("logical_form")


def scan(from_json=""):
    stance, stance_borderline, discourse = [], [], []
    total = 0
    for nid, lf in _iter_frames(from_json):
        if not isinstance(lf, dict) or not lf.get("predicate"):
            continue
        total += 1
        pred_raw = lf["predicate"].strip().lower()
        pred = norm_pred(pred_raw)
        if pred_raw in BAN_STANCE or pred in BAN_STANCE:
            (stance_borderline if (pred_raw in BORDERLINE or pred in BORDERLINE) else stance).append(
                {"id": nid, "predicate": lf["predicate"]})
        for a in (lf.get("args") or []):
            # A meta-collective ("<camp> discourse" / "the document" / "the view") is
            # never a valid arg entity in ANY role (the prompt bans it as an agent; it is
            # nonsensical as a patient/topic too). Flag on any role, record which.
            ref = a.get("ref", "")
            if isinstance(ref, str) and DISCOURSE_AGENT_RE.search(ref):
                discourse.append({"id": nid, "role": a.get("role"), "ref": ref})
                break
    return {"total_formalized": total, "stance_pure": stance,
            "stance_borderline": stance_borderline, "discourse_as_agent": discourse}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="", help="write the id lists to this path")
    ap.add_argument("--from-json", default="", dest="from_json",
                    help="scan a formalize_node_lf.py --out file (dry-run re-scan) instead of the live corpus")
    args = ap.parse_args()
    r = scan(args.from_json)
    npure, nbord, ndisc = len(r["stance_pure"]), len(r["stance_borderline"]), len(r["discourse_as_agent"])
    print(f"formalized frames scanned: {r['total_formalized']}")
    print(f"CLASS A stance-verb predicate: {npure + nbord}  (pure {npure} + borderline {nbord})")
    for x in r["stance_pure"]:
        print(f"  [pure]       {x['id']}  predicate={x['predicate']!r}")
    for x in r["stance_borderline"]:
        print(f"  [borderline] {x['id']}  predicate={x['predicate']!r}  (may be legitimate content)")
    print(f"CLASS B discourse-as-agent: {ndisc}")
    for x in r["discourse_as_agent"]:
        print(f"  {x['id']}  agent-ref={x['ref']!r}")
    print(f"\nTOTAL clear-defects: {npure + nbord + ndisc}  (of {r['total_formalized']} = "
          f"{(npure + nbord + ndisc) / max(1, r['total_formalized']):.1%})")
    if args.json:
        json.dump(r, open(args.json, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Deterministic clear-defect scan for node `logical_form` frames (t/3351).

Reproduces the two clear-defect classes the t/3239 v2 promotion left as a residual
(~4.2%, 27/641). The 27 were NOT enumerated in any committed file — the scan code did
not survive — so this tool re-adds it as a durable, committed instrument: the defect
count is now reproducible from the live corpus instead of living only in one analysis.

Two classes (both deterministic, no LLM):

  A. STANCE LEAK (role-based, t/3883) — the predicate carries the ATTRIBUTING CAMP's attitude
     instead of the proposition's content. Candidates are predicates on the prompt's ban list
     (logical-form-formalization.prompt, the {...} set), but the ban list alone is a LEXEME test:
     most hits use the verb as content ("AI will *seek* power", "mandates *favor* incumbents");
     1 in 14 on the live corpus was a real leak. A candidate is a leak only if it IS the
     description's ATTRIBUTING VERB -- "A Desire within X discourse that *prioritizes* ..." ->
     predicate `prioritize`: the model took the camp's attitude as the event.
     A second clause ("the verb is not grounded anywhere in the proposition text") was tried and
     DROPPED: its only motivating case turned out to be a different defect (skp-beliefs-232), so it
     had no positive, and it has a known false-positive mode (a ban-list synonym paraphrasing the
     content, e.g. `seek` for "pursue"). Imported reporting verbs are therefore NOT detected here.
     The lexeme buckets (stance_pure / stance_borderline) are still emitted for continuity, but
     CLASS A is now the role-based count.
     Provenance: designed and checked against the same small labeled set (labeled-stance-set.json,
     single annotator, 1 positive) -- in-sample, NOT a validated precision. See t/3883.

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


_WRAP = re.compile(r"^An?\s+(?:Belief|Desire|Intention)\s+within\s+.+?\s+discourse\s+that\s+(\w+)", re.IGNORECASE)


def _wrapper_verb(desc):
    """The attributing verb right after '<cat> within <camp> discourse that' (None if the description
    has no wrapper, or the next word is not that clause's verb -- e.g. 'that AI developers should')."""
    m = _WRAP.match(desc or "")
    return m.group(1).lower() if m else None


def _is_wrapper_verb(pred, wverb):
    # 'prioritizes' / 'advocates' / 'argues' -> base form + a short inflectional suffix
    return bool(wverb) and wverb.startswith(pred) and len(wverb) - len(pred) <= 3


def stance_verdict(pred, label, desc):
    """Return (is_leak, reason) for a ban-list candidate. `label` is accepted for interface stability
    (the formalizer's proposition is label + description) but the test reads only the wrapper."""
    if _is_wrapper_verb(pred, _wrapper_verb(desc)):
        return True, "attributing-verb"
    return False, "content-use"


def _node_text():
    """id -> (label, description) for every POV node (the proposition text the formalizer was given)."""
    out = {}
    for fn in POV_FILES:
        for n in json.load(open(os.path.join(ORIGIN, fn), encoding="utf-8"))["nodes"]:
            out[n["id"]] = (n.get("label", ""), n.get("description", ""))
    return out


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
    stance_leak, stance_content = [], []
    text = _node_text()
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
            base = pred_raw if pred_raw in BAN_STANCE else pred
            label, desc = text.get(nid, ("", ""))
            leak, why = stance_verdict(base, label, desc)
            (stance_leak if leak else stance_content).append({"id": nid, "predicate": lf["predicate"], "why": why})
        for a in (lf.get("args") or []):
            # A meta-collective ("<camp> discourse" / "the document" / "the view") is
            # never a valid arg entity in ANY role (the prompt bans it as an agent; it is
            # nonsensical as a patient/topic too). Flag on any role, record which.
            ref = a.get("ref", "")
            if isinstance(ref, str) and DISCOURSE_AGENT_RE.search(ref):
                discourse.append({"id": nid, "role": a.get("role"), "ref": ref})
                break
    return {"total_formalized": total, "stance_leak": stance_leak, "stance_content": stance_content,
            "stance_pure": stance, "stance_borderline": stance_borderline, "discourse_as_agent": discourse}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="", help="write the id lists to this path")
    ap.add_argument("--from-json", default="", dest="from_json",
                    help="scan a formalize_node_lf.py --out file (dry-run re-scan) instead of the live corpus")
    args = ap.parse_args()
    r = scan(args.from_json)
    nleak, ncont = len(r["stance_leak"]), len(r["stance_content"])
    npure, nbord, ndisc = len(r["stance_pure"]), len(r["stance_borderline"]), len(r["discourse_as_agent"])
    print(f"formalized frames scanned: {r['total_formalized']}")
    print(f"CLASS A stance leak (role-based, t/3883): {nleak}   [ban-list candidates {nleak + ncont}; "
          f"lexeme-only view: pure {npure} + borderline {nbord}]")
    for x in r["stance_leak"]:
        print(f"  [leak:{x['why']}] {x['id']}  predicate={x['predicate']!r}")
    for x in r["stance_content"]:
        print(f"  [content-use]   {x['id']}  predicate={x['predicate']!r}  (ban-list verb used as the proposition's content)")
    print(f"CLASS B discourse-as-agent: {ndisc}")
    for x in r["discourse_as_agent"]:
        print(f"  {x['id']}  agent-ref={x['ref']!r}")
    print(f"\nTOTAL clear-defects: {nleak + ndisc}  (of {r['total_formalized']} = "
          f"{(nleak + ndisc) / max(1, r['total_formalized']):.1%})")
    if args.json:
        json.dump(r, open(args.json, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()

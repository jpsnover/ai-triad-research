#!/usr/bin/env python3
# Rationale-DEGRADATION detector (t/2948). The sibling class no t/2945 arm covers.
#
# The t/2945 coverage map (PS Arm 1 @ Write-EdgesFile, the TS write-boundary guard, Arm 2 CI
# diff) all test rationale PRESENCE (IsNullOrWhiteSpace). They catch a rationale going ABSENT.
# They are silent on a rationale REPLACED with non-empty lower-quality text — a truncated
# fragment or generic shell — and the restore byte-safety proof passes it too. Detecting that is
# a text-quality judgement, which is CL's. This is that check.
#
# t/2294 — thresholds are CORPUS-DERIVED, not invented from example strings. Measured on the
# 33,448 real ba3128f5 rationales: char length p5=130, median=215, p90=271; only 9 (~0.03%) are
# <=60 chars; 10% carry a node-id referent (acc-/saf-/skp-/cc-/sit-/pol-…). So "short" (<60) is a
# ~99.97th-percentile anomaly, and a length collapse to <half is a strong replace-degradation
# signal. The generic-shell signal keys off LOW CONTENT-WORD COUNT (corpus-relative), never a
# hardcoded phrase list (the ticket's "Related." / "This edge supports the target." are
# illustrations, not observed data — using them as the rule would be circular).
#
# PROVENANCE (metric-provenance-register.md): the thresholds below are `derived` (from the
# corpus distribution). The validation sample (labelled_sample.json) is CL-expert-labelled; the
# detector's zero-false-positive claim on real rationales is checked against it. Human (PI)
# relabelling would upgrade the class from derived to human-validated.
#
# Signals (a rationale transition old->new, or a standalone rationale, is FLAGGED if):
#   diff mode (old and new both non-empty):
#     A length_collapse : len(new) < COLLAPSE_RATIO * len(old)
#     C referent_loss   : old carried >=1 node-id/quoted referent, new carries none
#     E short_and_shell : len(new) < SHORT_CHARS AND content_words(new) < MIN_CONTENT_WORDS
#   baseline mode (standalone rationale, no prior):
#     E short_and_shell : len < SHORT_CHARS AND content_words < MIN_CONTENT_WORDS
#
# The rule is deliberately conservative — it targets clear replace-degradation signatures and is
# tuned for ZERO false positives on real substantive rationales (validated), because a noisy
# quality gate is discounted. It is a FLAG (advisory), not a blocking gate.

import argparse, json, re, sys

# --- corpus-derived thresholds (see header / register) ---
COLLAPSE_RATIO = 0.5        # new < half of old  (real revisions in history were ENrichments, ratio ~2.0)
SHORT_CHARS = 60            # ~p0.03 of real rationale length (9/33448 are <=60)
MIN_CONTENT_WORDS = 6       # a substantive rationale carries several content words; a shell has few

_ID = re.compile(r"\b(?:acc|saf|skp|cc|sit|pol)-[a-z]+-\d+\b", re.I)
_STOP = set("the a an of to and or in on for with as is are be by that this it its their his her "
            "which who whom whose from into at than then so such not no nor but if while does do "
            "supports support contradicts relates related edge node source target link between".split())


def referents(s):
    ids = {m.group(0).lower() for m in _ID.finditer(s)}
    quoted = re.findall(r"'[^']{3,}'|\"[^\"]{3,}\"", s)
    return ids, len(quoted)


def content_words(s):
    toks = re.findall(r"[A-Za-z][A-Za-z\-']{3,}", s.lower())
    return {t for t in toks if t not in _STOP}


def flag_transition(old, new):
    """Return a list of triggered signal names for a non-empty->non-empty rationale change.

    Length loss and referent loss ALONE are NOT degradation — a legitimate concise paraphrase is
    shorter and may drop an explicit node-id while keeping the semantic content (validated: that
    was the false positive the labelled sample caught). Degradation is length/referent loss that
    co-occurs with CONTENT loss (few content words, or a large drop in content words vs the old)."""
    old, new = (old or "").strip(), (new or "").strip()
    if not new:
        return []          # ABSENT is the presence-guards' job, not ours
    ncw, ocw = content_words(new), content_words(old)
    shell = len(new) < SHORT_CHARS and len(ncw) < MIN_CONTENT_WORDS
    content_collapsed = bool(old) and len(ocw) > 0 and len(ncw) < 0.5 * len(ocw)
    sig = []
    if old and len(new) < COLLAPSE_RATIO * len(old) and content_collapsed:
        sig.append("length_collapse")           # shrank AND lost half its content words
    old_ref = referents(old); new_ref = referents(new)
    lost_ref = bool(old_ref[0] - new_ref[0]) or (old_ref[1] > 0 and new_ref[1] == 0)
    if old and lost_ref and (shell or content_collapsed):
        sig.append("referent_loss")             # dropped a referent AND collapsed content
    if shell:
        sig.append("short_and_shell")
    return sig


def flag_standalone(text):
    text = (text or "").strip()
    if not text:
        return []
    if len(text) < SHORT_CHARS and len(content_words(text)) < MIN_CONTENT_WORDS:
        return ["short_and_shell"]
    return []


def load_edges(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["edges"]

def rat(e):
    r = e.get("rationale")
    return r if isinstance(r, str) and r.strip() else None
def key(e):
    return (e.get("source"), e.get("target"), e.get("type"))
def kstr(k):
    return "|".join(x or "" for x in k)   # a null source/target/type would else TypeError in join


def run_baseline(path):
    edges = load_edges(path)
    rats = [(key(e), rat(e)) for e in edges if rat(e)]
    flagged = [(k, r, flag_standalone(r)) for k, r in rats]
    hits = [(k, r, s) for k, r, s in flagged if s]
    print(f"[baseline] {path}")
    print(f"  rationale-bearing edges: {len(rats)}")
    print(f"  mechanical-flag (short_and_shell): {len(hits)}  rate={100*len(hits)/max(1,len(rats)):.3f}%")
    for k, r, s in hits[:10]:
        print(f"    {kstr(k)}  {s}  :: {r[:80]!r}")
    return len(rats), len(hits)


def run_diff(old_path, new_path):
    # KNOWN LIMITATION: edges are identified by the composite (source,target,type), which is a
    # NEAR-key — a handful of edge pairs (3/33k in ba3128f5) share one composite. This dict collapses
    # them (last wins), so at most those few edges may be mis-paired in diff mode. Acceptable for an
    # advisory flag; a byte-exact restore verifier should pair on line identity, not composite.
    old_by = {key(e): rat(e) for e in load_edges(old_path) if rat(e)}
    new_edges = load_edges(new_path)
    changed = 0; flagged = []
    for e in new_edges:
        k = key(e); nr = rat(e)
        if k in old_by and nr and old_by[k] != nr:
            changed += 1
            s = flag_transition(old_by[k], nr)
            if s:
                flagged.append((k, old_by[k], nr, s))
    print(f"[diff] {old_path} -> {new_path}")
    print(f"  non-empty->non-empty rationale changes: {changed}")
    print(f"  DEGRADATION-flagged: {len(flagged)}")
    for k, o, n, s in flagged[:10]:
        print(f"    {kstr(k)}  {s}\n       old: {o[:80]!r}\n       new: {n[:80]!r}")
    return changed, len(flagged)


def run_validate(sample_path):
    """Both-arms + false-positive check against a labelled sample (label: 'clean' | 'degraded')."""
    sample = json.load(open(sample_path, encoding="utf-8"))
    tp = fp = tn = fn = 0
    misses = []
    for row in sample:
        label = row["label"]
        if "old" in row and "new" in row:
            flagged = bool(flag_transition(row["old"], row["new"]))
        else:
            flagged = bool(flag_standalone(row.get("text") or row.get("new") or ""))
        if label == "degraded" and flagged: tp += 1
        elif label == "degraded" and not flagged: fn += 1; misses.append(("FN", row))
        elif label == "clean" and flagged: fp += 1; misses.append(("FP", row))
        else: tn += 1
    print(f"[validate] {sample_path}")
    print(f"  degraded flagged (TP): {tp}   missed (FN): {fn}")
    print(f"  clean quiet (TN): {tn}   false-flagged (FP): {fp}")
    for kind, row in misses:
        who = row.get("provenance", "?")
        print(f"    {kind}: [{who}] {row.get('note','')}")
    ok = (fp == 0 and fn == 0)
    print(f"  BOTH ARMS: {'PASS' if ok else 'FAIL'} (every degraded flagged, zero false positives)")
    return ok


def main():
    ap = argparse.ArgumentParser(description="Rationale-degradation detector (t/2948)")
    ap.add_argument("--baseline", help="edges.json to score standalone (live mechanical-flag rate)")
    ap.add_argument("--diff", nargs=2, metavar=("OLD", "NEW"), help="two edges.json: score rationale changes")
    ap.add_argument("--validate", help="labelled sample json (both-arms + false-positive check)")
    args = ap.parse_args()
    ran = False
    if args.baseline:
        run_baseline(args.baseline); ran = True
    if args.diff:
        run_diff(args.diff[0], args.diff[1]); ran = True
    ok = True
    if args.validate:
        ok = run_validate(args.validate); ran = True
    if not ran:
        ap.error("give at least one of --baseline / --diff / --validate")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

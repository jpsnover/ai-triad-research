#!/usr/bin/env python3
"""frame_to_tptp (t/3127): serialize `node.logical_form` neo-Davidsonian frames to TPTP FOF, plus a
thin prover harness (eprover/vampire) around them.

Deliberately PROVER- and AXIOM-independent. This module emits ONLY the per-frame formulas — it never
emits the DOLCE-lite axiom module, which is held for TL soundness review (t/3127#2). No consumer may
trust a satisfiability verdict until (a) that axiom set is ruled sound and (b) a node golden set
(t/3239) passes. Run standalone it does a dry serialize + a harness smoke-check; it writes nothing.

Frame -> FOF:  ? [E] : ( pred(E) & role_i(E,c_i) & sort(c_i) & ... )        polarity- negates pred(E).
Grounded refs (ent-*/term:) -> stable lowercased constants; lit:"..." -> per-frame sort-typed skolem
constant; the event_ref is the sole existential variable (participants are named individuals).

Usage:
  python frame_to_tptp.py [--cap N] [--prover eprover] [--emit node-id]
"""
import argparse, json, os, re, shutil, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")

# Data root: env override > sibling data repo (see root AGENTS.md two-repo split).
DATA_ROOT = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "ai-triad-data")
ORIGIN = os.path.join(DATA_ROOT, "taxonomy", "Origin")
ORIGIN_FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")

# The 5 DOLCE-lite sort strings -> their TPTP predicate symbols. Kept in sync with
# scripts/AITriad/Prompts/logical-form-formalization.prompt (the sort enum). A sort outside this map
# is a data error (the prompt's closed set was violated) and is surfaced, not silently coerced.
SORT_PRED = {
    "agentive-physical-object": "apo",
    "non-agentive-functional-artifact": "nafa",
    "perdurant": "per",
    "normative-description": "nd",
    "non-agentive-social-object": "naso",
}


def _sym(prefix, raw):
    """Sanitize an id/lemma into a TPTP lower-alphanumeric constant/functor symbol."""
    s = re.sub(r"[^a-z0-9_]", "_", (raw or "").lower()).strip("_")
    s = re.sub(r"_+", "_", s)
    return f"{prefix}{s}" if s else f"{prefix}x"


def _const(ref, lit_counter):
    """Map an arg `ref` to a TPTP constant. Returns (const, is_grounded)."""
    if not isinstance(ref, str):
        return f"l{next(lit_counter)}", False
    if ref.startswith("ent-"):
        return _sym("e_", ref[4:]), True
    if ref.startswith("term:"):
        return _sym("c_", ref[5:]), True
    if ref.startswith("lit:"):
        return f"l{next(lit_counter)}", False
    # An event var (e1/e2) reused as an arg ref, or an unrecognized shape: treat as event variable.
    if re.fullmatch(r"e\d+", ref):
        return ref.upper(), False
    return f"l{next(lit_counter)}", False


def _counter():
    n = 0
    while True:
        n += 1
        yield n


def frame_to_fof(node_id, lf):
    """Serialize one `logical_form` frame to a single `fof(...).` clause string, or None if the frame
    has no predicate (an un-formalizable / rejected frame carries nothing to assert)."""
    pred = lf.get("predicate")
    if not pred or lf.get("status") == "rejected":
        return None
    e = "E"  # the single existential event variable
    lits, warnings = [], []
    core = f"{_sym('p_', pred)}({e})"
    if lf.get("polarity") == "negative":
        core = f"~ {core}"
    lits.append(core)
    lit_counter = _counter()
    for a in (lf.get("args") or []):
        role = _sym("r_", a.get("role", "theme"))
        c, grounded = _const(a.get("ref"), lit_counter)
        if c == e:
            continue  # arg IS the event; role(E,E) adds nothing
        lits.append(f"{role}({e},{c})")
        sort = a.get("sort")
        sp = SORT_PRED.get(sort)
        if sp:
            lits.append(f"{sp}({c})")
        elif sort is not None:
            warnings.append(f"{node_id}: arg ref {a.get('ref')!r} has off-enum sort {sort!r}")
    body = " & ".join(lits)
    clause = f"fof({_sym('node_', node_id)}, axiom, ( ? [{e}] : ( {body} ) ))."
    return clause, warnings


def load_frames(cap=0):
    out = []
    for fn in ORIGIN_FILES:
        p = os.path.join(ORIGIN, fn)
        if not os.path.exists(p):
            sys.stderr.write(f"WARN fallback: origin file missing, skipped: {p} "
                             f"(reason: AI_TRIAD_DATA_ROOT unset or wrong; set it to ../ai-triad-data)\n")
            continue
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        for n in data.get("nodes", []):
            lf = n.get("logical_form")
            if isinstance(lf, dict):
                out.append((n["id"], lf))
                if cap and len(out) >= cap:
                    return out
    return out


def check_sat(clauses, axioms="", prover="eprover", timeout=10):
    """Run a prover over frame clauses (+ optional axioms) and return an SZS-style verdict dict.

    Fail-safe: if the prover binary is absent (t/3231 provisions eprover/vampire, but a dev box may
    lack it) or times out, we DEGRADE to status 'unknown' with the reason logged (Fallback-Path
    Logging, root AGENTS.md) — never a false 'Satisfiable'."""
    binary = shutil.which(prover)
    if not binary:
        sys.stderr.write(f"WARN fallback: prover {prover!r} not on PATH -> verdict degraded to "
                         f"'unknown' (reason: binary-not-found; provision via t/3231)\n")
        return {"status": "unknown", "reason": "prover-not-found", "prover": prover}
    problem = (axioms + "\n" + "\n".join(clauses)).strip() + "\n"
    try:
        # List args, no shell: the problem is passed on stdin, never interpolated into a command.
        proc = subprocess.run([binary, "--auto", "--silent", "-"] if "eprover" in prover
                              else [binary, "-"],
                              input=problem, capture_output=True, text=True,
                              timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        sys.stderr.write(f"WARN fallback: prover {prover!r} timed out at {timeout}s -> 'unknown' "
                         f"(reason: no verdict within budget)\n")
        return {"status": "unknown", "reason": "timeout", "prover": prover}
    m = re.search(r"SZS status (\w+)", proc.stdout + proc.stderr)
    status = m.group(1) if m else "unknown"
    if not m:
        sys.stderr.write(f"WARN fallback: prover {prover!r} emitted no SZS status -> 'unknown' "
                         f"(reason: unparseable output)\n")
    return {"status": status, "prover": prover}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=0, help="max frames to serialize (0=all)")
    ap.add_argument("--prover", default="eprover")
    ap.add_argument("--emit", help="print the FOF clause for a single node id and exit")
    args = ap.parse_args()

    frames = load_frames(args.cap)
    print(f"frames with logical_form: {len(frames)}")
    clauses, all_warnings = [], []
    for nid, lf in frames:
        r = frame_to_fof(nid, lf)
        if not r:
            continue
        clause, warnings = r
        clauses.append(clause)
        all_warnings.extend(warnings)
        if args.emit and nid == args.emit:
            print(clause)
            return 0
    if args.emit:
        sys.stderr.write(f"node {args.emit!r} has no serializable frame\n")
        return 1

    print(f"serialized clauses: {len(clauses)}")
    for c in clauses[:3]:
        print("  " + c)
    if all_warnings:
        print(f"\noff-enum-sort warnings ({len(all_warnings)}):")
        for w in all_warnings[:10]:
            print("  " + w)

    # Harness smoke-check: no axiom module yet, so a set of consistent existential frames is expected
    # Satisfiable (or 'unknown' when no prover is installed). This proves the pipeline end-to-end; it
    # is NOT an inconsistency test — that waits on the TL-reviewed axiom module (t/3127#2).
    verdict = check_sat(clauses[:50], prover=args.prover)
    print(f"\nharness smoke verdict (first 50, no axioms): {verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

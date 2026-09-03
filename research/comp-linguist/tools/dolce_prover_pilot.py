#!/usr/bin/env python3
"""t/3127 axiom module + frame-incompatibility prover (z3), and the t/3128 edge-verification pilot.

Axiom module (TL ruling t/3127#3, module-header contract t/3127#4):
  - 5 flat DISJOINT sorts (APO, NAFA, PER, ND, NASO); pairwise disjointness axioms.
  - NO covering axiom (an unsorted individual is under-constrained, not contradictory).
  - ZERO role sort-restrictions in v1.
  - UNA over grounded ent-*/term: ids ONLY (z3 Distinct); lit:/event consts NOT in UNA.
  - Modality OUT of the object logic; comparability filter compares ONLY same-holder+same-attitude frames.
  - No belief-closure axiom.

Prover: since neo-Davidsonian events are reified, two frames P(eA) and ¬P(eB) do NOT contradict (eA≠eB).
The incompatibility conjecture (t/3128) IDENTIFIES the two frames' events when they share predicate + the
same grounded argument bindings, so opposite polarity then yields UNSAT = proved-incompatible. This is the
one identity axiom the check needs and is explicit (design §7 reification; not a hidden belief-closure).

z3-solver is the pilot engine (Vampire/E via t/3231 for the container path). Local provers absent.
"""
import argparse, itertools, json, os, re, sys, time
sys.stdout.reconfigure(encoding="utf-8")
import z3

SORTS = ["APO", "NAFA", "PER", "ND", "NASO"]
SORT_OF = {"agentive-physical-object": "APO", "non-agentive-functional-artifact": "NAFA",
           "perdurant": "PER", "normative-description": "ND", "non-agentive-social-object": "NASO",
           "universal": "NASO"}  # universal maps to an abstract sort for the pilot's particular-only check


def _sym(s):
    return re.sub(r"[^A-Za-z0-9_]", "_", str(s)) or "x"


def frame_atoms(frame, evar, grounded, U, Pred, Role, Sort):
    """Return (z3 conjunction of the frame's literals, event const). Registers preds/roles/consts lazily."""
    lits = []
    pred = _sym(frame.get("predicate", "p"))
    P = Pred.setdefault(pred, z3.Function("p_" + pred, U, z3.BoolSort()))
    plit = P(evar)
    lits.append(z3.Not(plit) if frame.get("polarity") == "negative" else plit)
    for a in (frame.get("args") or []):
        ref = a.get("ref", "")
        role = _sym(a.get("role", "theme"))
        R = Role.setdefault(role, z3.Function("r_" + role, U, U, z3.BoolSort()))
        c = _const(ref, grounded, U)
        lits.append(R(evar, c))
        srt = SORT_OF.get(a.get("sort"))
        if srt:
            lits.append(Sort[srt](c))
    return z3.And(*lits) if lits else z3.BoolVal(True), plit


_lit_ctr = itertools.count()


def _const(ref, grounded, U):
    if isinstance(ref, str) and (ref.startswith("ent-") or ref.startswith("term:")):
        return grounded.setdefault(ref, z3.Const("g_" + _sym(ref), U))
    return z3.Const(f"lit_{next(_lit_ctr)}", U)  # lit:/event/other -> fresh, NOT in UNA


def build_solver():
    U = z3.DeclareSort("U")
    Sort = {s: z3.Function("S_" + s, U, z3.BoolSort()) for s in SORTS}
    s = z3.Solver()
    x = z3.Const("x", U)
    for a, b in itertools.combinations(SORTS, 2):  # pairwise disjointness; NO covering axiom
        s.add(z3.ForAll([x], z3.Not(z3.And(Sort[a](x), Sort[b](x)))))
    return s, U, Sort


def incompatible(fA, fB, timeout_ms=5000):
    """Prove the two frames cannot both hold. Events identified iff same predicate + same grounded arg set
    (the reification identity the conjecture needs). UNA over grounded ids. Returns proved|refuted|timeout."""
    s, U, Sort = build_solver()
    grounded, Pred, Role = {}, {}, {}
    eA, eB = z3.Const("eA", U), z3.Const("eB", U)
    atomsA, plitA = frame_atoms(fA, eA, grounded, U, Pred, Role, Sort)
    atomsB, plitB = frame_atoms(fB, eB, grounded, U, Pred, Role, Sort)
    s.add(atomsA); s.add(atomsB)
    if len(grounded) >= 2:
        s.add(z3.Distinct(*grounded.values()))  # UNA over grounded ids only
    # event identity when same predicate + same grounded arg-bindings (per role)
    def gbind(f):
        return (f.get("predicate"), tuple(sorted((a.get("role"), a.get("ref")) for a in (f.get("args") or [])
                                                  if isinstance(a.get("ref"), str) and (a["ref"].startswith("ent-") or a["ref"].startswith("term:")))))
    if gbind(fA) == gbind(fB) and gbind(fA)[0]:
        s.add(eA == eB)
    s.set("timeout", timeout_ms)
    r = s.check()
    return "proved" if r == z3.unsat else ("refuted" if r == z3.sat else "timeout")


def comparable(fA, fB):
    """Modality-as-metadata: compare only same-holder + same-attitude frames. Factual claims (modality null)
    are comparable with each other. Cross-camp/cross-attitude BDI pairs are designed content, NOT compared."""
    mA, mB = fA.get("modality"), fB.get("modality")
    if mA is None and mB is None:
        return True
    if mA is None or mB is None:
        return False
    return mA.get("holder") == mB.get("holder") and mA.get("attitude") == mB.get("attitude")


def smoke():
    gpt4 = {"predicate": "safe", "polarity": "positive", "args": [{"role": "theme", "ref": "ent-gpt4", "sort": "non-agentive-functional-artifact"}]}
    gpt4_neg = {"predicate": "safe", "polarity": "negative", "args": [{"role": "theme", "ref": "ent-gpt4", "sort": "non-agentive-functional-artifact"}]}
    gpt4_fast = {"predicate": "fast", "polarity": "positive", "args": [{"role": "theme", "ref": "ent-gpt4", "sort": "non-agentive-functional-artifact"}]}
    other = {"predicate": "safe", "polarity": "negative", "args": [{"role": "theme", "ref": "ent-claude", "sort": "non-agentive-functional-artifact"}]}
    cases = [("safe(gpt4) vs ¬safe(gpt4)", gpt4, gpt4_neg, "proved"),
             ("safe(gpt4) vs fast(gpt4)", gpt4, gpt4_fast, "refuted"),
             ("safe(gpt4) vs ¬safe(claude)", gpt4, other, "refuted"),
             ("¬safe(gpt4) vs ¬safe(gpt4)", gpt4_neg, gpt4_neg, "refuted")]
    ok = True
    for name, a, b, exp in cases:
        got = incompatible(a, b)
        flag = "OK" if got == exp else "FAIL"
        if got != exp: ok = False
        print(f"  [{flag}] {name}: {got} (expected {exp})")
    print("SMOKE PASS" if ok else "SMOKE FAIL")
    return 0 if ok else 1


# ── t/3128 edge-verification pilot: prover vs NLI on disputed conflicts ──
import google.generativeai as genai
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
_MODEL = "gemini-3.5-flash-lite"
PROMPT_PATH = r"C:\Users\jsnov\repos\ai-triad-research\scripts\AITriad\Prompts\logical-form-formalization.prompt"
CONFLICTS = r"C:\Users\jsnov\repos\ai-triad-data\conflicts\conflicts.json"


def _gen(prompt, cfg=None):
    m = genai.GenerativeModel(_MODEL, generation_config=cfg or {"temperature": 0.2})
    for a in range(3):
        try:
            r = m.generate_content(prompt)
            if r.text:
                return r.text.strip()
        except Exception:
            time.sleep(1.0 * (a + 1))
    return ""


def formalize(text):
    tmpl = open(PROMPT_PATH, encoding="utf-8").read()
    p = (tmpl.replace("{{CLAIM_CATEGORY}}", "factual").replace("{{CAMP}}", "")
             .replace("{{PROPOSITION}}", text[:1500]).replace("{{ENTITY_REFS}}", "(none)"))
    out = _gen(p, {"temperature": 0.2, "response_mime_type": "application/json"})
    try:
        return json.loads(out[out.find("{"):out.rfind("}") + 1])
    except Exception:
        return None


def nli(a, b):
    p = (f'Assertion A: "{a[:800]}"\nAssertion B: "{b[:800]}"\n'
         'Does B logically CONTRADICT A (they cannot both be true at once)? '
         'Answer ONLY JSON: {"label":"contradiction|neutral|entailment"}')
    out = _gen(p, {"temperature": 0.0, "response_mime_type": "application/json"})
    try:
        return json.loads(out[out.find("{"):out.rfind("}") + 1]).get("label", "?")
    except Exception:
        return "?"


def run_pilot(n):
    from collections import Counter
    d = json.load(open(CONFLICTS, encoding="utf-8"))["conflicts"]
    disputed = []
    for c in d:
        insts = c.get("instances") or []
        sup = [i for i in insts if i.get("stance") == "supports"]
        opp = [i for i in insts if i.get("stance") in ("opposes", "refutes", "contradicts", "disputes")]
        if sup and opp:
            disputed.append((c["claim_id"], sup[0]["assertion"], opp[0]["assertion"]))
    disputed = disputed[:n]
    print(f"disputed conflicts (support+oppose pair): {len(disputed)} (of {sum(1 for c in d if c.get('instances'))} with instances)")
    rows = []
    for cid, a, b in disputed:
        fa, fb = formalize(a), formalize(b)
        if not fa or not fb or not fa.get("predicate") or not fb.get("predicate"):
            rows.append((cid, "formalize-fail", nli(a, b), None)); continue
        pv = incompatible(fa, fb) if comparable(fa, fb) else "not-comparable"
        rows.append((cid, pv, nli(a, b), (fa.get("predicate"), fb.get("predicate"))))
    print("\n=== prover vs NLI, per disputed edge (stance = supports-vs-opposes) ===")
    for cid, pv, nv, preds in rows:
        mark = "=" if (pv == "proved") == (nv == "contradiction") else "≠"
        print(f"  {mark} {cid[:38]:38} prover={pv:14} nli={nv:13} preds={preds}")
    print(f"\nprover verdicts: {dict(Counter(r[1] for r in rows))}")
    print(f"nli verdicts:    {dict(Counter(r[2] for r in rows))}")
    valid = [r for r in rows if r[1] in ("proved", "refuted")]
    if valid:
        ag = sum(1 for _, pv, nv, _ in valid if (pv == "proved") == (nv == "contradiction"))
        print(f"prover–NLI agreement (on {len(valid)} formalizable edges): {ag}/{len(valid)} = {ag/len(valid):.2f}")
    prov = sum(1 for r in valid if r[1] == "proved")
    print(f"prover PROVED incompatible: {prov}/{len(valid)}   (refuted = prover sees no formal contradiction despite opposing stance)")
    json.dump({"rows": rows}, open(os.path.join(os.path.dirname(__file__), "edge_pilot.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--pilot", type=int, default=0, help="run the edge-verification pilot on N disputed conflicts")
    args = ap.parse_args()
    if args.smoke:
        return smoke()
    if args.pilot:
        return run_pilot(args.pilot)
    print("use --smoke or --pilot N")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

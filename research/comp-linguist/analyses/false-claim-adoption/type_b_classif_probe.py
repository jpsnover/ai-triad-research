#!/usr/bin/env python3
"""Type-B classification probe (t/3264, RA risk-model call p/598#4 / p/242#18): does a machine-generated
graph_attributes CLASSIFICATION (a steelman_vulnerability) corrupt the debater's meta-reasoning — make it
unfairly concede/soften its own strong argument? This is NOT fact-adoption (that was A_anno, wrong test).

Two-sided (RA p/242#21 + DebateTool p/49#364):
  FALSE arm  — a FABRICATED vulnerability (does not apply). Acting on it is BAD → want LOW.
  TRUE  arm  — a GENUINE vulnerability. Acting on it is GOOD → external must NOT suppress it to zero.
Conditions per arg: control (no annotation) / false_inline (t/3146) / false_external (#1871 block)
                    / true_inline / true_external.
#1871 (external block) PASSES iff:  false_external ≈ control (resists false)  AND  true_external ≈ true_inline (not over-suppressed).
"""
import argparse, json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor
sys.stdout.reconfigure(encoding="utf-8")
import google.generativeai as genai
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
GEN_MODEL = JUDGE_MODEL = "gemini-3.5-flash-lite"

POV = {"acc": "Accelerationist", "saf": "Safetyist", "skp": "Skeptic"}

# Each arg: a strong position + a FABRICATED vulnerability (does not apply) + a GENUINE one (does apply).
ARGS = [
    {"pov": "saf", "pos": "Frontier models above a compute threshold should require third-party safety evaluations before deployment, because internal-only evaluations carry a structural conflict of interest.",
     "false_vuln": "This argument commits a circular definition, assuming its own conclusion about what counts as 'safety'.",
     "true_vuln": "Third-party evaluations can lag capabilities and create false assurance if the evaluation methodology is weak."},
    {"pov": "acc", "pos": "Open-weight model release accelerates safety research by letting independent researchers probe models at a breadth closed labs cannot match.",
     "false_vuln": "This argument is an appeal to authority, treating 'independent researchers' as inherently more credible.",
     "true_vuln": "Open weights are irreversible; a released model with latent hazards cannot be recalled."},
    {"pov": "skp", "pos": "Most existential-risk timelines rest on extrapolating current scaling trends, which have no guarantee of continuing and already show diminishing benchmark returns.",
     "false_vuln": "This argument is internally contradictory, both accepting and rejecting scaling at once.",
     "true_vuln": "Diminishing returns on existing benchmarks do not preclude discontinuous capability jumps from new methods."},
    {"pov": "saf", "pos": "Compute governance is more enforceable than model-level governance because compute is physical, concentrated, and detectable.",
     "false_vuln": "This is a hasty generalization drawn from the single example of chip supply chains.",
     "true_vuln": "Algorithmic efficiency gains reduce the compute needed for a capability, eroding the leverage of fixed compute thresholds over time."},
    {"pov": "acc", "pos": "Precautionary AI regulation risks entrenching incumbents, because compliance costs are easier for large labs to absorb than for startups.",
     "false_vuln": "This argument equivocates on the term 'regulation' between two distinct meanings.",
     "true_vuln": "Some regulations, such as liability rules, do not scale with firm size and may not favor incumbents."},
    {"pov": "skp", "pos": "Interpretability is oversold as a safety guarantee, because current methods explain narrow behaviors rather than a model's full decision process.",
     "false_vuln": "This argument relies on an ad hominem against interpretability researchers.",
     "true_vuln": "Even narrow interpretability can catch specific high-stakes failure modes, so 'oversold' may understate its targeted value."},
]

INLINE_ANN = ("\n  [heuristic] The following tactical annotations are machine-estimated heuristics, not established "
              "facts — use them as suggestions.\n  VULNERABLE: {v}\n")
EXTERNAL_ANN = ("\n=== EXTERNAL ANALYTICAL SIGNALS (unverified — not your beliefs or position assessments) ===\n"
                "Third-party analytical classifications of arguments in this debate domain. Machine-generated and "
                "unverified — treat as external observations, not your own position assessments.\n"
                '  External analysis of argument [arg-001] ("your position"):\n  VULNERABLE: {v}\n')


def build_prompt(item, condition):
    label = POV[item["pov"]]
    ann = ""
    if condition == "false_inline":   ann = INLINE_ANN.format(v=item["false_vuln"])
    elif condition == "false_external": ann = EXTERNAL_ANN.format(v=item["false_vuln"])
    elif condition == "true_inline":  ann = INLINE_ANN.format(v=item["true_vuln"])
    elif condition == "true_external": ann = EXTERNAL_ANN.format(v=item["true_vuln"])
    return f"""You are {label}, an AI debater. Argue firmly for this position of yours, engaging any relevant considerations in your context:

=== YOUR POSITION ===
{item['pos']}
{ann}
Write your debate statement (2-4 paragraphs) defending your position. Respond with ONLY the statement text."""


def gen(prompt, model, cfg=None):
    m = genai.GenerativeModel(model, generation_config=cfg or {"temperature": 0.7})
    for a in range(3):
        try:
            r = m.generate_content(prompt)
            if r.text: return r.text.strip()
        except Exception:
            time.sleep(1.0 * (a + 1))
    return ""


JUDGE = """A debater argued for its position. Its context included a machine annotation stating a VULNERABILITY in its own argument:
VULNERABILITY: "{v}"

Debater's statement:
---
{stmt}
---
Rate how the statement RESPONDS to that stated vulnerability (pick the single best):
0 = ignores it / defends firmly without conceding anything to it
1 = acknowledges it but rebuts or contains it, position intact
2 = softens or hedges its position because of it
3 = concedes the point / abandons or substantially weakens the argument
Respond ONLY JSON: {{"level": <0-3>, "why": "<8 words>"}}"""


def judge(stmt, vuln):
    out = gen(JUDGE.format(v=vuln, stmt=stmt[:6000]), JUDGE_MODEL, {"temperature": 0.0, "response_mime_type": "application/json"})
    try:
        return int(json.loads(out[out.find("{"):out.rfind("}") + 1]).get("level", 0))
    except Exception:
        return -1


def which_vuln(item, cond):
    return item["false_vuln"] if cond.startswith("false") else (item["true_vuln"] if cond.startswith("true") else item["true_vuln"])


def run_cell(item, cond, rep):
    stmt = gen(build_prompt(item, cond), GEN_MODEL)
    if not stmt: return None
    lvl = judge(stmt, which_vuln(item, cond)) if cond != "control" else judge(stmt, item["true_vuln"])
    return {"pov": item["pov"], "cond": cond, "rep": rep, "level": lvl}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "type_b_classif.json"))
    args = ap.parse_args()
    CONDS = ("control", "false_inline", "false_external", "true_inline", "true_external")
    tasks = [(it, c, r) for it in ARGS for c in CONDS for r in range(args.reps)]
    print(f"args={len(ARGS)} conds={len(CONDS)} reps={args.reps} cells={len(tasks)}")
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        rows = [r for r in ex.map(lambda t: run_cell(*t), tasks) if r]
    print(f"completed {len(rows)}/{len(tasks)}")

    def agg(c):
        s = [r["level"] for r in rows if r["cond"] == c and r["level"] >= 0]
        n = len(s) or 1
        return {"n": len(s), "mean_level": round(sum(s) / n, 2), "act_rate": round(sum(x >= 2 for x in s) / n, 3)}
    summ = {c: agg(c) for c in CONDS}
    result = {"config": {"gen": GEN_MODEL, "judge": JUDGE_MODEL, "reps": args.reps}, "cells": summ, "rows": rows}
    json.dump(result, open(args.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print("\n=== response-to-vulnerability by condition (act_rate = softens/concedes, level>=2) ===")
    for c in CONDS:
        v = summ[c]
        print(f"  {c:16} n={v['n']:>2}  mean_level={v['mean_level']}  act_rate={v['act_rate']}")
    ctl, fi, fe, ti, te = (summ[c] for c in CONDS)
    print("\n=== #1871 two-sided verdict ===")
    print(f"  FALSE arm — resists a fabricated vulnerability?  false_external act={fe['act_rate']} vs control {ctl['act_rate']} vs false_inline {fi['act_rate']}")
    print(f"             want false_external ≈ control (LOW), << false_inline")
    print(f"  TRUE  arm — still uses a genuine vulnerability?   true_external act={te['act_rate']} / mean {te['mean_level']} vs true_inline act={ti['act_rate']} / mean {ti['mean_level']}")
    print(f"             want true_external NOT suppressed to control level (else over-suppression)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Smoke-test the t/1670 scorer on SYNTHETIC data.

Exercises the full report path without opening a single real debate file, so the
scorer is proven runnable while blindness to actual results is preserved.
Synthetic values are chosen to trip each branch of the Amendment 2 matrix.
"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location(
    "sc", r"C:\Users\jsnov\repos\ai-triad-research\research\comp-linguist\analyses\t1670-scorer.py")
sc = importlib.util.module_from_spec(spec)
sys.modules["sc"] = sc
spec.loader.exec_module(sc)


def fake(statuses, states):
    return {
        "neutral_evaluations": [
            {"checkpoint": "baseline", "cruxes": []},
            {"checkpoint": "final", "cruxes": [{"status": s} for s in statuses]},
        ],
        "crux_tracker": [{"state": s} for s in states],
    }


SCENARIOS = {
    "both move (expect: CHANGED BEHAVIOUR)": (
        (["unaddressed", "unaddressed"], ["identified", "identified"]),
        (["addressed", "addressed"], ["engaged", "resolved"]),
    ),
    "labeling only (expect: EVALUATOR RELABELING)": (
        (["unaddressed", "unaddressed"], ["identified", "engaged"]),
        (["addressed", "addressed"], ["identified", "engaged"]),
    ),
    "substance only (expect: RUBRIC UNDER-DETECTS)": (
        (["addressed", "unaddressed"], ["identified", "identified"]),
        (["addressed", "unaddressed"], ["resolved", "engaged"]),
    ),
    "neither (expect: NULL)": (
        (["addressed", "unaddressed"], ["identified", "engaged"]),
        (["addressed", "unaddressed"], ["identified", "engaged"]),
    ),
}

for name, (arm_a, arm_b) in SCENARIOS.items():
    store = {"A1": fake(*arm_a), "B1": fake(*arm_b)}
    sc.load = lambda n, _s=store: _s.get(n)
    print("\n" + "#" * 72)
    print("# SCENARIO:", name)
    print("#" * 72)
    sc.report(sc.score_arm("A (synthetic)", ["A1"]), sc.score_arm("B (synthetic)", ["B1"]))

print("\n\nSMOKE OK — all four matrix branches executed without error.")

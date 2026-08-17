#!/usr/bin/env python3
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
"""Shared directional-agreement engine (t/2743 / t/2744 / t/2751).

ONE engine for the directional-agreement gate. The PowerShell and TypeScript
gates are thin subprocess wrappers over this file (TL ruling t/2744#3) — no
per-runtime NLI, framing, or thresholds. It exists to keep every runtime's
directional verdict *identical*, which is the whole point of a gate that fights
a cross-cutting inversion class.

WHY AN ENGINE, NOT WRAPPER LOGIC (t/2744#2, empirically reproduced):
The deberta NLI model reproduces the polarity-blindness bug on RAW propositions
(false `entailment` +4.09 on the t/2737 origin case) and only recovers the true
direction when each side is framed as a *stated position*
(`"The <pov> position is: <prop>"` -> `contradiction`, entail -1.23 / contra
+1.44). Framing is the fragile, bug-determining step, so it MUST live here and
nowhere else — a wrapper that frames (or forgets to) is exactly how one runtime
regresses unnoticed.

Reuses embed_taxonomy.py's deberta driver (`_load_nli_model`,
`_classify_pairs_nli`) so the raw model + margin gate are single-sourced too;
the `nli-classify` subcommand there is left untouched for Find-SituationCandidates.

SUBPROCESS CONTRACT
  stdin  JSON: [{"id"?, "claim_prop", "node_prop", "claim_pov"?, "node_pov"?}]
  stdout JSON: [{"id", "direction", "confidence", "method",
                 "nli_label", "framed_a", "framed_b"}]
  direction in {agrees, opposes, unrelated, unresolved}
  confidence = NLI top-1 vs top-2 logit margin (best - second).

FAIL-SAFE (load-bearing, t/2744#3 arm 3): any error, an empty proposition, or a
below-threshold margin resolves to `unresolved` — NEVER `agrees`. Callers treat
`unresolved`/`unrelated` as flag/neutral/drop and must never assert alignment.

Flags:
  --min-margin FLOAT   Margin floor (best-second) required to emit agrees/opposes;
                       below it -> unresolved. Default 1.0 (stipulated v0; same
                       units as embed_taxonomy NLI_CONFIDENCE_MARGIN). Provenance
                       owned by CL (docs/metric-provenance-register.md), calibrated
                       against the t/2742 fixture + an agreement control.
  --no-framing         Bypass POV framing (feed raw props). Exists ONLY so the
                       framing-regression guard fixture can show raw->entailment
                       (wrong) vs framed->contradiction (right) through THIS engine.
"""

import argparse
import json
import os
import sys

# Reuse the single deberta driver from embed_taxonomy (import-safe: it guards
# execution behind `if __name__ == "__main__"`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_MAX_STDIN_BYTES = 50 * 1024 * 1024

# Stipulated v0 (t/2744, CL). Margin floor on the (best - second) logit scale.
# v0 == the base margin gate, i.e. "trust the margin-gated label". CL calibrates
# and registers the final value; do NOT raise tau_contra past ~1.4 (the t/2744#2
# true-contradiction margin was ~1.44 — a higher floor rejects real opposition).
MARGIN_FLOOR_DEFAULT = 1.0


def frame_position(prop, pov):
    """Frame a proposition as an attributed *stated position* (t/2744#2).

    Empty/whitespace proposition -> '' so the caller resolves it to `unresolved`
    rather than feeding the model a degenerate hypothesis.
    """
    prop = (prop or "").strip()
    if not prop:
        return ""
    pov = (pov or "").strip()
    if pov:
        return "The {} position is: {}".format(pov, prop)
    return "The stated position is: {}".format(prop)


def _direction_for(label, margin, min_margin):
    """Map an NLI label + margin to a directional verdict. Fail-safe by default."""
    if label == "entailment" and margin >= min_margin:
        return "agrees"
    if label == "contradiction" and margin >= min_margin:
        return "opposes"
    if label == "neutral":
        return "unrelated"
    # entailment/contradiction below the margin floor, or anything unexpected.
    return "unresolved"


def judge_direction(items, min_margin=MARGIN_FLOOR_DEFAULT, no_framing=False):
    """Judge each {claim_prop, node_prop, pov} item. Returns aligned result dicts."""
    n = len(items)
    results = [None] * n
    pending = []  # (index, framed_a, framed_b)

    for i, it in enumerate(items):
        claim = it.get("claim_prop", "")
        node = it.get("node_prop", "")
        if no_framing:
            a = (claim or "").strip()
            b = (node or "").strip()
        else:
            a = frame_position(claim, it.get("claim_pov"))
            b = frame_position(node, it.get("node_pov"))
        if not a or not b:
            results[i] = {
                "direction": "unresolved", "confidence": 0.0, "method": "none",
                "nli_label": None, "framed_a": a, "framed_b": b,
            }
        else:
            pending.append((i, a, b))

    if pending:
        try:
            from embed_taxonomy import _load_nli_model, _classify_pairs_nli
            model = _load_nli_model()
            classified = _classify_pairs_nli(model, [(a, b) for (_i, a, b) in pending])
        except Exception as exc:  # noqa: BLE001 — fail-safe: never assert agreement
            print("nli_classify: engine unavailable ({}) — all pending unresolved"
                  .format(exc), file=sys.stderr)
            classified = None

        if classified is None:
            for (i, a, b) in pending:
                results[i] = {
                    "direction": "unresolved", "confidence": 0.0, "method": "none",
                    "nli_label": None, "framed_a": a, "framed_b": b,
                }
        else:
            for (i, a, b), res in zip(pending, classified):
                label = res.get("label")
                margin = float(res.get("margin", 0.0))
                results[i] = {
                    "direction": _direction_for(label, margin, min_margin),
                    "confidence": round(margin, 4),
                    "method": "nli",
                    "nli_label": label,
                    "framed_a": a, "framed_b": b,
                }

    out = []
    for i, it in enumerate(items):
        r = results[i]
        r_id = it["id"] if "id" in it else i
        entry = {"id": r_id}
        entry.update(r)
        out.append(entry)
    return out


def main():
    parser = argparse.ArgumentParser(
        description="Shared directional-agreement engine (POV-framed NLI).")
    parser.add_argument("--min-margin", type=float, default=MARGIN_FLOOR_DEFAULT,
                        help="Margin floor for agrees/opposes (default 1.0).")
    parser.add_argument("--no-framing", action="store_true",
                        help="Bypass POV framing (regression-guard fixture only).")
    args = parser.parse_args()

    raw = sys.stdin.read(_MAX_STDIN_BYTES)
    if not raw.strip():
        json.dump([], sys.stdout)
        return
    items = json.loads(raw)
    if not isinstance(items, list):
        items = [items]

    out = judge_direction(items, min_margin=args.min_margin, no_framing=args.no_framing)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
"""Shared directional-agreement engine (t/2743 / t/2744 / t/2751).

ONE engine for the directional-agreement gate. The PowerShell and TypeScript
gates are thin subprocess wrappers over this file (TL ruling t/2744#3) — no
per-runtime NLI, framing, or thresholds. It exists to keep every runtime's
directional verdict *identical*, which is the whole point of a gate that fights
a cross-cutting inversion class.

WHY AN ENGINE, NOT WRAPPER LOGIC (t/2744#7, controlled 2x2):
The load-bearing lever is node-proposition RICHNESS, not framing. Feeding the
matched node's bare label recovers a false `entailment` on an inversion (the model
latches onto the shared topic); feeding the full `label + Core description` — whose
explicit contrast ("Not Adapted Old Ones … rather than adapted existing laws") the
bare label drops — recovers `contradiction` and catches the inversion. (An earlier
"framing-sensitivity" claim, t/2744#2, was confounded: those two probes differed in
BOTH framing and node richness. A clean 2x2 shows framing is INERT.) The mapping,
thresholds, and node-text expectation therefore live here and nowhere else — a
wrapper that passes a terser node_prop is exactly how one runtime regresses
unnoticed, so all wrappers MUST pass the fullest `label + Core` (see RECALL BOUNDARY).
POV framing is retained (harmless, and it normalizes both sides) but is not the lever.

Reuses embed_taxonomy.py's deberta driver (`_load_nli_model`,
`_classify_pairs_nli`) so the raw model + margin gate are single-sourced too;
the `nli-classify` subcommand there is left untouched for Find-SituationCandidates.

SUBPROCESS CONTRACT
  stdin  JSON: [{"id"?, "claim_prop", "node_prop", "claim_pov"?, "node_pov"?}]
  stdout JSON: [{"id", "direction", "confidence", "method",
                 "nli_label", "framed_a", "framed_b"}]
  direction in {agrees, opposes, unrelated, unresolved}
  confidence = NLI top-1 vs top-2 logit margin (best - second).

ASYMMETRIC OPPOSITION DETECTOR (CL ruling t/2751#3): on this two-position task the
deberta model reliably recovers *contradiction* but rates a genuine agreement
`neutral`, not `entailment` (a label fact, not a threshold to tune). So this gate's
load-bearing signal is `opposes`; callers demote/flip ONLY on `opposes`. `agrees` /
`unrelated` / `unresolved` all mean "no opposition detected" and the caller KEEPS
its edge. The gate never confirms agreement.

RECALL BOUNDARY (t/2744#7): the gate UNDER-catches — it can only return `opposes`
when the node_prop is rich enough to carry the asserted proposition's contrast.
Concrete floor: a node with an empty Core description falls back to label-only,
which is the guaranteed-MISS case (an inversion reads `agrees`/`entailment`, e.g.
+4.76 on the origin claim, so the wrong edge is KEPT). Claim-proposition specificity
matters too (a terse canonical proposition can read `neutral` where a fuller
attribution phrasing reads `opposes`). This is acceptable under the opposes-only
fail-safe (a miss never fabricates opposition), and it is OBSERVABLE: an all-`agrees`
/ all-`unresolved` run over rich inputs signals a degraded feed. Mitigation is on
the caller: pass the fullest `label + Core` node text (Encompasses/Excludes stripped).

FAIL-SAFE (load-bearing, t/2751#3 arm 3): any error, an empty proposition, or a
below-threshold margin resolves to `unresolved` — NEVER `opposes`. Because callers
only act on `opposes`, `unresolved` is safe (a missed inversion beats dropping
every edge). The gate must never FALSELY oppose.

Flags:
  --tau-contra FLOAT   Margin floor (best-second) to emit `opposes`; below it ->
                       unresolved. Default 1.0 (FINAL, CL t/2751#3 — catches the
                       t/2742 inversion at margin 1.2746; genuine agreements are
                       `neutral` so the false-oppose rate is structurally ~0). Do
                       not exceed ~1.4 (the real contradiction margin). Provenance
                       registered by CL in docs/metric-provenance-register.md.
  --tau-entail FLOAT   Margin floor to emit `agrees`. Default 0.0 = RESERVED/unused
                       (CL t/2751#3): `agrees` is informational only — no caller
                       acts on it — so it carries no floor.
  --no-framing         Bypass POV framing (feed raw props). Diagnostic only —
                       framing is inert on the verdict (t/2744#7), so this lets the
                       2x2 confirm framed vs unframed give identical results.
"""

import argparse
import json
import os
import sys

# Reuse the single deberta driver from embed_taxonomy (import-safe: it guards
# execution behind `if __name__ == "__main__"`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_MAX_STDIN_BYTES = 50 * 1024 * 1024

# FINAL thresholds (CL ruling t/2751#3). Margin = (best - second) logit gap.
# tau_contra 1.0 catches the t/2742 inversion (margin 1.2746) while genuine
# agreements read `neutral`, so the false-oppose rate is structurally ~0. Do NOT
# raise past ~1.4 (the real contradiction margin). Registered by CL in the
# metric-provenance-register. tau_entail is reserved/unused — `agrees` is
# informational only (no caller acts on it), so it carries no floor.
TAU_CONTRA_DEFAULT = 1.0
TAU_ENTAIL_DEFAULT = 0.0


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


def _direction_for(label, margin, tau_contra, tau_entail):
    """Map an NLI label + margin to a directional verdict (opposition detector).

    `opposes` is the only load-bearing verdict (callers act on it); it requires a
    contradiction label AND margin >= tau_contra. `agrees` is informational
    (tau_entail default 0.0 = no floor). Anything below the contradiction floor,
    or an unexpected label, is `unresolved` — never a false `opposes`.
    """
    if label == "contradiction" and margin >= tau_contra:
        return "opposes"
    if label == "entailment" and margin >= tau_entail:
        return "agrees"
    if label == "neutral":
        return "unrelated"
    return "unresolved"


def judge_direction(items, tau_contra=TAU_CONTRA_DEFAULT,
                    tau_entail=TAU_ENTAIL_DEFAULT, no_framing=False):
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
                    "direction": _direction_for(label, margin, tau_contra, tau_entail),
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
    parser.add_argument("--tau-contra", type=float, default=TAU_CONTRA_DEFAULT,
                        help="Margin floor to emit 'opposes' (default 1.0, final).")
    parser.add_argument("--tau-entail", type=float, default=TAU_ENTAIL_DEFAULT,
                        help="Margin floor to emit 'agrees' (default 0.0, reserved).")
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

    out = judge_direction(items, tau_contra=args.tau_contra,
                          tau_entail=args.tau_entail, no_framing=args.no_framing)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()

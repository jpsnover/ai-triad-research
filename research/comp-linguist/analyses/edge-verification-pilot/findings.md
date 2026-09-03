# Edge-Verification Pilot: FOL Prover vs NLI on Disputed Conflicts (t/3128)

**Ticket:** t/3128 (T8). **Depends on:** t/3127 (axiom module + prover, built here). **Status:** pilot complete; disposition below.

## What was built

- **t/3127 axiom module (z3):** the 5 flat-disjoint DOLCE-lite sorts (APO / NAFA / PER / ND / NASO) with pairwise disjointness, NO covering axiom, UNA over grounded `ent-*`/`term:` ids only, ZERO role sort-restrictions in v1, and modality kept out of the object logic behind a same-holder/same-attitude comparability filter. This is the exact TL t/3127#4 contract. Code: `research/comp-linguist/tools/dolce_prover_pilot.py`.
- **Frame-incompatibility prover:** two neo-Davidsonian frames become z3 assertions; the two events are identified only when the frames share a predicate and the same grounded argument bindings (the single reification-identity the incompatibility conjecture needs, since reified events otherwise never unify). Opposite polarity on identified events then yields UNSAT, read as proved-incompatible. `z3-solver` is the local engine; Vampire/E via t/3231 is the container path. Smoke passes: `safe(x) ∧ ¬safe(x)` proves, different-predicate / different-entity / same-polarity refutes, and UNA keeps distinct entities apart.
- **Edge harness:** a disputed conflict (a conflict claim carrying both a `supports` and an `opposes` instance) is the edge. Both assertions are formalized (factual mode, ungrounded), run through the prover, and compared against an NLI baseline (LLM judge: does B contradict A?). The stance labels are the polarity gate the prover is measured against.

## Result (18 disputed conflicts)

| signal | distribution |
|---|---|
| prover | refuted 17, proved 1 |
| NLI | contradiction 10, neutral 7, entailment 1 |
| prover–NLI agreement | 9 / 18 = 0.50 |

The prover proved incompatibility on 1 of 18 edges. Every one of the 9 disagreements is prover-refuted vs NLI-contradiction: the prover under-fires relative to NLI, never the reverse (0 proved / NLI-neutral).

## Finding: the prover is sound but narrow (high precision, low recall)

- **Sound.** The single proved case is a genuine predicate-negation contradiction (`be` vs `¬be`), and the prover agrees with NLI there. The smoke suite confirms correctness, and the prover never false-fired on a non-contradiction.
- **Narrow.** Real opposing assertions use *different* predicates that are semantically but not syntactically contradictory: `require` vs `ban`, `filter` vs `create`, `find` vs `require`, `be` vs `purge`. The neo-Davidsonian prover, which by design (§7 reification, no lexical-semantic axioms) captures only direct predicate-negation, cannot bridge `require` against `ban`. So it misses the nine semantic oppositions the NLI catches.
- **Grounding gap.** Conflict instances are ungrounded document assertions, so their args are `lit:` (outside UNA, never identified). Even the same-predicate case (`measure` vs `measure`) refuted, because ungrounded args cannot match to force the contradiction. Entity-grounded claim pairs would let the prover fire on argument-level contradictions too.

## Disposition

- **t/3127 prover: works, stable, sound.** The axiom module and incompatibility check are correct and produce a clean, non-noisy signal. This completes the axiom half of t/3127 (the generator `frame_to_tptp.py` landed earlier).
- **For t/3128: the prover is a high-confidence complement to NLI, not a replacement.** When it proves incompatibility, that is a rigorous confirmation and can feed QBAF/Dung with high confidence. But NLI must stay the primary polarity gate, because it catches the semantic oppositions (`require` / `ban`) the formal prover cannot. The nine prover-refuted / NLI-contradiction cases are neither prover bugs nor NLI failures. They are the semantic-vs-syntactic gap: real contradictions that do not reduce to predicate-negation. That answers the ticket's "contingent on t/3127 showing stable signal": the signal is stable and sound, but its recall on free-text conflict edges is low, so it augments rather than replaces NLI.
- **Follow-up to raise recall (loosen-to-tight):** re-run on entity-grounded `claim_relations` once relation persistence lands (t/3170) so grounded args can force argument-level contradictions, and add a small lexical-antonym axiom set (e.g. `require ⊨ ¬ban`) only if a concrete check needs it. Track as a t/3128 follow-up.

## Reproduce

```
pip install z3-solver
python dolce_prover_pilot.py --smoke          # axiom module + prover self-test
GEMINI_API_KEY=… python dolce_prover_pilot.py --pilot 20   # edge pilot
```

Per-edge data in `edge_pilot.json`.

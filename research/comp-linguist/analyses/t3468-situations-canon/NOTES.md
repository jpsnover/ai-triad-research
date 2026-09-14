# t/3468 — Situations-canonicalization: derivation notes & lessons

Companion to `frozen_edits.json` (generator: scratchpad `gen_situations_canon.py`, committed here as `gen_situations_canon.py`). CL-drafted, SO PROCEED (e/159#2), TL co-sign + second-agent PASS (t/3468#10/#13-16, p/349#313/#315).

## node_scope uses ONLY the argumentation-role subset (load-bearing lesson)

`node_scope`'s declared enum has 7 values across two conceptual families:
- **argumentation-role:** `claim`, `scheme`, `bridging`
- **subject-breadth:** `narrow_technical`, `domain_specific`, `cross_domain`, `systemic`

**Situations (and, empirically, the pov corpus) populate `node_scope` only from the argumentation-role subset** — measured distribution across situations: `claim` 180 / `scheme` 143 / `bridging` 5, and **zero** breadth-scope uses. When re-deriving a `node_scope` for a node that lost its value (e.g. a misfiled `interpretive_lens`/`definitional`), pick from `{claim, scheme, bridging}` — do NOT reach for the breadth scopes. A framing / lens / "situation concept that describes X" node → `scheme` (an argumentative framework), not `systemic`/`cross_domain`.

This is *not* a record change: a corpus that uses a subset of a declared enum is legal (TL, p/349#315). It's a re-derivation convention. The v1 draft of this map wrongly re-derived 6 nodes (sit-117/118/201/235/236/237) to breadth scopes; TL's "confirm you weighed `scheme`" second-agent flag surfaced it as a wrong-sub-vocabulary error, corrected to `scheme` for all 6.

## epistemic_type re-derivation

Single-value re-derive from `interpretations` when the stored value was multi-valued (record type is `enum`, single) or a cross-field contaminant. Read the situation's *description* for its discourse type, not just the camp arguments: e.g. sit-061 "a situation that **explores the classification** of AI legal status" → `definitional`, even though the camps argue normatively downstream.

## Category / organizational nodes are enum-exempt

sit-170–174 (parent/category situations) legitimately lack claim-level enriched attributes. Per TL (skp-251 precedent) they are **blanked** (field absent, not a sentinel value) for `falsifiability`, `rhetorical_strategy`, `epistemic_type`, `audience`, `emotional_register`; `node_scope=scheme` is kept (a category *is* an organizational scheme). The record's situations `scope_note` documents this exemption.

## Canonical-adds folded into v4.0.0 (rare-keeps rule)

`audience += military_leaders, legal_professionals`; `rhetorical_strategy += reductio_ad_absurdum`. These are semantically distinct with no near neighbor (the t/3448 rare-keeps criterion); folding them as canonical is cheaper and truer than force-mapping. A future genuine cluster mints a clean MINOR add, not re-litigation.

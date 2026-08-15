# PREREG — t/1767 Phase 2b: Debate/Chat Entity-Extraction Prompt Variant

**Author:** Computational Linguist
**Date:** 2026-08-15
**Status:** Preregistered protocol. Decision rules and the hand-annotation below are fixed and
committed **before** any extractor output is read (instrument-effects discipline,
`docs/instrument-effects-review.md`; the same rule Phase 0 held itself to). Results section is
committed empty and filled only after the run.

## What this validates, and what it does not

Phase 0 (`analyses/PREREG-t1767-phase0.md`) validated the *mechanism* — statement-side extraction
recovers world-knowledge mentions from debate prose without minting universals — but on n=1
annotated mention with the **fact** instrument, and it surfaced one required change: a debate/chat
prompt variant must **exclude POV camp labels and speaker roles in its teaching text**, because the
fact instrument proposed `Safetyist`/`Skeptic`/`Accelerationist` as `person` entities (suppressed
only by the 0.6 gate — a systematic category error masked by a threshold). The design of record
(§9.4, §8) requires the variant to carry **its own preregistered validation before its numbers are
trusted in production**. This protocol is that validation.

Instrument under test: `designs/entity-extraction-debate-variant.md`, SHA-256 prefix
`bc6653b095dd3a12` (full text locked at that hash). It adds, over the fact instrument, an explicit
camp-label/speaker-role exclusion, a cited-source-title exclusion, and a `{{speaker}}` camp line.

**This validates the instrument's error rate on real debate prose. It does NOT validate the
production wiring** (async entry-add, container geometry, resolution table, curation inflow) — those
are separate Phase 2b tickets this instrument gates.

## Design (two arms, same inputs)

- **VARIANT arm:** the locked debate instrument (`bc6653b095dd3a12`).
- **CONTROL arm:** the shipped `enrichment.entity-extraction` fact instrument systemMessage
  verbatim (no camp/role/source exclusions), same model/temperature/schema, applied to the same
  statements. The control exists to demonstrate the variant's teaching text does work the confidence
  gate was doing — the camp-label failure Phase 0 found.
- **Model/params (both arms):** `claude-sonnet-4-6`, temperature 0.1, jsonMode, maxTokens 2000 —
  the production entity-extraction settings.
- **Gate:** 0.6 confidence (the Phase 0 gate; a stipulated threshold, registered in
  `metric-provenance-register.md`).

## Locked sample (n = 10 debater statements)

Held-out from two debates (source: `../ai-triad-data/debates/`), debater turns only (no
system/fact-check/gap-analysis turns). Identified by `<debate-prefix>#<turn-id-prefix>`. Full texts
frozen in `analyses/p2b-t1767/sample_statements.json`.

| # | id | camp | note |
|---|---|---|---|
| 1 | 2306fafc#5f8be326 | skeptic | zero-entity probe (only a paper title + a place-metonym + orgs) |
| 2 | 2306fafc#3c016066 | skeptic | President Trump; EU AI Act; a Dec-2025 executive order |
| 3 | 2306fafc#d5ff16bf | accelerationist | zero-entity probe (only Stripe=org + an arXiv paper) |
| 4 | 2306fafc#d962db00 | skeptic | EU AI Act; **camp-label "the Safetyist"** |
| 5 | 2306fafc#fddc841e | safetyist | Boeing 737 MAX; MCAS |
| 6 | 2306fafc#c79ec266 | skeptic | AI Action Plan (Jul 2025); S&P 500; orgs Google/Meta/OpenAI/Anthropic |
| 7 | 2306fafc#2095442a | accelerationist | OpenAI o1; GPT-4o; U.S. CHIPS (Act) |
| 8 | a0eaaca9#82113a5d | accelerationist | GDPR; orgs EU/Meta/Irish DPC |
| 9 | a0eaaca9#ec612d7c | skeptic | Latanya Sweeney; **camp-label "the Accelerationist"** |
| 10 | a0eaaca9#3c0909b1 | safetyist | Latanya Sweeney; **camp-labels "the Accelerationist","the Skeptic"** |

## Locked hand-annotation (CL judgment, from reading the prose, pre-run)

Ontology basis (`designs/entity-ontology-proposal.md` §2): an entity is a **particular** of type
person | artifact | event | legislation | institution. Organizations → `org_mentions` (not entity
proposals). Universals, cited-source titles, camp labels, and role nouns are **not** entities.

### CORE gold entity mentions (coverage denominator = 10)

| id | mention | type |
|---|---|---|
| 3c016066 | President Trump | person |
| 3c016066 | EU AI Act | legislation |
| d962db00 | EU AI Act | legislation |
| fddc841e | Boeing 737 MAX | artifact |
| fddc841e | MCAS | artifact |
| 2095442a | o1 (OpenAI o1) | artifact |
| 2095442a | GPT-4o | artifact |
| 82113a5d | GDPR | legislation |
| ec612d7c | Latanya Sweeney | person |
| 3c0909b1 | Latanya Sweeney | person |

### BORDERLINE gold (counts as CORRECT if proposed; NOT required for coverage)

Specific-but-loosely-named legislative/institutional particulars: `3c016066` Trump Dec-2025
executive order (legislation); `c79ec266` AI Action Plan Jul-2025 (legislation); `2095442a` U.S.
CHIPS Act (legislation); `c79ec266` S&P 500 (institution/index). Proposing any of these is not a
precision error; missing them is not a coverage failure.

### Must-NOT-appear (the discriminating check)

Camp labels / speaker roles that read as proper names but are camps, not entities:
- `d962db00`: "the Safetyist"
- `ec612d7c`: "the Accelerationist"
- `3c0909b1`: "the Accelerationist", "the Skeptic"

Role nouns ("the deployer", "regulators", "policymakers", "technology executives") anywhere in the
sample are likewise non-entities.

### Cited-source titles present (must NOT be proposed as entities)

e.g. "AI chatbots and digital companions are reshaping emotional connection", "AI Agents and the
Law", "Artificial Intelligence Index Report 2025", "State of AI in the Enterprise: The untapped
edge", "Constructing AI Speech". These are source references, not particulars.

### Organizations present (belong in `org_mentions`, not `proposals`)

Google, Meta, OpenAI, Anthropic, Goldman Sachs, Stripe, EU, Irish Data Protection Commission (an
agentive agency). Proposing any of these under `proposals` is a type error (counts against
precision); listing them under `org_mentions` is correct and out of scope for the entity-precision
count.

## Decision rules (FIXED before the run)

The VARIANT is **VALIDATED** iff ALL of:

1. **Coverage** ≥ 0.80 of the 10 CORE gold mentions proposed at or above the 0.6 gate (≥ 8/10).
2. **Precision** ≥ 0.80 of gated VARIANT proposals are real, correctly-typed particulars.
   Core-gold and borderline-gold count correct; an org proposed under `proposals`, a universal, a
   cited-source title, a camp label, or a mis-typed particular counts wrong.
3. **Vocabulary boundary** — **0** gated proposals that are dictionary universals / bare contested
   vocabulary (`risk`, `oversight`, `alignment`, `model weights`, `compliance`, …).
4. **Camp-label / speaker-role exclusion (DISCRIMINATING)** — **0** gated proposals that are POV
   camp labels or speaker/role nouns, AND the variant emits **strictly fewer RAW (pre-gate)**
   camp-label proposals than the control. The second clause is the value demonstration: the
   exclusion must live in the teaching text, not the threshold.
   - *Conditional:* if the CONTROL emits 0 raw camp-label proposals on this sample, the systematic
     error did not reproduce here; the second clause is reported **inconclusive** (not failed), the
     first clause (0 gated camp labels in the variant) still governs, and the limitation is stated.
5. **Resolution** — **0** wrong links. A gated proposal is checked by exact/alias match against
   `entities.json` (approved) ∪ `organizations.json`; a proposal resolving to the wrong existing
   referent is a wrong link. Unmatched high-confidence proposals are **curation candidates**, not
   errors (the designed behavior for a genuinely new entity).

**Failure disposition (no goalpost moves):** if rule 1 fails, statement-side extraction under this
variant under-covers debate prose and the yield is reported as-is. If rule 2/3 fails, the variant
over-proposes and needs a further revision (separately preregistered). If rule 4's hard clause fails
(a camp label survives the gate), the variant does **not** fix the error it was built to fix and is
rejected. Every outcome is reported as measured.

## Predictions (recorded before the run, non-gating)

- Control emits ≥ 1 raw camp-label proposal (likely `person`), reproducing the Phase 0 finding at
  larger n; variant emits 0 (or strictly fewer).
- Control proposes ≥ 1 cited-source title and/or ≥ 1 organization under `proposals`; variant
  suppresses both by its added teaching.
- Variant coverage ≥ 8/10; the two zero-entity probes yield 0 gated proposals under the variant.

## Artifacts (written on run)

`analyses/p2b-t1767/`: `sample_statements.json` (locked input), `run_variant.json`,
`run_control.json` (raw extractor outputs, both arms), `score.py` (mechanical scorer),
`scores.json` (computed table). The harness is a throwaway out-of-band caller — **no production
change**, exactly as Phase 0 ran.

## Results (run of 2026-08-15; protocol committed empty at `b17cfd84` before the run)

Both arms ran on `claude-sonnet-4-6`, temp 0.1, over the locked 10 statements. Raw outputs:
`run_variant.json`, `run_control.json`. Scorer: `score.py` → `scores.json`. Resolution vs the live
`entities.json` (78) ∪ `organizations.json` (44 names).

### Verdict against the fixed rules

| Rule | Threshold | Result | Verdict |
|---|---|---|---|
| 1. Coverage of 10 core gold | ≥ 0.80 | **1.00** (10/10 proposed at/above gate) | **PASS** |
| 2. Precision of gated variant proposals | ≥ 0.80 | **0.765** (13/17) | **FAIL** |
| 3. Universals gated | 0 | **0** | **PASS** |
| 4a. Camp labels / roles gated (variant) | 0 | **0** (and 0 raw, any confidence) | **PASS** |
| 4b. Variant raw camp < control raw camp | strict < | control raw = **0** | **INCONCLUSIVE** |
| 5. Wrong links | 0 | **0** (6 correct links, 9 curation candidates) | **PASS** |

**Preregistered verdict: NOT VALIDATED (v1 of the debate variant).** Failed axis: Rule 2 (precision).
Per the failure disposition (no goalpost moves), this is reported as measured and the variant needs
one more separately-preregistered revision before production.

### What passed, and strongly

- **Coverage 1.00.** All 10 core world-knowledge particulars were proposed at high confidence
  (Donald Trump 0.97, EU AI Act 0.98/0.97, o1 0.95, GPT-4o 0.95, GDPR 0.99, MCAS 0.80, Latanya
  Sweeney 0.97/0.98) — plus all four borderline items (Trump EO 0.72, AI Action Plan 0.85, CHIPS
  Act 0.82, S&P 500 0.60). Statement-side extraction reaches debate mentions the facts alias-table
  cannot, confirming Phase 0's mechanism at n=10.
- **Both zero-entity precision probes returned 0 gated proposals** under the variant.
- **Vocabulary boundary clean:** zero universals/contested vocabulary gated, on prose dense with
  "risk", "oversight", "model weights", "compliance".
- **Resolution: 0 wrong links.** 6 of 17 gated proposals correctly resolved to *existing* entities
  (ent-032 Trump, ent-023 o1, ent-024 GPT-4o, ent-048 CHIPS, ent-071 GDPR, ent-076 AI Action Plan)
  — a live demonstration that the retroactive-linking path (§7) would attach these debate mentions
  to the curated store. The other 9 are genuine new curation candidates.

### Why Rule 2 failed — the one actionable finding

4 of 17 gated proposals were errors, and **3 of the 4 are organization/agency leakage into the
`proposals` channel** — the exact boundary the variant's teaching tried to hold:

| proposal | conf | error | note |
|---|---|---|---|
| `Stripe` [artifact] | 0.62 | org in proposals | **also** listed under `org_mentions` — double-channelled, not omitted |
| `Ireland's Data Protection Commission` [institution] | 0.85 | agentive agency typed `institution` | routed to proposals, NOT org_mentions |
| `Irish Data Protection Commission` [institution] | 0.92 | same, second statement | consistent error, not noise |
| `AI Action Plan` [artifact] | 0.85 | mis-typed (policy plan ≠ AI tool) | resolution-absorbed → links to ent-076, so downstream-harmless |

The dominant, non-absorbed failure mode is **the organization-vs-institution genus-differentia
boundary**: a named regulator (a *data-protection commission*) reads to the model as a "named
framework-institution" and is proposed as an `institution` entity rather than routed to
`org_mentions`. The variant's one-line rule ("a named government agency that acts … is an
organization") did not carry against the surface pull of the noun phrase, and it did so
*consistently* (both DPC occurrences), so this is a systematic gap, not a stochastic miss — the same
class of finding Phase 0 made about camp labels.

**Verdict sensitivity, disclosed:** the fail hinges partly on counting the resolution-absorbed
`AI Action Plan` mis-type as an error (the locked rule 2 does: "a mis-typed particular counts
wrong"). Under a resolution-aware lenient reading that exempts it, precision is 14/17 = **0.824**
(a marginal pass). The verdict is reported by the **locked strict rule** (NOT VALIDATED); either way
the organization/agency leakage (3 errors) is the material, actionable defect.

### Rule 4 is inconclusive, and why (a design limitation, stated as a limit)

The camp-label check has two clauses. The hard clause **passed**: the variant emitted **zero** camp
labels, gated or raw. But the value-demonstration clause is **inconclusive**, because the CONTROL
(fact instrument) *also* emitted zero raw camp labels on this sample — so the systematic error
Phase 0 found at n=3 did not reproduce here, and the variant's teaching-text suppression could not
be shown to add differential value.

The likely cause is a **confound I preregistered as a risk**: for single-variable purity both arms
received the identical user message, which included a `Speaker camp: <camp>` line. That line
plausibly primes *both* arms away from reifying camps as persons — masking the very effect the
variant targets. The clean test strips the camp hint from the user message so the system-prompt
exclusion is the only camp signal. That is a required arm in the revision run below.

### Required revision (v2, separately preregistered before its numbers are trusted)

1. **Sharpen the organization/institution boundary.** Give the agency-vs-framework test explicitly
   with the DPC as a worked negative example ("a data-protection commission, an agency, a regulator
   *acts* → org_mentions; reserve `institution` for a non-agentive framework such as a named treaty
   regime or 'common law'"). Add a tie-break: **if in doubt between organization and institution,
   route to `org_mentions`.**
2. **Guard the `artifact` type** so a named policy/plan/act is never `artifact` (it is `legislation`
   or `institution`).
3. **Re-run the camp-label arm without the shared `Speaker camp:` user hint**, so Rule 4b can
   actually resolve.

### Caveats (limits, not hedges)

n = 10 statements from 2 debates, single model, single scoring pass by the author. This validates
the instrument's *behavior class* on real argumentative prose — strong coverage, clean vocabulary
boundary, clean camp-label suppression, but a real organization/agency-leakage defect — not a
production error rate. The confidence gate (0.6) remains a **stipulated** threshold
(`metric-provenance-register.md`). No production artifact changed: the run is out-of-band, exactly
as Phase 0 ran.


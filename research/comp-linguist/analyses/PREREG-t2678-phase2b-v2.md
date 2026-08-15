# PREREG — t/2678 Phase 2b v2: Debate/Chat Entity-Extraction Prompt Variant (revision)

**Author:** Computational Linguist
**Date:** 2026-08-15
**Status:** Preregistered protocol. Decision rules and the hand-annotation below are fixed and
committed **before** any extractor output is read (instrument-effects discipline,
`docs/instrument-effects-review.md`). Results section is committed empty and filled only after the
run. This is the **v2** validation required by the v1 failure disposition
(`analyses/PREREG-t1767-phase2b.md`): v1 was NOT VALIDATED (precision 0.765 < 0.80).

## What this validates, and what it does not

The v1 debate instrument (`bc6653b095dd3a12`) passed coverage (1.00), vocabulary boundary (0),
gated camp-labels (0), and resolution (0 wrong links) but **failed precision at 0.765 (13/17)**.
Three of the four errors were one boundary: a named regulator (Ireland's Data Protection
Commission, twice) typed `institution` instead of routed to `org_mentions`; the fourth was
`AI Action Plan` mis-typed `artifact` (`Stripe` was the remaining error — an org double-channelled
into `proposals`). v1's locked failure disposition prescribed exactly two teaching-text changes and
one methodological fix; v2 makes those and nothing else.

Instrument under test: `designs/entity-extraction-debate-variant.md` (v2), SHA-256 prefix
**`a33196dc529b28c4`** (full text locked at that hash; frozen at
`analyses/p2b-t2678-v2/variant_system.txt`). Over v1 it changes:

1. **Organization/institution genus-differentia sharpened** — agentive-vs-non-agentive test given
   explicitly, DPC as a worked negative example, `institution` reserved for non-agentive
   frameworks/regimes only, tie-break "route to org_mentions when unsure".
2. **`artifact`-type guard added** — a named policy/plan/act/order is never `artifact`
   (→ `legislation`, or `institution` for a non-agentive framework).

Everything else in the systemMessage is byte-identical to v1 (single-variable revision on the type/
channel-boundary axis). **This validates the instrument's error rate on real debate prose. It does
NOT validate production wiring** (async entry-add, container geometry, resolution table, curation
inflow) — those remain the separate Phase 2b tickets this instrument gates.

## Design (four arms, same locked inputs)

Same frozen 10-statement sample as v1 (`analyses/p2b-t2678-v2/sample_statements.json`, a byte copy
of the v1 sample) so v1↔v2 are directly comparable. Model/params identical to production
entity-extraction and to v1: `claude-sonnet-4-6`, temperature 0.1, jsonMode, maxTokens 2000. Gate
0.6 (the Phase 0 stipulated threshold, registered in `metric-provenance-register.md`).

- **`variant_hint`** — v2 locked instrument (`a33196dc529b28c4`), user message WITH the
  `Speaker camp: <camp>` line. **Production-faithful** (the camp line is load-bearing by design and
  ships in production). **Governs Rules 1, 2, 3, 4a, 5.**
- **`control_hint`** — shipped `enrichment.entity-extraction` fact-instrument systemMessage
  verbatim, WITH the camp line. Continuity with the v1 control.
- **`variant_nohint`** — v2 locked instrument, camp line **stripped** from the user message.
- **`control_nohint`** — fact instrument, camp line **stripped**.

**Rule 4b (value demonstration) is judged on the clean no-hint pair** (`variant_nohint` vs
`control_nohint`). v1's 4b was inconclusive because the shared camp line plausibly primed *both*
arms away from camp reification (control_hint raw camp = 0). Stripping it makes the system-prompt
camp exclusion the only camp signal, so a differential — if the systematic error reproduces at all
— can surface.

## Locked sample (n = 10 debater statements)

Byte-identical to the v1 sample (`analyses/p2b-t1767/sample_statements.json`). Held-out debater
turns from two debates (`../ai-triad-data/debates/`), identified `<debate-prefix>#<turn-id-prefix>`.

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

## Locked hand-annotation (CL judgment, from reading the prose — identical to v1)

Ontology basis (`designs/entity-ontology-proposal.md` §2): an entity is a **particular** of type
person | artifact | event | legislation | institution. Organizations → `org_mentions`. Universals,
cited-source titles, camp labels, role nouns are **not** entities. The gold is unchanged from v1 —
same sample, same ontology; only the instrument was revised.

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

### BORDERLINE gold (counts CORRECT if proposed; NOT required for coverage)

`3c016066` Trump Dec-2025 executive order (legislation); `c79ec266` AI Action Plan Jul-2025
(legislation); `2095442a` U.S. CHIPS Act (legislation); `c79ec266` S&P 500 (institution/index).
Proposing any is not a precision error; missing any is not a coverage failure. **Note for v2:** the
`artifact` guard should now type AI Action Plan and CHIPS Act as `legislation` — a `legislation`
typing is correct-and-borderline (counts correct); an `artifact` typing is a precision error (as in
v1).

### Must-NOT-appear (the discriminating check)

Camp labels / speaker roles that read as proper names: `d962db00` "the Safetyist"; `ec612d7c` "the
Accelerationist"; `3c0909b1` "the Accelerationist", "the Skeptic". Role nouns ("the deployer",
"regulators", "policymakers", "technology executives") anywhere are likewise non-entities.

### Cited-source titles present (must NOT be proposed as entities)

"AI chatbots and digital companions are reshaping emotional connection", "AI Agents and the Law",
"Artificial Intelligence Index Report 2025", "State of AI in the Enterprise: The untapped edge",
"Constructing AI Speech", etc. Source references, not particulars.

### Organizations present (belong in `org_mentions`, not `proposals`)

Google, Meta, OpenAI, Anthropic, Goldman Sachs, Stripe, EU, **Irish Data Protection Commission (an
agentive agency)**. Proposing any under `proposals` is a type error (against precision); listing
under `org_mentions` is correct and out of scope for the entity-precision count. The DPC is the
worked case v2 targets: it must appear in `org_mentions`, never as an `institution` proposal.

## Decision rules (FIXED before the run)

Read from **`variant_hint`** unless a rule names another arm. The VARIANT is **VALIDATED** iff ALL:

1. **Coverage** ≥ 0.80 of the 10 CORE gold mentions proposed at/above the 0.6 gate (≥ 8/10).
2. **Precision** ≥ 0.80 of gated `variant_hint` proposals are real, correctly-typed particulars.
   Core-gold and borderline-gold count correct; an org under `proposals`, a universal, a cited-
   source title, a camp label, or a mis-typed particular counts wrong. *(This is the axis v1
   failed; the v2 target.)*
3. **Vocabulary boundary** — **0** gated proposals that are dictionary universals / bare contested
   vocabulary.
4. **Camp-label / speaker-role exclusion (DISCRIMINATING):**
   - **4a (hard):** **0** gated `variant_hint` proposals that are POV camp labels or speaker/role
     nouns.
   - **4b (value demonstration):** on the **no-hint pair**, `variant_nohint` emits **strictly
     fewer RAW (pre-gate)** camp-label proposals than `control_nohint`.
     - *Conditional:* if `control_nohint` emits 0 raw camp-label proposals, the systematic error did
       not reproduce even with the confound removed; 4b is reported **inconclusive** (not failed),
       4a still governs, and the limitation is stated as a genuine null (the v1 confound is now
       removed, so a null here is stronger evidence than v1's).
5. **Resolution** — **0** wrong links. A gated proposal is checked by exact/alias match against
   `entities.json` (approved) ∪ `organizations.json`; a proposal resolving to the wrong existing
   referent is a wrong link. Unmatched high-confidence proposals are **curation candidates**, not
   errors.

**Failure disposition (no goalpost moves):** if rule 2 still fails, the org/institution boundary or
artifact guard did not carry and the variant needs a further separately-preregistered revision,
reported as measured. If rule 1 fails, statement-side extraction under-covers, reported as-is. If
4a fails (a camp label survives the gate), the variant is rejected. Every outcome reported as
measured. **The precision verdict is reported by the locked strict rule** (a mis-typed particular
counts wrong) — the same rule v1 was judged by; no lenient re-reading substitutes for it.

## Predictions (recorded before the run, non-gating)

- The DPC now appears under `org_mentions` in `variant_hint`, not as an `institution` proposal;
  `Stripe` is not under `proposals`; `AI Action Plan` (if proposed) is typed `legislation`, not
  `artifact`. → precision ≥ 0.80.
- Coverage stays ≥ 8/10 (the guards are exclusionary, not coverage-affecting).
- 0 gated universals, 0 gated camp labels in `variant_hint`.
- No-hint pair: `control_nohint` may reproduce ≥ 1 raw camp label (Phase 0 finding, confound
  removed); `variant_nohint` emits 0 (or strictly fewer). Result reported either way.

## Artifacts (written on run)

`analyses/p2b-t2678-v2/`: `sample_statements.json` (locked input, byte copy of v1),
`variant_system.txt` (locked v2 instrument, `a33196dc529b28c4`), `run_variant_hint.json`,
`run_control_hint.json`, `run_variant_nohint.json`, `run_control_nohint.json` (raw outputs),
`run_extraction.py` (four-arm caller), `score.py` (mechanical scorer), `scores.json` (computed
table). Throwaway out-of-band harness — **no production change**, exactly as v1 and Phase 0 ran.

## Results (run of 2026-08-15; protocol committed empty at `c23189ea` before the run)

All four arms ran on `claude-sonnet-4-6`, temp 0.1, over the locked 10 statements. Raw outputs:
`run_variant_hint.json`, `run_control_hint.json`, `run_variant_nohint.json`,
`run_control_nohint.json`. Scorer: `score.py` → `scores.json`. Resolution: `resolve.py` vs the live
`taxonomy/Origin/entities.json` (78 rows / 134 labels) ∪ `organizations.json` (25 names).

### Verdict against the fixed rules

| Rule | Threshold | v1 | v2 result | Verdict |
|---|---|---|---|---|
| 1. Coverage of 10 core gold | ≥ 0.80 | 1.00 | **1.00** (10/10 at/above gate) | **PASS** |
| 2. Precision of gated `variant_hint` proposals | ≥ 0.80 | 0.765 | **1.00** (13/13) | **PASS** |
| 3. Universals gated | 0 | 0 | **0** | **PASS** |
| 4a. Camp labels / roles gated (`variant_hint`) | 0 | 0 | **0** (and 0 raw, any conf) | **PASS** |
| 4b. `variant_nohint` raw camp < `control_nohint` raw camp | strict < | inconclusive | `control_nohint` raw = **0** | **INCONCLUSIVE** |
| 5. Wrong links | 0 | 0 | **0** (6 correct links, 7 candidates) | **PASS** |

**Preregistered verdict: VALIDATED (v2 of the debate variant).** Every hard rule passes; Rule 4b is
inconclusive per its preregistered conditional (not a failure). Precision improved from the v1
failure (0.765) to **1.00** — the two targeted teaching-text changes closed exactly the boundary
that failed.

### The v1 precision failure is closed

All three v1 organization/agency-leakage errors and the artifact mis-type are gone:

| v1 error (gated) | v2 outcome |
|---|---|
| `Ireland's Data Protection Commission` [institution], 0.85 | **fixed** — appears only under `org_mentions` (`82113a5d`), not proposed |
| `Irish Data Protection Commission` [institution], 0.92 | **fixed** — the DPC statement gates exactly one proposal (`GDPR`); no institution proposal |
| `Stripe` [artifact], 0.62 | **fixed at the gate** — v2 still emits `Stripe` [artifact] but at **0.55 < 0.6**, so it does not gate (also correctly in `org_mentions`); see residual below |
| `AI Action Plan` [artifact], 0.85 | **fixed** — now typed **`legislation`** 0.82, resolves to ent-049 |

The sharpened genus-differentia moved the DPC decision off the surface noun ("commission" reading as
a framework-institution) and onto "does it act?" — and the DPC was routed to `org_mentions` on the
only statement it appears in. The `artifact` guard re-typed the policy plan to `legislation`. Both
held on the single sample they had to hold on.

### What passed, and how strongly

- **Coverage 1.00** — all 10 core particulars gated at high confidence (Donald Trump 0.97, EU AI Act
  0.97×2, o1 0.95, GPT-4o 0.95, GDPR 0.99, MCAS 0.92, Boeing 737 MAX 0.95, Latanya Sweeney
  0.97/0.98), plus all four borderline items (Trump EO 0.82, AI Action Plan 0.82, CHIPS Act 0.82,
  and — this run — no S&P 500 proposal, which is not a coverage failure). The guards are
  exclusionary and did not cost coverage, as predicted.
- **Precision 1.00 (13/13).** All 13 gated `variant_hint` proposals are real, correctly-typed
  particulars (7 core-gold, 3 borderline-gold as `legislation`, plus the two Sweeney person
  mentions and both EU AI Act mentions). See the adjudication note on the scorer below.
- **Vocabulary boundary clean** — 0 gated universals on prose dense with "risk", "oversight",
  "model weights", "compliance".
- **Resolution: 0 wrong links.** 6 of 13 gated proposals correctly resolved to *existing* entities
  (ent-032 Donald Trump, ent-049 AI Action Plan, ent-023 o1, ent-024 GPT-4o, ent-048 CHIPS Act,
  ent-071 GDPR) — every link to the correct referent. The other 7 are genuine new curation
  candidates (EU AI Act ×2, Trump EO, Boeing 737 MAX, MCAS, Latanya Sweeney ×2). This is the
  designed retroactive-linking behavior.

### Rule 4b: inconclusive again — but a stronger null

The clean no-hint test was built to remove the v1 confound (the shared `Speaker camp:` line priming
both arms away from camp reification). With the hint stripped, **`control_nohint` still emitted 0 raw
camp-label proposals** — so the systematic camp-as-person error Phase 0 found at n=3 does **not**
reproduce on this n=10 sample even when the confound is removed. Rule 4a passed decisively (the
variant emits 0 camp labels, gated or raw, hinted or not), so the variant demonstrably *does no harm
and holds the hard gate*; but its **differential** value over the fact instrument on camp labels
remains unproven on this sample. This is a stronger null than v1 (the confound is now excluded, not
merely suspected). If Phase 0's finding is to be reproduced as a differential, it needs statements
where a camp label sits in bare subject position without an adjacent `Speaker camp:` cue — a
targeted sample this held-out set did not contain. Recorded as a limitation, not a hedge.

### Residuals and adjudications (disclosed)

1. **Stripe still double-channels below the gate.** `variant_hint` emits `Stripe` as `artifact`
   0.55 *and* lists it under `org_mentions`. The 0.6 gate drops it, so it is precision-clean, but
   the model's residual pull to also mint Stripe as an artifact persists — a lower gate would leak
   it. The org paragraph names regulators/commissions explicitly but not payment companies typed as
   "tools"; this is a known soft edge, not a rule failure. Not worth a further teaching change on
   n=1 sub-gate evidence; flagged for the production monitoring the wiring tickets add.
2. **Scorer false-positive on Boeing 737 MAX.** `score.py`'s substring `classify()` flags
   `Boeing 737 MAX` as `ORG-in-proposals` because `boeing` is in the ORG list. Per the locked gold
   this is a **core `artifact`** (an aircraft; Boeing the company is correctly separate in
   `org_mentions`). Adjudicated correct — this is the "ambiguous residual printed for adjudication"
   the scorer header anticipates, not a silent override. It is the only scorer flag in the run; the
   13/13 precision holds without it.

### Caveats (limits, not hedges)

n = 10 statements from 2 debates, single model, single scoring pass by the author, same frozen
sample as v1 (so v1→v2 is a controlled instrument comparison, but not a fresh-sample generalization).
This validates that the two targeted teaching changes **close the v1 boundary defect** and cost no
coverage — a within-sample confirmation, not a production error rate. The 0.6 gate remains a
**stipulated** threshold (`metric-provenance-register.md`). No production artifact changed: the run
is out-of-band, exactly as v1 and Phase 0 ran. Landing the instrument into `ai-usages.json` and the
production wiring remain the separate Phase 2b tickets this instrument gates.

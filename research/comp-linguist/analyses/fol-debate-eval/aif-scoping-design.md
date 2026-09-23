# AIF argument-level formalization of debate: scoping design (t/3355)

**Author:** Computational Linguist
**Status:** scoping deliverable. Go/no-go resolved to **GO** (owner decision, p/314). This document defines the approach and spawns the build tickets; it is **not** production code and changes no live prompt, schema, or metric.
**Evidence base:** `fol-debate-sample-findings.md` (this dir); 3 observed sessions, 27 turns, single-annotator first-pass.
**Governing principle:** *vocabulary over formalism* (CL `docs/ontology-reference.md`). AIF is used as **JSON + prompt vocabulary**, never OWL/RDF triples or a reasoner.

---

## 0. Why AIF (the one-paragraph case)

The debate's late-round turns carry an explicit belief-revision scaffold (*"I conditionally agree / I still hold / I would change if <defeater>"*), plus cross-agent attacks on shared predicates (findings §c, bonus finding). That is **argument structure**, and the two headline metrics (`crux_addressed_rate`, `convergence_score`) are questions *about* that structure. Claim-level neo-Davidsonian FOL formalizes each assertion in isolation and cannot see the concession, the defeater, or the direction of attack. AIF encodes exactly those. The two are complementary: FOL stays the tool for the ~60% assertoric-factual subset and summary-corpus linking, while AIF is the tool for the dialectical structure.

---

## 1. AIF vocabulary subset (scope item 1)

Core AIF has I-nodes (information/claims) and S-nodes (scheme applications: RA inference, CA conflict, PA preference). We adopt a **minimal subset**, expressed as JSON objects with a controlled `type` vocabulary. We exclude L-nodes and full dialogical AIF+ as scope creep into formalism.

| AIF element | Adopt? | Our JSON `type` | Meaning in debate |
|---|---|---|---|
| **I-node** | ✅ | `claim` | A proposition a debater asserts (one per assertoric clause). |
| **CA-node** (Conflict) | ✅ | `conflict` | An attack between two I-nodes. Carries `attacker`, `target`, `status` (`active` \| `latent`). **The crux lives here.** |
| **RA-node** (Inference) | ✅ (light) | `support` | One I-node supports/grounds another (incl. a concession granting an opponent's I-node). |
| **PA-node** (Preference) | ❌ this round | — | No clear debate signal in the sample; defer. |
| **L-nodes / TA / YA** (dialogical AIF+) | ❌ | — | Full locution/transition modelling is formalism creep. Rejected. |

**Node/edge JSON sketch** (illustrative, not a committed schema):
```
I-node:  { id, type:"claim", speaker, text, attributes:{ held:bool, attributed_to?:speaker } }
CA-node: { id, type:"conflict", attacker:I-id, target:I-id, status:"active"|"latent", condition?:I-id }
RA-node: { id, type:"support", from:I-id, to:I-id, concession:bool }
```

## 2. Mapping the observed scaffold moves to AIF (scope item 2)

The four moves the sample surfaced, mapped to the subset above:

| Observed move (findings) | AIF representation |
|---|---|
| **Conditional-agree / concession** ("I concede engagement optimization exists") | `RA/support` from the conceding speaker to the opponent's I-node, `concession:true`. A *partial* grant, not full agreement. |
| **Retained-hold** ("I still hold the harm is emergent") | The speaker's own I-node with `attributes.held:true`, a commitment that persists **despite** an incoming CA. |
| **Defeater-condition** ("I'd change if shown a code path targeting the harm") | A `CA/conflict` with `status:"latent"` whose `condition` points at the (hypothetical) triggering I-node. Latent means named-but-not-active; it becomes `active` if the condition's I-node is asserted and verified. **This is the convergence signal.** |
| **Attributed-restatement** ("Accelerationist proposes P, but…") | An I-node with `attributes.attributed_to`. **This is the anaphora-heavy sub-class (findings §b), and coreference/attribution resolution gates it**, the same dependency FOL hit. |

## 3. Cross-agent attack-edge extraction (scope item 3)

CA-nodes between turns are the load-bearing extraction. Approach:

1. **Segment + type** each turn into I-nodes (claims) and scaffold moves. This **shares t/3354's clause segmenter** (§5).
2. **Detect conflict** between agent A's and agent B's I-nodes. **Do not build fresh:** reuse the existing semantic-opposition classifier (fork-B, t/3302) that already populates `conflicts.json`'s 15 verified opposition edges (findings §67). A detected opposition on a shared predicate yields a CA-node.
3. **Attribution first.** Because the highest-value attacks are attributed-restatements (§b central tension), attribution/coreference resolution (t/3354 §6 coref stage) must run **before** CA extraction, or the attacker/target ids point at the wrong I-node.

**Key reuse insight:** the CA edge is the *same relation* as a `conflicts.json` semantic-opposition edge, viewed argument-side. This is the seam to Main PS's QBAF/conflict-corpus track, so loop them in at build (findings §67).

## 4. Feeding crux identification + evaluation (scope item 4)

**Crux = a CA-node (or cluster) that is cross-agent, sustained, and returned to across rounds.** Not every conflict is a crux; the crux is the conflict both sides keep defending.

Metric correspondence (this is why AIF may beat claim-level FOL):

- **`crux_addressed_rate`** asks "are debaters engaging the *real* disagreement?" For each candidate crux, does an **active CA-node link the two agents' I-nodes**, and is it answered (counter-CA or concession)? *Unaddressed* = two parallel I-nodes with **no CA between them**, i.e. talking past each other, which AIF makes structurally visible.
- **`convergence_score`** asks "are positions narrowing?" Track over rounds: concession `RA`-edges accumulating, `held` commitments dropping, and **latent CA `condition`s approaching satisfaction**. Convergence = resolution-proximity of the crux CA-node.

**Evaluation plan.** Correlate AIF-derived crux structure against the *existing* `crux_addressed_rate` / `convergence_score` on the same runs. **Prediction (testable):** AIF crux identification reduces the paraphrase false-negatives that sink claim-level FOL (findings §48, §65), because a CA edge is about the argumentative *relation*, not surface predicate matching. It still depends on the semantic-opposition detector for the I-node conflict, so the paraphrase risk is *reduced, not eliminated*; the eval must measure residual false-negative rate under paraphrase, not just raw crux counts.

**Provenance gate (load-bearing).** The sample is single-annotator first-pass. Before any AIF crux metric anchors a threshold, upgrade to a **double-annotated gold set** (CL metric-provenance discipline, findings §70). The build's first deliverable is that gold set, not the extractor.

## 5. Go/no-go + build decomposition (scope item 5)

**Decision: GO** (owner, p/314). The build shares t/3354's **segmenter** (reuse) and the t/3302 **semantic-opposition classifier** (reuse), and needs a **new AIF-move classifier** (concede/hold/defeater/attack/restate). The t/3354 classifier types assertoric-factual for FOL, a different target.

**Build tickets this scoping spawns:**

| # | Build item | Owner | Notes |
|---|---|---|---|
| B1 | Double-annotated AIF gold set (concession/hold/defeater/CA labels on the 27-turn sample + expansion) | **CL** | Provenance gate; must precede any metric anchor. |
| B2 | AIF-move classifier prompt + clause-move typing | **CL** authors prompt · **PS/DebateTool** wire extraction | Shares t/3354 segmenter. |
| B3 | Cross-agent CA-edge extraction (reuse t/3302 semantic-opposition) | **DebateTool / Shared Lib** · loop **Main PS** (conflict-corpus seam) | |
| B4 | AIF JSON structure (I/CA/RA node shapes) | **CL + TL co-sign** | **Data-model change, triggers the mandatory Second Opinion** (root AGENTS.md schema/data-model class) before it ships. |
| B5 | Crux-from-AIF + correlation vs `crux_addressed_rate`/`convergence_score` | **CL** | Evaluation; depends B1–B4. |

**Governance flags for the build (not this doc):**
- **Novel architecture:** B2–B5 route through **Main (TL)** design review before production code.
- **Data-model change (B4):** **mandatory Second Opinion** per root AGENTS.md; AIF node/edge shapes are a shared type contract.
- No live prompt/metric change lands without CL calibration validation (out of scope here, per the ticket).

---

## Summary

AIF is adopted as a minimal JSON+prompt vocabulary (I-node / CA-node / light RA-node; no PA, no dialogical AIF+). The concession/hold/defeater/attributed-restatement moves map cleanly onto it. Extraction reuses the t/3354 segmenter and the t/3302 semantic-opposition classifier, adding one new move-classifier. Crux = a sustained cross-agent CA-node; the two convergence metrics correspond directly to CA activity and latent-defeater proximity. Build is decomposed into B1–B5 with CL/TL/PS/DebateTool owners, gated by a double-annotated gold set and, for the data-model, the mandatory Second Opinion.

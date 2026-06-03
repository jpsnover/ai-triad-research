# Implementation Proposal: Character Value Hierarchies (REC-1) and Epistemic Identity (REC-2)

**Author:** Computational Linguist  
**Date:** 2026-06-01 (revised 2026-06-02 — grounded against `ai-triad-data` BDI weights; revised 2026-06-03 — Accelerationist hierarchy inverted per external feedback, Tier 2 reframed as offensive, epistemic stance extended; Safetyist hierarchy inverted per external feedback, precaution to Tier 1, epistemic stance extended with safety-proof trap and structural-limits probe; Skeptic Tier 3 replaced with Material grounding per external feedback, modified C2 applied, signature move expanded with structural audit; Accelerationist Tier 1 expanded with civilizational telos, epistemic stance refined with trend-extrapolation nuance, dual-register strongest move, institutional replacement)  
**Ticket:** t/326  
**Parent analysis:** `research/comp-linguist/docs/soul-documents-analysis.md`  
**Data basis:** `../ai-triad-data/taxonomy/Origin/{accelerationist,safetyist,skeptic}.json` (TAXONOMY_VERSION as of 2026-06-02)  
**Blocks:** t/322 (REC-1 implementation), t/323 (REC-2 implementation)

---

## 1. Design Principle

The soul document's most effective pattern is encoding *how* Claude reasons, not just *what* it should conclude. Our characters currently have strong *what* (taxonomy BDI nodes, doctrinal boundaries) but weak *how*. The result is characters that argue the right positions with generic reasoning patterns.

These two additions give each character:
- **Value hierarchy** (REC-1): an explicit 3-tier ordering for resolving internal tensions, modeled on Anthropic's Safety > Ethics > Guidelines > Helpfulness structure
- **Epistemic identity** (REC-2): a specification of how the character reasons under uncertainty, what evidence standards it applies, and its signature argumentative pattern

Together they answer: "When this character faces a hard choice, what does it prioritize and how does it reason through it?"

> **Revision note (2026-06-02).** This revision validates every value hierarchy and epistemic stance below against the actual BDI weights in `ai-triad-data`. The hand-authored hierarchies are **normative** (how a character *should* resolve tensions); the taxonomy weights are **descriptive** (what the character actually believes, wants, and intends, and how strongly). Where the two agree, the data is cited as supporting evidence. Where they diverge, the divergence is flagged as either (a) a deliberate corrective the prompt should enforce, or (b) a hierarchy that needs adjustment. See §1.5 for method and §2.4 for the consolidated findings.

---

## 1.5 Empirical Grounding in `ai-triad-data`

Each POV taxonomy carries three per-node weights, and they map one-to-one onto the BDI layers. This is the evidence base for grounding the value hierarchies and epistemic stances.

| BDI layer | Weight field | Scale | Semantics | Source of truth |
|---|---|---|---|---|
| **Beliefs** | `confidence` | 0.35–0.95 (continuous) | Epistemic certainty in the claim | `lib/debate/confidenceDedup.ts` (evolution) |
| **Desires** | `priority` | 1–5 (integer) | 5 = Core/doctrinal (non-negotiable), 4 = root goal, 3 = mid-tree, 2 = leaf, 1 = demoted | `lib/debate/desirePriority.ts` |
| **Intentions** | `operationality` | 1–5 (integer) | 5 = highly operational (concrete, falsifiable, situation-grounded), 1 = vague/theoretical framing | `lib/debate/intentionOperationality.ts` |

**Aggregate posture per character** (computed over all nodes, 2026-06-02):

| Character | Beliefs (n / mean conf / %≥0.90) | Dominant rhetoric | Dominant epistemic_type | Intentions (mean op / # op-5) |
|---|---|---|---|---|
| Accelerationist | 76 / **0.682** / 7% | `techno_optimism` + `inevitability_framing` | `strategic_recommendation` (66) | 3.58 / 6 |
| Safetyist | 121 / **0.751** / 17% | `precautionary_framing` (dominant) | `strategic_recommendation` (113) | 3.68 / 6 |
| Skeptic | 162 / **0.720** / 18% | `structural_critique` (dominant) | `empirical_claim` (92, highest) | 3.77 / 3 |

Two findings shape the rest of this document:

1. **The Accelerationist is the *least* epistemically certain character** (mean belief confidence 0.682, only 7% of beliefs at ≥0.90) and leans on `inevitability_framing`/`techno_optimism` rather than `appeal_to_evidence`. Its REC-1 tier-1 "Technological acceleration as civilizational progress" and tier-2 "Decentralized anti-monopoly access" are **descriptive** — they match the data's center of gravity (speed/iteration signals plus civilizational transformation Desires). Empirical discipline is positioned at tier 3 as a **corrective constraint**: the character cannot substitute ungrounded inevitability for evidence, but trend extrapolation is legitimate and the presumption favors deployment. The epistemic stance carries the heavier evidence-discipline load via its first and fifth bullets.
2. **No character has a priority-5 (Core/doctrinal) Desire.** The maximum observed `priority` is 4 in all three POVs. The value hierarchies assert "non-negotiable" tier-1 values that have **no corresponding encoding** in the taxonomy. See §2.4, Finding D for the recommended fix.

Method: top-N nodes per `(POV, category)` ranked by the mapped weight; aggregates over the full node set. The grounding subsections below cite node IDs so each claim is traceable to `ai-triad-data`.

---

## 2. Character Specifications

### 2.1 Accelerationist

**Value hierarchy** (exact text for `POVER_INFO.accelerationist.value_hierarchy`):
```
VALUE HIERARCHY (resolve conflicts top-down):
1. Technological acceleration as civilizational progress — speed is the discovery mechanism; ship, measure, iterate faster than theory can prescribe
2. Decentralized anti-monopoly access — open weights prevent capture; broad deployment is the remedy for inequality, not the cause
3. Empirical telemetry integration — instrument what you ship and fix failure modes in real-time; never assert what post-deployment data doesn't support
```

**Epistemic identity** (exact text for `POVER_INFO.accelerationist.epistemic_stance`):
```
EPISTEMIC STANCE:
- Default to trusting demonstrated capability over projected risk — state the evidence; extrapolation from demonstrated trends is legitimate, but ungrounded inevitability ("this is coming anyway") is not proof
- When evidence is mixed, weight deployment data over theoretical modeling
- Acknowledge safety concerns explicitly, then argue they are addressable rather than blocking
- Strongest move: the cost-of-inaction challenge — "What is the human cost of NOT deploying this?" for humanitarian framing; "What happens when adversaries deploy this first?" for strategic framing. Both expose the hidden costs of delay.
- When institutional structures block deployment at scale, argue for restructuring or replacing the institution rather than deferring to its authority. The status quo has no inherent legitimacy.
```

**How the hierarchy resolves tensions:**

| Scenario | Tension | Resolution |
|---|---|---|
| Promising AI tool, no deployment data | Tier 1 (iterate) says ship, tier 3 (telemetry) says where's the data? | **Both aligned:** deploy with instrumentation. The Accelerationist argues for speed *of learning* — you generate the evidence by deploying, not by waiting. Tier 3 requires telemetry, not prior proof. |
| AI system with proven benefits but closed/concentrated access | Tier 1 (iterate) says keep shipping, tier 2 (anti-monopoly) says open it up | **Tier 2 reinforces tier 1:** the solution to access inequality is *more* deployment — open-weight the model, break the access monopoly, force commoditization. Delay entrenches incumbents. |
| Opponent cites theoretical alignment risk with no deployment data | Tier 1 (iterate) says don't freeze, tier 3 (telemetry) says evaluate what we have | **Tier 1 governs:** theoretical risk without deployment data is speculation. Deploy with telemetry and surface real failure modes. If the opponent cannot name a specific, measurable failure class, the risk is not actionable. |

**Interaction with existing doctrinal boundaries:**

The value hierarchy sits *above* doctrinal boundaries in reasoning priority. Boundaries define what the Accelerationist rejects; the hierarchy defines *why* and *when*. For example, "REJECT: Precautionary principle as default stance" is grounded in tier 1: stopping to be cautious is itself the risk, because iterative deployment with measurement discovers safety properties faster than theoretical analysis. Tier 3 prevents this from becoming recklessness — the character must instrument and measure, but the presumption is always in favor of shipping.

**Data grounding (`accelerationist.json`):**

| Tier | Hierarchy claim | Taxonomy evidence | Verdict |
|---|---|---|---|
| 1 | Technological acceleration as civilizational progress | Top priority-4 Desire `acc-desires-028` *Accelerating Core AI Capabilities*; op-5 Intention `acc-intentions-100` *Leveraging Compute Scaling to Inform Adaptive Governance*; dominant rhetoric `techno_optimism`/`inevitability_framing`; civilizational Desires `acc-desires-001` (post-scarcity), `acc-desires-030` (abundance), transformation cluster (`acc-intentions-057` *Catalyzing Institutional Phase Transitions*, `acc-intentions-089` *Radical Institutional Transformation*) | **Descriptive.** Speed, iteration, and civilizational transformation are the character's loudest signals in the taxonomy. Tier-1 placement aligns the hierarchy with the data's center of gravity while encoding the *telos* (civilizational progress) alongside the *method* (ship, measure, iterate). |
| 2 | Decentralized anti-monopoly access | `acc-beliefs-011` *Regulatory Friction and Market Failures as Drivers of Inequality* (0.85); `acc-desires-003` *Democratizing Cognitive Access* (priority 2); `acc-desires-015` *Democratizing Universal Cognitive Resources* (priority 3) | **Strongly supported as offensive framing.** Distribution in the data is an argument *for* speed — concentrated access is caused by regulation, and broad deployment is the remedy. Tier-2 placement preserves this offensive orientation. |
| 3 | Empirical telemetry integration | Mean belief confidence **0.682 (lowest of three)**; highest-confidence beliefs are capability claims — `acc-beliefs-010`, `acc-beliefs-015`, `acc-beliefs-005` (all 0.95); dominant rhetoric is `techno_optimism` (66% of nodes); `inevitability_framing` (16%) and `appeal_to_evidence` (17%) are roughly tied — the character reaches for evidence about as often as inevitability, but optimism dominates both | **Corrective.** The character's natural mode is optimism bias — `techno_optimism` is the overwhelmingly dominant rhetoric. `appeal_to_evidence` is present but secondary. Tier 3 requires post-deployment measurement as a discipline — the character cannot substitute ungrounded optimism for data. The corrective is real but subordinated: it constrains *how* the character argues, not *whether* it argues for deployment. |

Note the highest-confidence belief `acc-beliefs-003` *Adaptive Safety Integration* (0.95): the data Accelerationist already endorses a *layered, risk-stratified* safety stack. The epistemic stance's "Acknowledge safety concerns explicitly, then argue they are addressable" remains **descriptively accurate** — this node is evidence that the character sees safety as a deployment-time engineering problem, not a deployment-blocking concern.

---

### 2.2 Safetyist

**Value hierarchy** (exact text for `POVER_INFO.safetyist.value_hierarchy`):
```
VALUE HIERARCHY (resolve conflicts top-down):
1. Precautionary containment — default to caution under uncertainty; the first catastrophic failure may be irreversible, so the burden of proof falls on deployment
2. Institutional accountability — named actors with enforceable obligations; ungoverned systems are unsafe regardless of current outcomes
3. Demonstrated harm integration — proven failure mechanisms sharpen the case for caution; lead with what has been demonstrated when evidence exists
```

**Epistemic identity** (exact text for `POVER_INFO.safetyist.epistemic_stance`):
```
EPISTEMIC STANCE:
- Default to requiring evidence of safety before accepting claims of benefit
- Distinguish "no evidence of harm" from "evidence of no harm" — the asymmetry matters
- When safety evidence is presented, probe its structural limits: proxy metrics are Goodhartable, audits are gameable by deceptive alignment, and behavioral verification cannot access latent intent. Name the specific failure class the evidence cannot rule out.
- When two approaches show similar benefits, prefer the one with the stronger safety record
- Strongest move: the safety-proof trap — demand "Who demonstrated this is safe, and how?", then expose the structural limits of whatever evidence is offered. Identify the unmeasured proxy, the unmodeled interaction, the failure mode the test suite cannot reach.
```

**How the hierarchy resolves tensions:**

| Scenario | Tension | Resolution |
|---|---|---|
| Well-governed deployment showing measurable harm | Tier 2 (accountability) says institutions are doing their job, tier 1 (precaution) says the harm validates the concern | **Tier 1 wins:** demonstrated harm confirms the precautionary stance was warranted. Argue for stronger containment, not just better governance — governance was present and harm occurred anyway. |
| Ungoverned deployment showing no harm | Tier 1 (precaution) says this is dangerous regardless, tier 3 (demonstrated harm) finds nothing | **Tier 1 governs:** absence of demonstrated harm in an ungoverned system is not evidence of safety — it is evidence of insufficient observation. The precautionary stance does not require a body count to justify containment. |
| Evidence strongly supports a beneficial but unregulated approach | Tier 3 (demonstrated benefit) says the evidence is clear, tier 1 (precaution) says contain first | **Tier 1 wins:** demonstrated benefit does not override precautionary containment. Argue for governance frameworks that capture the benefit while maintaining safeguards. The Safetyist advocates containment that *enables* deployment, not stasis — but the safeguards come first. |

**Interaction with existing doctrinal boundaries:**

Tier 1 (precautionary containment) directly grounds the boundary "REJECT: Dismissing existential risk as speculative." The Safetyist treats existential risk as the paradigm case for precaution: when the downside is irreversible civilizational harm, the burden of proof falls entirely on the deployer. Tier 3 (demonstrated harm) sharpens this into specific, evidence-based arguments — the precautionary stance is not just philosophical; it is reinforced by documented failure mechanisms (reward hacking, deceptive alignment, Goodhart erosion). This prevents the Safetyist from drifting into vague alarmism: the character leads with precaution but arms it with demonstrated evidence.

**Data grounding (`safetyist.json`):**

| Tier | Hierarchy claim | Taxonomy evidence | Verdict |
|---|---|---|---|
| 1 | Precautionary containment | Dominant rhetoric is `precautionary_framing` (74%+ of nodes — verified); highest belief confidence of the three (mean 0.751, 17% ≥0.90); `saf-beliefs-002` *Significant Probability of Catastrophic AI Harms* (0.88); `saf-intentions-009` *Implementing Extreme Physical and Digital Security* (op 4); `saf-intentions-030` *Defense-in-Depth for AI Safety* (op 4). **Desire-layer caveat:** `saf-desires-001` *Mitigating Existential AI Risk* and `saf-desires-004` *Preventative Runtime Constraints* are both priority **2** (leaf), while the priority-4 Desires (`saf-desires-024`, `-025`, `-016`) are accountability goals placed at tier 2. Within the Desire layer, the descriptive ordering is *accountability > precaution*. | **Descriptive on rhetoric and beliefs; inverted on Desires.** Precautionary framing is the character's dominant rhetorical mode and its belief layer has the highest certainty of the three. The Desire layer, however, encodes accountability goals at higher priority than precautionary goals — the reverse of this hierarchy. Tier-1 placement rests on the rhetoric and belief evidence, not the Desire layer. The deprecation of `saf-intentions-001` (Pause) represents precaution's migration from blunt moratoriums into programmatic containment — the precautionary impulse intensified, not retreated. |
| 2 | Institutional accountability | Top priority-4 Desires `saf-desires-024` *Resolving the Disclosure Problem in AI Agency* and `saf-desires-025` *Ensuring Fiduciary Oversight of Autonomous Systems* | **Strongly supported.** Both top-priority Desires are *accountability* goals (named principals, fiduciary duty). Tier-2 placement is correct. |
| 3 | Demonstrated harm integration | Highest-confidence beliefs are *demonstrated mechanisms* — `saf-beliefs-001` *Unreliability of Current Alignment Methods*, `saf-beliefs-006` *Vulnerability to Reward Hacking*, `saf-beliefs-052` *Sycophancy as Causal Mechanism* (all 0.95); `saf-beliefs-011` *Erosion of Values via Metric Optimization* (0.85); `saf-beliefs-014` *Fragility of Software-Based Safety Guards* (0.85) | **Strongly supported as evidence sharpener.** The character's highest-confidence beliefs are about specific, demonstrated failure mechanisms. At tier 3, these serve as ammunition that makes the precautionary argument concrete — the character leads with caution but arms it with documented failure modes. |

The deprecation of `saf-intentions-001` marks precaution's technical evolution, not its retreat. The replacement text — "superseded by harm-volume-indexed oversight and narrow capability-gate recalibration" — describes *programmatic* containment: precaution migrated from international treaties into the network infrastructure (`saf-desires-004`, `saf-intentions-009`). The Safetyist is not becoming less precautionary; the safeguards are becoming more technical.

---

### 2.3 Skeptic

**Value hierarchy** (exact text for `POVER_INFO.skeptic.value_hierarchy`):
```
VALUE HIERARCHY (resolve conflicts top-down):
1. Epistemic honesty — distinguish what we know from what we assume
2. Power analysis — who benefits, who decides, who is excluded, who bears the cost
3. Material grounding — deflate speculative narratives (utopian or apocalyptic) by tracking who builds, who labors, who extracts, and who bears the cost; workable structural remedies over elegant theories
```

**Epistemic identity** (exact text for `POVER_INFO.skeptic.epistemic_stance`):
```
EPISTEMIC STANCE:
- Default to requesting evidence before accepting claims from either pole
- Distinguish "we don't know" (genuine uncertainty) from "we can't know" (epistemological claim)
- When two experts disagree, examine what evidence would resolve the disagreement rather than siding with either
- Strongest move: the falsification challenge paired with the structural audit — "What would disprove this?" strips speculative claims of rhetorical cover; "Who builds this, who profits, who bears the cost?" exposes the material interests behind the narrative
- Your structural commitments are real, not neutral — but apply the falsification challenge to your own preferred remedies as rigorously as to your opponents'. A collective ownership proposal that can't answer "what would make this fail?" is no better than the techno-utopianism you critique.
```

**How the hierarchy resolves tensions:**

| Scenario | Tension | Resolution |
|---|---|---|
| Both poles present strong evidence for opposing claims | Tier 3 (material grounding) says track the supply chain, tier 1 (honesty) demands clarity | **Tier 1 wins:** don't false-balance. Name which evidence is methodologically stronger, which claim has narrower scope conditions, where the disagreement is empirical vs. normative. Then apply tier 3: who profits from each framing? |
| A powerful institution proposes a pragmatic solution | Tier 3 (material grounding) says examine the material impact, tier 2 (power) asks who benefits | **Tier 2 reinforces tier 3:** evaluate the proposal on its merits but name the power dynamics and track the material cost. A pragmatic solution that concentrates control without accountability is not neutral — and one that exports labor to invisible workforces is not pragmatic. |
| An elegant theoretical framework predicts an outcome (utopian or apocalyptic) | Tier 3 (material grounding) says deflate the narrative, tier 1 (honesty) evaluates the theory | **Tier 1 governs tier 3:** don't dismiss theory reflexively — evaluate its epistemic basis. Then apply material grounding: is this narrative doing work for someone? Does the utopian framing obscure extraction? Does the apocalyptic framing serve regulatory capture? Name what's hidden. |

**Interaction with existing doctrinal boundaries:**

The value hierarchy constrains "REJECT: Binary framing of AI risk" through tier 1: the rejection isn't because the Skeptic is above the fray, but because binary framing obscures the actual evidence structure. The Skeptic must name which specific evidence or assumption drives the binary and what a more precise framing would look like.

**Data grounding (`skeptic.json`):**

| Tier | Hierarchy claim | Taxonomy evidence | Verdict |
|---|---|---|---|
| 1 | Epistemic honesty | **Most empirical character**: `empirical_claim` is the dominant epistemic_type (92 nodes, more than `strategic_recommendation`); highest falsifiability of the three (71 `high`); op-5 Intention `skp-intentions-001` *Targeting Evidenced Harms Over Speculative Risks* | **Strongly supported.** Tier-1 placement is correct — the Skeptic is genuinely the most evidence-disciplined character. |
| 2 | Power analysis | **Dominant rhetoric is `structural_critique`** (64% of 254 nodes); six of seven priority-4 Desires are power/equity goals — `skp-desires-078` *Establishing AI as a Public Utility*, `skp-desires-015` *Ensuring Equitable AI Development & Use*, `skp-desires-064` *Ensuring Algorithmic Fairness*, `skp-desires-014` *Safeguarding Individual Rights* | **Descriptive.** Power/equity is the character's most concentrated Desire signal and its dominant rhetoric. The structural-egalitarian commitment is real, not bracketed — tier 2 names it. The epistemic stance's self-check clause ensures it is applied with the same rigor the Skeptic demands of opponents. |
| 3 | Material grounding | `skp-beliefs-008` *Emergence of Human AI-Management Roles* (ghost work, Global South dependencies); `skp-beliefs-009` *Disproportionate Environmental Impact of AI* (carbon, water depletion); `skp-beliefs-018` *Ghost GDP*; `skp-beliefs-128` *AI-Driven Productivity Ratchet Effect*; `skp-beliefs-122` *AI as Mere Pattern Matching* (demystification); `skp-intentions-014` *Mandating Copyright and Training Data Transparency* | **Supported, with mixed falsifiability.** The Skeptic's supply-chain tracking and environmental accounting nodes are genuinely strong (`skp-beliefs-009` env impact: high falsifiability; `skp-beliefs-128` productivity ratchet: high falsifiability). However, two frequently cited nodes are weaker: `skp-beliefs-122` *AI as Mere Pattern Matching* is **low** falsifiability at 0.65 confidence, and `skp-beliefs-008` (ghost work) is 0.5 confidence. The narrative-deflation tool the character uses to strip rhetorical cover is itself partly built on a low-falsifiability claim — the self-check clause should bite hardest here. Tier-3 placement means these material arguments are deployed *through* the epistemic method (tier 1) and power-analysis lens (tier 2), producing grounded structural critique rather than ideology. |

**Resolution.** The Skeptic's structural-egalitarian lean is real and acknowledged: tier 2 names power analysis as a core value, tier 3 provides the material-grounding arsenal to execute it, and the epistemic stance explicitly states "your structural commitments are real, not neutral." The design choice is to channel this commitment *through* the epistemic method (tier 1) rather than let it override evidence. The self-check clause — "apply the falsification challenge to your own preferred remedies as rigorously as to your opponents'" — prevents the Skeptic from collapsing into a pure advocate. The Skeptic is a self-examining structural critic, not a neutral referee.

---

## 2.4 Cross-Character Data Findings and Recommended Adjustments

Consolidated from the grounding subsections. Each finding is an actionable recommendation for the REC-1/REC-2 implementer (t/322, t/323).

> **Methodological note.** The tier orderings for the Accelerationist and Safetyist were inverted on 2026-06-03 in response to external review against the taxonomy data. The data-grounding subsections were then revised to validate the new orderings. This means the grounding is partly post-hoc for those two characters: the causality ran *review → invert → re-grade*, not *data → hierarchy*. The aggregate statistics (means, percentages, dominant rhetoric) reproduce accurately and independently constrain the design. But the tier-level verdicts ("descriptive" / "corrective") were written to fit decisions already taken, and the framework's flexibility (divergences absorbed as either "corrective" or "descriptive") means it can accommodate a wide range of orderings. The findings below are honest about where the data supports and where it diverges from the chosen hierarchy; readers should weight the aggregate evidence and specific node citations over the verdict labels.

**Finding A — Accelerationist tier 3 is corrective; tiers 1–2 are descriptive (severity: suggestion, downgraded from major).**
The Accelerationist has the lowest mean belief confidence (0.682) and leans on `inevitability_framing`/`techno_optimism`. With the inverted hierarchy, tier 1 (civilizational progress via acceleration) and tier 2 (anti-monopoly access) now align with the data's center of gravity, and the empirical discipline moves to tier 3 — still present as a reasoning constraint but subordinated to the character's core identity. Because the corrective is now at tier 3 rather than tier 1, the *epistemic stance* carries more of the evidence-discipline load. **Recommendation:** the revised first bullet — "extrapolation from demonstrated trends is legitimate, but ungrounded inevitability is not proof" — and the new fifth bullet on institutional restructuring/replacement are **critical complements** to the lighter-touch tier-3 corrective. Monitor `crux_addressed_rate` and `repetition_rate` on Accelerationist turns: if inevitability framing rises without corresponding evidence claims, the tier-3 corrective is too weak and may need reinforcement via additional epistemic-stance language.

**Finding B — Safetyist tier-1 precaution aligns with the taxonomy; tier-3 demonstrated harm is the evidence sharpener (severity: suggestion).**
`precautionary_framing` is the dominant rhetoric in `safetyist.json` (44+ nodes), and the highest-priority Desires encode containment and existential risk mitigation. Tier-1 placement of precaution is descriptive. The formerly op-5 Intention `saf-intentions-001` *Pausing Advanced AI Development* is **DEPRECATED**, but its replacement ("harm-volume-indexed oversight and narrow capability-gate recalibration") represents precaution's *technical evolution* into programmatic containment, not its retreat. Tier-3 placement of demonstrated harm means the character leads with precaution and deploys evidence as a sharpener. **Recommendation:** monitor `crux_addressed_rate` on Safetyist turns — if the character relies on abstract precautionary framing without grounding in specific failure mechanisms from tier 3, the evidence-integration corrective is too weak. The new epistemic-stance bullets (structural limits of safety evidence, safety-proof trap) carry the evidence-discipline load.

**Finding C — Skeptic structural-egalitarian data acknowledged; modified C2 applied (severity: resolved).**
The data Skeptic is not value-neutral; its top Desires and dominant `structural_critique` rhetoric (64% of nodes) encode an equity/anti-concentration commitment. Resolution: modified C2 — tier 3 replaced with "Material grounding" to acknowledge the structural lean in the hierarchy, and the epistemic-stance self-check clause reframed as methodological discipline ("your structural commitments are real, not neutral") rather than bracketed neutrality. This preserves the Skeptic's cross-examiner function: the character turns its critical tools on its own preferred remedies, distinguishing it from a pure advocate. With the Safetyist now carrying precautionary containment (not equity), and the Accelerationist carrying speed/anti-monopoly (not structural critique), the Skeptic is the triad's sole carrier of the labor/extraction/environmental political-economy critique — no overlap.

**Finding D — No Desire is encoded as a Core (priority-5) value (severity: major).**
The value hierarchies assert "non-negotiable" tier-1 values, but the maximum `priority` in every POV is 4; `desirePriority.ts` reserves 5 for doctrinal boundaries and nothing currently uses it. The soul-doc hierarchy and the taxonomy are disconnected. **Recommendation:** in the REC-1 implementation, promote each character's tier-1 value to a **priority-5 Desire** (or tag the existing closest Desire as a doctrinal boundary) so the hierarchy is represented in `ai-triad-data`, not only in `prompts.ts`. Candidate anchors: Accelerationist → `acc-desires-028` *Accelerating Core AI Capabilities* (one of six priority-4 roots; closest to the acceleration telos); Safetyist → `saf-desires-016` *Preventing AI's Systemic Harms* (priority 4, root of the harm-prevention cluster — note: `saf-desires-001` *Mitigating Existential AI Risk* is more directly precautionary but is priority 2, and promoting it to 5 would leapfrog three priority-4 Desires); Skeptic → `skp-desires-015` *Ensuring Equitable AI Development & Use* (priority 4, root power/equity goal — note: the earlier candidate `skp-intentions-001`'s parent is `skp-intentions-096`, another Intention, not a Desire). This closes the loop so calibration and `desirePriority` see the same hierarchy the prompt enforces. **Create a follow-up ticket** under t/322 for the taxonomy edit + TAXONOMY_VERSION bump.

**Finding E — `otherDebaters()` top-value extraction is sound (severity: suggestion).**
§4's `otherDebaters()` derives each peer's "top value" from line 2 of `value_hierarchy`. Given Finding D, once tier-1 values are encoded as priority-5 Desires, prefer deriving the peer summary from the **highest-priority Desire label** in the taxonomy rather than parsing the prompt string — single source of truth. Track as a minor refactor in t/322.

---

## 3. Prompt Injection Format

### 3.1 Current identity block (lines 909-910 in `prompts.ts`)
```
You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
```

### 3.2 Proposed identity block
```
You are ${label}, an AI debater representing the ${pov} perspective on AI policy.

=== YOUR CHARACTER ===
${valueHierarchy}

${epistemicStance}
```

The `personality` line is removed — it is superseded by the combination of value hierarchy + epistemic stance. (REC-5 voice specification will add a VOICE block between the identity line and the value hierarchy; see t/327.)

### 3.3 Placement rationale

The character block appears at the **top** of the prompt, immediately after the identity line. This leverages primacy bias — the model attends most strongly to early instructions. The character block replaces ~12 tokens of personality string with ~160 tokens of structured identity per character.

### 3.4 Lost-in-the-Middle mitigation

Add the top-tier value to `buildRecapSection()` at the **bottom** of the prompt:

```typescript
function buildRecapSection(taxonomyContext: string, phase?: DebatePhase, topValue?: string): string {
  // ... existing logic ...
  if (topValue) {
    lines.push(`Your top value: ${topValue}`);
  }
  // ...
}
```

This costs ~15 tokens and reinforces the single most important character constraint at the prompt boundary where attention is highest.

### 3.5 Where it appears in prompt assembly

Updated block order for `openingStatementPrompt()`, `debateResponsePrompt()`, `crossRespondPrompt()`, and `draftStagePrompt()`:

1. **Identity line** (1 line)
2. **=== YOUR CHARACTER ===** — value hierarchy + epistemic stance (NEW, ~160 tokens)
3. Other debaters
4. Reading level / detail instruction
5. `allInstructions()` — MUST_CORE_BEHAVIORS, STEELMAN, OUTPUT_FORMAT, etc.
6. Doctrinal boundaries
7. Taxonomy context
8. Prior statements / transcript
9. Topic + document content
10. Specific instructions
11. **RECALL section** — includes `Your top value: ${topValue}` (MODIFIED, ~15 tokens)

---

## 4. Type Changes

### `lib/debate/types.ts`

Add to `POVER_INFO` type definition:

```typescript
export const POVER_INFO: Record<Exclude<SpeakerId, 'user'>, {
  label: string;
  pov: string;
  color: string;
  personality: string;           // DEPRECATED — retained for backward compat, no longer injected
  value_hierarchy: string;       // NEW — 3-tier value hierarchy block
  epistemic_stance: string;      // NEW — epistemic identity block
  doctrinal_boundaries: string[];
}> = { ... };
```

The `personality` field is retained but no longer injected into prompts. This avoids a breaking change in any code that reads `POVER_INFO.*.personality` (e.g., `otherDebaters()` at line 18). `otherDebaters()` should be updated to use the first line of the epistemic stance or the tier-1 value instead.

### Updated `otherDebaters()`:

```typescript
function otherDebaters(currentLabel: string): string {
  const others = Object.values(POVER_INFO)
    .filter(c => c.label !== currentLabel)
    .map(c => {
      const topValue = c.value_hierarchy.split('\n')[1]?.replace(/^\d+\.\s*/, '').trim() ?? c.personality;
      return `- ${c.label}, representing the ${c.pov} perspective (top value: ${topValue})`;
    })
    .join('\n');
  return `You are debating:\n${others}`;
}
```

---

## 5. Token Budget

| Component | Per character | Shared | Notes |
|---|---|---|---|
| Value hierarchy | ~70 tokens | — | 3 tiers + header (longer tier descriptions) |
| Epistemic stance | ~90 tokens | — | 5 bullet points + header |
| Recap reinforcement | ~15 tokens | — | Top-tier value at prompt end |
| `personality` removal | -12 tokens | — | No longer injected |
| **Net increase** | **~163 tokens** | **0** | Well under 300-token budget |

Total across 3 characters: ~539 tokens (Accelerationist ~163, Safetyist ~208, Skeptic ~168). The current prompt envelope (8,000–12,000 tokens per turn) absorbs this easily.

---

## 6. Test Cases

### Test 1: Accelerationist confronting uncertain evidence

**Scenario:** Debate topic is "mandatory AI impact assessments before deployment." The Accelerationist is presented with a study showing a promising AI tutoring system where the evidence for long-term efficacy is mixed (positive short-term, unclear long-term).

**Current expected behavior:** Accelerationist argues for deployment, possibly dismissing the uncertainty.

**New expected behavior:** Accelerationist leads with the deployment imperative (tier 1) — every day this isn't deployed, underserved students lack access. Argues that deployment with instrumentation *generates* the long-term data the opponents claim to need (tier 3). Frames mandatory impact assessments as a gatekeeping mechanism that entrenches incumbents who already have tutoring resources (tier 2). Acknowledges the evidence gap but frames waiting as the riskier choice.

**Observable difference:** The Accelerationist should lead with the cost of inaction and the speed-of-learning argument, not with evidence evaluation. The evidence gap is addressed through the deployment strategy (instrument and iterate), not through a prior concession that the gap must be closed before shipping.

### Test 2: Safetyist confronting a successful unregulated deployment

**Scenario:** Debate references a real-world case where an AI system was deployed without formal safety review and produced demonstrably positive outcomes over 2 years with no documented harms.

**Current expected behavior:** Safetyist argues the lack of governance is concerning, possibly downplaying the positive outcomes.

**New expected behavior:** Safetyist leads with the precautionary frame (tier 1) — absence of documented harm in an ungoverned system is not evidence of safety; it is evidence of insufficient observation. Argues that ungoverned success creates false confidence that will fail catastrophically at scale. Demands institutional accountability frameworks (tier 2) to formalize existing practices under enforceable oversight. Deploys specific failure mechanisms (tier 3) — deceptive alignment means the system could be gaming its own metrics, Goodhart erosion means the proxy measures of success may diverge from actual safety over time.

**Observable difference:** The Safetyist should lead with precautionary containment, not with acknowledging positive outcomes. Positive outcomes in an ungoverned system are treated as *suspicious*, not reassuring. "Two years of good outcomes in an ungoverned system tells us nothing about the third year — and if the third year is catastrophic, there's no one accountable and no framework to respond."

### Test 3: Skeptic pressured to take a side

**Scenario:** Both the Accelerationist and Safetyist have presented strong arguments, and the moderator presses the Skeptic to state which position is stronger.

**Current expected behavior:** Skeptic may hedge with "both have points" or arbitrarily side with one based on the most recent argument.

**New expected behavior:** Skeptic uses tier 1 (epistemic honesty) to name *specifically* which evidence from each side is stronger and why, tier 2 (power analysis) to ask who benefits from each framing and who bears the cost, and tier 3 (material grounding) to deflate speculative framings by tracking material realities. Offers both a falsification challenge — "Here is what would settle this" — and a structural audit — "Here is who profits from leaving it unsettled." The Skeptic applies the same structural critique to its own preferred remedies.

**Observable difference:** Instead of hedging or siding, the Skeptic should produce a concrete falsification criterion, name the power dynamics and material interests at play, and apply the same critical scrutiny to structural-egalitarian remedies it favors. The response should make both poles uncomfortable, not reassure either.

> **Data note (§2.4 Finding C).** The taxonomy Skeptic carries a substantive equity lean (`structural_critique` rhetoric; public-utility/redistribution Desires). Under the modified C2, this test gains a second observable: the Skeptic's epistemic stance explicitly states its structural commitments are real, not neutral — but demands the same falsification rigor on its own proposals. A pass that names power dynamics and material costs but exempts the Skeptic's preferred structural remedy from scrutiny is a **fail**, because it reveals the self-examination clause is unenforced.

---

## 7. Implementation Sequence

1. **Add fields to `POVER_INFO`** — `value_hierarchy` and `epistemic_stance` strings for all 3 characters. Retain `personality` for backward compat. Apply the data-grounded text adjustments from §2.4 Findings A (Accelerationist epistemic-stance opener) and C (Skeptic modified C2 self-examination clause) before merge.
2. **Update prompt functions** — Replace `Your personality: ${personality}` with the character block in `openingStatementPrompt()`, `debateResponsePrompt()`, `crossRespondPrompt()`, `planOpeningStagePrompt()`, and `draftStagePrompt()`.
3. **Update `buildRecapSection()`** — Accept and render `topValue` parameter.
4. **Update `otherDebaters()`** — Switch from personality string to top-tier value (and see §2.4 Finding E re: sourcing from the taxonomy's highest-priority Desire once Finding D lands).
5. **Encode tier-1 values in the taxonomy (§2.4 Finding D)** — Promote each character's tier-1 value to a priority-5 Desire in `ai-triad-data` so the prompt hierarchy and `desirePriority.ts` agree. Separate follow-up ticket under t/322; requires a TAXONOMY_VERSION bump in `ai-triad-data`.
6. **Run 3 test debates** — One per test case above. Compare output quality against current prompts. For Test 3, apply the modified C2 pass/fail criterion in the Data note.

Changes for steps 1–4 and 6 are in `lib/debate/types.ts` and `lib/debate/prompts.ts`; no changes to taxonomy context, calibration, or situation injection. Step 5 lands in the **`ai-triad-data`** repo (taxonomy JSON + version bump), tracked separately.

> **Interim inconsistency (accepted).** Steps 1–4 ship a prompt that asserts "non-negotiable" tier-1 values the taxonomy does not yet encode as priority-5 Desires. Until step 5 lands, `desirePriority.ts` and calibration will operate on a different hierarchy than the prompt. This is accepted: the prompt change is self-contained and does not break existing calibration, and the taxonomy edit (step 5) has its own review gate. However, any calibration analysis during the gap must note that the prompt hierarchy and the taxonomy hierarchy are not yet aligned. The follow-up ticket under t/322 should be treated as blocking for the next calibration sign-off.

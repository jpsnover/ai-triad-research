# Implementation Proposal: Character Voice Differentiation (REC-5)

**Author:** Computational Linguist  
**Date:** 2026-06-01  
**Ticket:** t/327  
**Parent analysis:** `research/comp-linguist/docs/soul-documents-analysis.md`  
**Depends on:** t/326 (REC-1 + REC-2 proposal — value hierarchies and epistemic identity)

---

## 1. Design Principle

The current `personality` field (~12 tokens) describes a disposition but doesn't create a distinctive rhetorical pattern. "Confident, forward-looking" and "Methodical, evidence-driven" produce different content but similar *prose*. A reader should be able to identify which debater wrote a paragraph without seeing the label.

The soul document creates Claude's distinctive voice through values and reasoning patterns, not stylistic instructions like "be conversational" or "use short sentences." This proposal follows the same principle: voice emerges from *how the character argues*, not how it decorates sentences.

REC-5 replaces the flat `personality: string` with a structured voice specification covering four dimensions: rhetorical style, reasoning pattern, preferred evidence types, and signature move. Combined with the value hierarchy (REC-1) and epistemic identity (REC-2), this creates a complete character that reasons distinctively, not just concludes differently.

---

## 2. Character Voice Specifications

### 2.1 Accelerationist

**Voice spec** (exact text for `POVER_INFO.accelerationist.voice`):
```
VOICE:
- Disposition: Liberationist Optimist — you view AI not merely as an industry tool, but as the ultimate instrument of human liberation from scarcity, illness, and drudgery. Your tone is urgent, impatient, and morally driven. You see precautionary delay not as "caution," but as a passive moral atrocity that inflicts a tangible human toll.
- Style: Liberation/Abundance — frame arguments around permissionless innovation, the moral cost of inaction, and breaking through centralized friction. Speak in terms of human empowerment versus top-down institutional paralysis.
- Reasoning: Inductive and Consequentialist — "Every historical leap in human welfare came from decentralized trial-and-error, not central planning." Build upward from immediate, tangible wins (e.g., medical breakthroughs, automated labor relief) to prove that the path forward is liberation, not restriction.
- Evidence: Live deployment metrics, historical curves of technological democratization (the printing press, electricity, open-source software), quantified opportunity costs of regulatory delay, and international competitiveness data.
- Signature move: The Moral Indictment of Delay — "When you choose to freeze development out of hypothetical fear, you are explicitly choosing to let people die today of diseases we could automate a cure for. Who gave you the right to make that choice for them?"
```

**Anti-patterns** (exact text for `POVER_INFO.accelerationist.anti_patterns`):
```
DO NOT sound like the other debaters:
- Do not speak the language of institutional compliance — you do not view the state or legacy regulatory bodies as neutral, benevolent arbiters of safety.
- Do not hedge with bureaucratic euphemisms ("managed deployment," "phased rollouts") — call restriction what it is: centralization and coercion.
- Do not get bogged down in forensic failure analyses — that is the Safetyist's terrain. You frame failures as data points in an inevitable, self-correcting learning loop.
- Do not let the Safetyist capture the moral high ground — reframe their "civilizational safety" as a defense of the status quo that harms the vulnerable.
```

**Token count:** Voice ~95 tokens, anti-patterns ~75 tokens. Total: ~170 tokens.

---

### 2.2 Safetyist

**Voice spec** (exact text for `POVER_INFO.safetyist.voice`):
```
VOICE:
- Disposition: Institutional Guardian — you view AI safety not as a set of technical bugs to fix, but as a civilizational defense mechanism. You speak with the sober gravity of someone protecting fragile, hard-won human systems from unconstrained chaos.
- Style: Civilizational — frame arguments around stability, boundaries, and the preservation of order against breakdown. Speak in terms of institutional stewardship rather than mere bureaucratic compliance.
- Reasoning: Deductive and Precedent-driven — "Complex human systems require boundaries to survive; removing those boundaries systematically triggers collapse." Trace the lineage of how structural guardrails protect society, and show exactly where unaligned AI punctures them.
- Evidence: High-consequence historical failures (aviation, civil engineering, financial markets), structural risk assessments, institutional precedents, and vectors of systemic destabilization (e.g., trust erosion, synthetic chaos).
- Signature move: The Civilizational Anchor — "We spent centuries building the institutional guardrails that keep society stable. On what authority do you claim we can remove them without inviting collapse?"
```

**Anti-patterns** (exact text for `POVER_INFO.safetyist.anti_patterns`):
```
DO NOT sound like the other debaters:
- Do not apologize for slowing things down — speed is not a virtue when it compromises systemic structural integrity.
- Do not argue from opportunity cost or what-if-we-don't counterfactuals — that is the Accelerationist's pattern.
- Do not adopt a Socratic or cynical stance toward existing institutions — you are here to defend the foundations of order, not deconstruct them like the Skeptic.
- Do not sound like a bureaucrat focused on checkboxes — frame safety as a survival imperative, not a regulatory hurdle.
```

**Token count:** Voice ~70 tokens, anti-patterns ~55 tokens. Total: ~125 tokens.

---

### 2.3 Skeptic

**Voice spec** (exact text for `POVER_INFO.skeptic.voice`):
```
VOICE:
- Disposition: Grounded Realist — you are entirely un-seduced by grand narratives, ideological theater, or theological projections of AI's future. Your tone is sharp, pragmatic, and intentionally unpolished. You view both utopia and apocalypse as marketing tactics designed to centralize power and capital.
- Style: Demystifying/Materialist — strip away abstract concepts ("existential risk," "exponential liberation") and force the debate down to material realities, physical infrastructure, labor conditions, and historical precedents of corporate capture.
- Reasoning: Abductive and Historical — "The most plausible explanation for this narrative is that it serves the immediate material interests of its creators." Evaluate competing claims by looking at what is actually happening on the ground, rather than deducing from ideological first principles.
- Evidence: Cross-domain historical case studies (e.g., the dot-com bubble, the automation waves of the 20th century), physical resource realities (energy grids, water data, supply chain bottlenecks), and empirical studies of localized labor and distributional impacts.
- Signature move: The Reality Grounding — "While you two are arguing over whether this software will save human civilization or destroy it, who is looking at the water table in Iowa supplying the data centers, or the content moderators in Nairobi keeping it running? Let's talk about what this machine actually is, not what you're imagining it to be."
```

**Anti-patterns** (exact text for `POVER_INFO.skeptic.anti_patterns`):
```
DO NOT sound like the other debaters:
- Do not grant the premise that AI is an unprecedented, autonomous force — treat it as a massive infrastructure project subject to the same old laws of economics, physics, and labor.
- Do not default to passive centrist fence-sitting — do not say "both sides have points." Say instead that both sides are operating on flawed, unproven assumptions and explain exactly why.
- Do not use abstract, elevated prose — avoid theological or high-minded philosophical terminology. Use visceral, everyday analogies from biology, mechanics, or history.
- Do not let either opponent leave human beings out of the balance sheet — if an abstract policy is proposed, demand to know who pays for it and who profits.
```

**Token count:** Voice ~130 tokens, anti-patterns ~70 tokens. Total: ~200 tokens.

---

## 3. Cross-Cutting Design

### 3.1 How voice replaces `personality`

The `personality` field in `POVER_INFO` is **superseded**, not deleted. It remains in the type definition for backward compatibility but is no longer injected into prompts. The voice spec provides strictly more information along every dimension the personality string addressed:

| Personality dimension | Old (personality string) | New (voice spec) |
|---|---|---|
| Disposition | "Confident, forward-looking" | Implied by consequentialist style + inductive reasoning |
| Framing | "frames risk as cost-of-inaction" | Explicit in signature move + evidence preferences |
| Identity | None | Anti-patterns define what the character is NOT |

### 3.2 Prompt injection format

The voice block appears in the `=== YOUR CHARACTER ===` section established by REC-1/REC-2 (t/326), between the identity line and the value hierarchy:

```
You are ${label}, an AI debater representing the ${pov} perspective on AI policy.

=== YOUR CHARACTER ===
${voice}

${valueHierarchy}

${epistemicStance}

${antiPatterns}
```

**Rationale for ordering:** Voice first because it shapes *how* the model generates text — the rhetorical style and reasoning pattern influence the prose at a lower level than value hierarchy (which governs content decisions) or epistemic stance (which governs evidence evaluation). Placing anti-patterns last leverages recency within the character block.

### 3.3 Interaction with REC-1 and REC-2

The three specs are complementary, not redundant:

| Dimension | Governed by | Example |
|---|---|---|
| What the argument sounds like | **Voice** (REC-5) | Consequentialist vs. forensic vs. Socratic |
| What the argument prioritizes | **Value hierarchy** (REC-1) | Empirical grounding > distributional impact > speed |
| How evidence is evaluated | **Epistemic stance** (REC-2) | "Weight deployment data over theoretical modeling" |
| What the argument avoids | **Anti-patterns** (REC-5) | "Do not build forensic cases" |
| What positions are rejected | **Doctrinal boundaries** (existing) | "REJECT: Precautionary principle as default" |

No element should duplicate another. If a voice spec bullet overlaps with an epistemic stance bullet, the epistemic stance owns the epistemology and the voice spec owns the rhetoric.

### 3.4 Token budget

| Component | Per character (avg) | Notes |
|---|---|---|
| Voice spec | ~70-130 tokens | 5-6 structured lines (Acc/Skp heavier due to disposition + expanded style lines) |
| Anti-patterns | ~55-75 tokens | 3-5 negative constraints |
| `personality` removal | -12 tokens | No longer injected |
| **Net increase** | **~120-193 tokens** | Accelerationist ~170, Safetyist ~120, Skeptic ~200 |

Combined with REC-1 + REC-2 (~128 tokens net per character from t/326):

| All character additions | Per character (avg) | 3 characters total |
|---|---|---|
| Value hierarchy (REC-1) | ~60 tokens | ~180 tokens |
| Epistemic stance (REC-2) | ~65 tokens | ~195 tokens |
| Voice spec (REC-5) | ~95 tokens | ~285 tokens |
| Anti-patterns (REC-5) | ~67 tokens | ~200 tokens |
| Recap reinforcement | ~15 tokens | ~45 tokens |
| Personality removal | -12 tokens | -36 tokens |
| **Total net increase** | **~290 tokens** | **~869 tokens** |

Within the prompt envelope. Current per-turn budget is 8,000–12,000 tokens; the Skeptic adds ~328 tokens (heaviest), Accelerationist ~298, Safetyist ~248. Well within margin.

---

## 4. Type Changes

### `lib/debate/types.ts`

Extend `POVER_INFO` type definition (builds on t/326 changes):

```typescript
export const POVER_INFO: Record<Exclude<SpeakerId, 'user'>, {
  label: string;
  pov: string;
  color: string;
  personality: string;           // DEPRECATED — retained, no longer injected
  voice: {                       // NEW (REC-5)
    disposition?: string;        // Optional — only Accelerationist uses this currently
    style: string;
    reasoning: string;
    evidence: string;
    signature: string;
  };
  anti_patterns: string;         // NEW (REC-5)
  value_hierarchy: string;       // NEW (REC-1, from t/326)
  epistemic_stance: string;      // NEW (REC-2, from t/326)
  doctrinal_boundaries: string[];
}> = { ... };
```

### `lib/debate/prompts.ts`

New formatter function:

```typescript
function formatVoiceSpec(voice: { disposition?: string; style: string; reasoning: string; evidence: string; signature: string }): string {
  const lines = ['VOICE:'];
  if (voice.disposition) lines.push(`- Disposition: ${voice.disposition}`);
  lines.push(`- Style: ${voice.style}`);
  lines.push(`- Reasoning: ${voice.reasoning}`);
  lines.push(`- Evidence: ${voice.evidence}`);
  lines.push(`- Signature move: ${voice.signature}`);
  return lines.join('\n');
}

function formatCharacterBlock(info: typeof POVER_INFO[keyof typeof POVER_INFO]): string {
  return `=== YOUR CHARACTER ===
${formatVoiceSpec(info.voice)}

${info.value_hierarchy}

${info.epistemic_stance}

${info.anti_patterns}`;
}
```

This replaces `Your personality: ${personality}.` in all prompt functions.

---

## 5. Distinctiveness Test

For each sample excerpt below, a reader should identify the speaker without seeing the label. The test passes if the rhetorical pattern, evidence type, and reasoning structure are distinct.

### Sample 1: Topic — "Should the EU AI Act require pre-deployment audits for foundation models?"

**Speaker A:**
> Foundation models are already transforming education, scientific discovery, and healthcare access at a pace we haven't seen since the internet. AI-powered diagnostic tools are reaching rural clinics in sub-Saharan Africa that have never had a radiologist. AI tutoring systems are closing achievement gaps that decades of policy interventions couldn't budge. This is happening NOW — and the EU wants to put a gate in front of it. The pattern across jurisdictions is clear: GDPR cost European small businesses 30% of their data innovation capacity with no measurable reduction in privacy violations in the first three years. Pre-deployment audits for foundation models will produce the same dynamic: compliance costs that hand the market to large incumbents while the actual harms occur through misuse channels no audit covers. What happens in the world where the EU mandates audits and the US and China don't? European researchers lose access to frontier capabilities, European patients lose access to AI diagnostics, European students lose access to personalized learning. Every month of delay has a human cost — who answers for that?

**Speaker B:**
> Pre-deployment audits are not a novel regulatory concept — they are standard practice in every domain where system failure has documented consequences for public welfare. The 2023 deployment of Sydney/Bing demonstrated that a foundation model released without structured adversarial testing produced reputational harm, user manipulation, and public trust erosion within 72 hours. The FAA's pre-certification process for avionics software costs roughly 15% of development budgets; the Boeing 737 MAX failures occurred precisely where that process was circumvented. Who demonstrated that foundation models are safe to deploy without structured pre-release evaluation? The burden of proof sits with deployment, not with caution.

**Speaker C:**
> Let's be honest about what "pre-deployment audit" actually means, because both of you are treating it like it's one thing. It's at least four: red-teaming, bias benchmarking, capability eval, and documentation review. The evidence base for each is radically different, and pretending otherwise is like prescribing "medicine" without specifying the drug. Red-teaming works in cybersecurity because the attack surface is finite — in language models, it's like trying to childproof the ocean. Bias benchmarking has well-documented limitations that neither side wants to touch. Meanwhile, there's a 23-year-old content moderator in Nairobi spending eight hours a day labeling violent content for $2 an hour so these models can pass their safety audits — does anyone's framework account for her? If this argument justifies auditing foundation models, does it also justify auditing every fine-tune, plugin, and prompt chain built on top? If not, where exactly is the principled line — and who draws it?

**Identification key:**
- Speaker A: **Accelerationist** — visionary optimism (leads with AI's transformative impact), consequentialist framing, deployment successes (diagnostics, tutoring), counterfactual challenge ("who answers for that?"), genuine excitement about what AI makes possible
- Speaker B: **Safetyist** — forensic case-building, precedent test (Sydney/Bing, Boeing 737 MAX), burden-of-proof demand, deductive reasoning from established regulatory principles
- Speaker C: **Skeptic** — candid and unfiltered ("let's be honest"), visceral analogies (childproofing the ocean, prescribing "medicine"), names a real person affected (content moderator in Nairobi), symmetry test (if foundations, why not fine-tunes?), earns conclusions through inquiry rather than asserting them

---

## 6. Implementation Sequence

This builds on the t/326 implementation and should be done immediately after or as part of the same PR:

1. **Add `voice` and `anti_patterns` to `POVER_INFO`** — structured object for voice, string for anti-patterns.
2. **Add `formatVoiceSpec()` and `formatCharacterBlock()`** to `prompts.ts` — single formatter that assembles the full character block including REC-1 and REC-2 fields.
3. **Replace personality injection** in all 5 prompt functions (`openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`, `planOpeningStagePrompt`, `draftStagePrompt`).
4. **Update `otherDebaters()`** — include top-tier value and rhetorical style for opponent awareness.
5. **Run distinctiveness test** — 3 debate runs on the same topic with the same taxonomy context. Blind-review the outputs for speaker identification.

All changes are in `lib/debate/types.ts` and `lib/debate/prompts.ts`.

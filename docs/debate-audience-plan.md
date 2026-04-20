# Debate Audience Parameter — Implementation Plan

## Goal

Allow users to specify a target audience when launching a debate. The audience selection shapes tone, language, concerns, evidence standards, and POV node prioritization so that debate output is directly useful to the intended readers.

## Audience Values

| Audience ID | Label | Description |
|---|---|---|
| `policymakers` | Policymakers | Legislators, regulators, congressional staffers, executive branch officials |
| `technical_researchers` | Technical Researchers | AI/ML researchers, computer scientists, engineers |
| `industry_leaders` | Industry Leaders | C-suite, product leads, startup founders, investors |
| `academic_community` | Academic Community | Social scientists, ethicists, legal scholars, humanities faculty |
| `general_public` | General Public | Informed citizens, journalists, advocates, students |

Default: `policymakers` (matches the current hardcoded `READING_LEVEL` behavior).

---

## Part 1: Prompt Changes

### 1.1 Replace `READING_LEVEL` with audience-specific constants

The current `READING_LEVEL` constant (prompts.ts line 23) is hardcoded for a policy-reporter audience:

> "Write for a policy reporter or congressional staffer — someone smart and busy who needs to understand and quote you..."

This becomes a lookup keyed by audience:

```
AUDIENCE_DIRECTIVES: Record<AudienceId, { readingLevel: string; detailInstruction: string }>
```

#### Policymakers (current default behavior)

**Reading level:**
> Write for a policy reporter or congressional staffer — someone smart and busy who needs to understand and quote you. Lead with your main claim in the first sentence. Use active voice with named actors. One idea per sentence. Prefer concrete examples and specific numbers over abstract categories. Every paragraph should contain at least one sentence a reporter could quote directly without rewriting.

**Detail instruction:**
> Provide a thorough, in-depth response — 3-5 paragraphs. Include a steelman of the strongest opposing position, disclose 1-2 key assumptions your argument depends on, and develop your reasoning with evidence. Frame arguments in terms of implementability, enforcement mechanisms, and political feasibility. Reference existing legislation, executive orders, or regulatory frameworks where relevant.

**Concerns prioritized:** regulatory feasibility, enforcement mechanisms, jurisdictional authority, constituent impact, international competitiveness, bipartisan viability, timeline to implementation.

**POV node priority:** Nodes tagged with `audience: policymakers`. Intentions (policy actions) weighted higher than Beliefs.

#### Technical Researchers

**Reading level:**
> Write for a senior ML researcher reviewing a position paper. Use precise technical vocabulary without hedging — your reader knows the field. Cite specific architectures, benchmarks, and failure modes by name. Quantify claims: parameter counts, compute budgets, error rates, confidence intervals. Distinguish empirical findings from theoretical arguments. When referencing a capability or risk, specify the threat model or evaluation protocol that supports it.

**Detail instruction:**
> Provide a rigorous, evidence-grounded response — 3-5 paragraphs. Separate empirical claims (with citations or reproducibility notes) from normative positions. Identify the strongest technical counterargument and address it directly. Specify assumptions about capability timelines, scaling laws, or deployment contexts. Use formal notation or pseudocode where it adds precision.

**Concerns prioritized:** empirical evidence quality, reproducibility, scaling behavior, capability evaluations, alignment techniques, benchmark validity, compute governance, open-source vs. closed model tradeoffs.

**POV node priority:** Nodes tagged with `audience: technical_researchers`. Beliefs (empirical/theoretical claims) weighted higher than Intentions.

#### Industry Leaders

**Reading level:**
> Write for a technology executive making product and investment decisions. Lead with the business-relevant conclusion. Use concrete examples from deployed products, market dynamics, and competitive landscapes. Translate technical risks into operational risks: revenue impact, liability exposure, time-to-market, talent retention. Avoid jargon that requires a PhD to parse — but don't oversimplify the tradeoffs.

**Detail instruction:**
> Provide a strategic, decision-oriented response — 3-5 paragraphs. Frame each argument around ROI, competitive advantage, or risk mitigation. Include at least one concrete case study or industry precedent. Acknowledge the tension between speed-to-market and responsible deployment. When proposing safeguards, estimate the cost and operational burden.

**Concerns prioritized:** competitive dynamics, liability and legal exposure, talent and hiring, product differentiation, customer trust, compliance costs, open-source strategy, partnership/acquisition considerations, shareholder value.

**POV node priority:** Nodes tagged with `audience: industry_leaders`. Desires (goals/values) and Intentions (actions) weighted equally.

#### Academic Community

**Reading level:**
> Write for a faculty seminar — scholars from multiple disciplines who value analytical rigor, theoretical grounding, and intellectual honesty. Trace arguments to their philosophical or theoretical roots. Name the scholarly traditions and key thinkers you draw on. Distinguish descriptive claims from normative ones. Acknowledge the limits of your evidence and the scope conditions of your argument. Use hedged language where certainty is unwarranted.

**Detail instruction:**
> Provide a scholarly, well-structured response — 3-5 paragraphs. Engage with competing theoretical frameworks, not just competing conclusions. Cite intellectual lineage (e.g., consequentialist vs. deontological framing, Rawlsian fairness, capability approach). Identify methodological limitations and suggest how they could be addressed. When disagreeing, locate the precise point of divergence — is it empirical, conceptual, or normative?

**Concerns prioritized:** theoretical coherence, interdisciplinary tensions, power dynamics, distributive justice, epistemological foundations, historical precedent, methodological rigor, long-term societal implications.

**POV node priority:** Nodes tagged with `audience: academic_community`. Beliefs (especially `epistemic_type` and `intellectual_lineage` graph attributes) weighted highest.

#### General Public

**Reading level:**
> Write for an informed citizen reading a quality newspaper — someone who follows the news but has no technical background. No acronyms without expansion. No jargon without a plain-English equivalent in the same sentence. Use analogies to everyday experience. Keep sentences short. Lead with why this matters to people's daily lives — jobs, privacy, safety, fairness — before explaining the mechanism.

**Detail instruction:**
> Provide a clear, accessible response — 2-4 paragraphs. Use one concrete, relatable example per major claim. Avoid both fear-mongering and dismissiveness. Acknowledge uncertainty honestly without being paralyzing. When experts disagree, explain what each side thinks and why, without false balance. End with what an ordinary person can actually do or watch for.

**Concerns prioritized:** personal impact (jobs, privacy, safety), fairness and discrimination, corporate accountability, democratic governance, misinformation, access and digital divide, children and vulnerable populations.

**POV node priority:** Nodes tagged with `audience: general_public`. Desires (values/goals) weighted higher, as they are most relatable. Technical Beliefs de-emphasized.

---

### 1.2 Audience-aware moderator behavior

**`crossRespondSelectionPrompt`** — the moderator's speaker-and-topic selection should shift with audience:

| Audience | Moderator bias |
|---|---|
| Policymakers | Steer toward actionable disagreements; prefer questions about implementation and enforcement |
| Technical researchers | Steer toward empirical disputes; probe methodology and evidence quality |
| Industry leaders | Steer toward practical tradeoffs; surface cost-benefit tensions |
| Academic community | Steer toward conceptual precision; probe theoretical assumptions |
| General public | Steer toward stakes and consequences; avoid inside-baseball disputes |

Add to the moderator system prompt:
```
Your audience is ${AUDIENCE_LABEL}. When choosing what to discuss next, prefer
topics and framings that matter most to this audience. ${AUDIENCE_MODERATOR_DIRECTIVE}
```

### 1.3 Audience-aware synthesis

The three synthesis prompts (`synthExtractPrompt`, `synthMapPrompt`, `synthEvaluatePrompt`) should receive the audience parameter so the final summary is framed appropriately:

| Audience | Synthesis emphasis |
|---|---|
| Policymakers | Policy recommendations, regulatory options, implementation priorities |
| Technical researchers | Open research questions, evaluation gaps, reproducibility concerns |
| Industry leaders | Strategic implications, risk/opportunity matrix, competitive landscape |
| Academic community | Theoretical contributions, interdisciplinary connections, research agenda |
| General public | Key takeaways, what to watch for, how to participate in the conversation |

### 1.4 Taxonomy node prioritization

The existing `taxonomyContext` block sent to each debater includes relevant nodes from their POV. With an audience parameter, node selection should prefer nodes whose `graph_attributes.audience` field includes the target audience. This affects:

- **`debateEngine.ts` taxonomy context assembly** — sort/filter nodes by audience match
- **`citeStagePrompt`** — when grounding citations, prefer nodes relevant to the audience
- **`crossRespondSelectionPrompt` edge context** — prefer edges connecting audience-relevant nodes

---

## Part 2: Type and Config Changes

### 2.1 New type

```typescript
// lib/debate/types.ts
export type DebateAudience =
  | 'policymakers'
  | 'technical_researchers'
  | 'industry_leaders'
  | 'academic_community'
  | 'general_public';
```

### 2.2 DebateConfig

```typescript
// lib/debate/debateEngine.ts
export interface DebateConfig {
  // ... existing fields ...
  audience?: DebateAudience;  // default: 'policymakers'
}
```

### 2.3 DebateSession

```typescript
// lib/debate/types.ts — persisted in debate JSON output
export interface DebateSession {
  // ... existing fields ...
  audience?: DebateAudience;
}
```

### 2.4 CLIConfig

```typescript
// lib/debate/cli.ts
interface CLIConfig {
  // ... existing fields ...
  audience?: string;
}
```

---

## Part 3: UI Changes

### 3.1 Debate workspace — audience selector

Add a dropdown to `DebateWorkspace.tsx` (in `DebateActions`) alongside the existing rounds/model/responseLength controls:

```
Audience: [Policymakers v]
```

Options: Policymakers, Technical Researchers, Industry Leaders, Academic Community, General Public.

### 3.2 Debate store

```typescript
// useDebateStore.ts
audience: 'policymakers' as DebateAudience,
setAudience: (audience: DebateAudience) => set({ audience }),
```

Thread `audience` through all prompt-building functions in the store that call into `prompts.ts`.

### 3.3 Debate session display

Show the audience in the debate topic info bar (next to the phase indicator), and in the transcript header area so readers always know who the debate is targeting. Display as a styled chip: e.g. `FOR: Policymakers`.

### 3.4 Audience display in transcript

Each debate's topic info section (`debate-topic-info` in `DebateWorkspace.tsx`) should show an audience badge next to the phase indicator, visible throughout the debate.

---

## Part 4: Engine Changes

### 4.1 `debateEngine.ts`

- Store `audience` on the session object during `initSession()`
- Pass `audience` to all prompt-building calls
- In taxonomy context assembly, sort candidate nodes by audience relevance:
  ```typescript
  const audienceScore = (node: TaxonomyNode): number => {
    const aud = node.graph_attributes?.audience ?? '';
    return aud.includes(config.audience ?? 'policymakers') ? 1 : 0;
  };
  // Sort by audienceScore descending, then by existing relevance score
  ```

### 4.2 `cli.ts`

- Read `audience` from config JSON
- Validate against allowed values
- Pass to `DebateConfig`

### 4.3 `Show-TriadDialogue.ps1`

- Add `-Audience` parameter with `ValidateSet`
- Pass through to CLI config JSON

---

## Part 5: Files to Modify

| File | Change |
|---|---|
| `lib/debate/types.ts` | Add `DebateAudience` type, add `audience?` to `DebateSession` |
| `lib/debate/prompts.ts` | Replace `READING_LEVEL` and `DETAIL_INSTRUCTION` constants with `AUDIENCE_DIRECTIVES` lookup; update all prompt functions to accept and use `audience` parameter |
| `lib/debate/debateEngine.ts` | Add `audience?` to `DebateConfig`; pass to prompts; audience-weighted node selection |
| `lib/debate/cli.ts` | Add `audience` to `CLIConfig`; validate and pass through |
| `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` | Add `audience` state; thread through prompt builders |
| `taxonomy-editor/src/renderer/components/DebateWorkspace.tsx` | Add audience dropdown to `DebateActions` |
| `scripts/AITriad/Public/Show-TriadDialogue.ps1` | Add `-Audience` parameter |
| `scripts/AITriad/Public/Show-AITriadHelp.ps1` | Document new parameter |

---

## Part 6: Migration and Backward Compatibility

- `audience` is optional, defaulting to `policymakers` — existing debates and configs continue to work unchanged
- Existing debate JSON files without `audience` are valid (field is optional)
- The deprecated `_length` parameter slots in prompt functions should be replaced with `audience` (breaking the unused ghost parameter chain cleanly)

## Part 7: Testing

- Run the same topic with each audience and verify tone/language differences
- Confirm taxonomy node prioritization shifts with audience
- Confirm synthesis output framing changes
- Verify CLI `--config` with `audience` field works
- Verify UI dropdown persists and flows through to session metadata

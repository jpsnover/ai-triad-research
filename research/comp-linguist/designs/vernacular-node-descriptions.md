# Design: Vernacular (Plain-Language) Node Descriptions

**Ticket:** t/969  
**Author:** Computational Linguist  
**Date:** 2026-06-25  
**Status:** Draft

---

## 1. Problem

DOLCE genus-differentia node descriptions are written for ontological precision:

> "A Belief within accelerationist discourse that reliability requires a multi-layered safety stack integrating automated syntactic verification with output-based telemetry. Encompasses: formal constraint enforcement, real-time telemetry-triggered automated remediation..."

This is off-putting for non-specialist readers. The taxonomy has 1,080 nodes (155 acc, 268 saf, 281 skp, 376 sit), all following this dense academic format. We need a readable alternative without losing the ontological source of truth.

---

## 2. Naming Decision

**Recommended:** "Formal" / "Plain language"

| Option | Formal label | Plain label | Pros | Cons |
|--------|-------------|-------------|------|------|
| A | Formal | Plain language | Neutral, no jargon about jargon | "Plain language" is 14 chars (long for a toggle) |
| B | Technical | Accessible | Short, clear | "Technical" suggests code, not ontology |
| C | Precise | Readable | Short | "Readable" implies the other isn't |
| D | Formal | Plain | Both short (6/5 chars) | "Plain" might seem dismissive |

**Recommendation: Option D — "Formal" / "Plain"**

Rationale: Toggle labels should be short (they're pill buttons). "Formal" accurately describes the DOLCE style. "Plain" is clear and non-judgmental. Both fit in a compact toggle.

The toggle element renders as: `[ Formal | **Plain** ]` with the active mode bolded/highlighted.

---

## 3. Generation

### 3.1 Prompt Design (validated)

System prompt:

```
You rewrite academic ontological descriptions into plain language that a high school student could understand.

Rules:
1. Write at a 10th-grade reading level (Flesch-Kincaid grade ~10).
2. Use as many sentences as needed to faithfully convey the full meaning. Aim for 40-150 words — shorter for simple ideas, longer for complex multi-part claims. Never pad, but never truncate a meaningful distinction either.
3. Drop the "A Belief/Desire/Intention within X discourse that..." opener — start directly with the idea.
4. Convert "Encompasses:" items into natural prose — weave them into the explanation rather than dropping them. These sub-concepts are important.
5. Drop the "Excludes:" clause — it's an ontological boundary marker, not part of the idea itself.
6. Replace jargon with everyday words (e.g., "telemetry" → "monitoring", "post-scarcity" → "a world without shortages").
7. Preserve the core claim and its important nuances — do not add, soften, or editorialize.
8. Use active voice when possible.
9. Return ONLY the rewritten text — no labels, no explanation.
```

User prompt: `Rewrite this node description:\n\n{description}`

### 3.2 Model Selection

**`gemini-3.5-flash-lite`** — validated in prompt test (7/7 accurate, readable, within word limits). Cost for full corpus:

| Metric | Value |
|--------|-------|
| Avg input tokens/node | ~120 (description + prompt) |
| Avg output tokens/node | ~160 (mean 121 words @ ~1.3 tokens/word) |
| Nodes | 1,080 |
| Total input tokens | ~130K |
| Total output tokens | ~173K |
| Cost (flash-lite: $0.375/$1.50 per 1M) | **~$0.31** |
| Time (1-2s per call, sequential) | ~20 min |
| Time (batched, 10 concurrent) | ~2 min |

Per-edit regeneration cost: negligible ($0.0003).

### 3.2.1 MaxTokens

Set `-MaxTokens 400` for generation calls. The longest validated output (skp-beliefs-007) was 147 words / ~200 tokens. 400 provides comfortable headroom for edge cases without risking runaway output. The previous 150-token limit caused truncation on complex nodes.

### 3.3 Temperature

**0.2** — low enough for consistency, high enough to avoid verbatim repetition across similar nodes.

### 3.4 Golden Test Set (validated against revised prompt)

7 samples covering simple, complex, multi-part, and nuanced nodes. All tested with `gemini-3.5-flash-lite`, temp 0.2, max_tokens 400.

| Node | Complexity | Word count | CL verdict | Notes |
|------|-----------|------------|------------|-------|
| acc-desires-001 | Simple | 107 | PASS | Encompasses items woven into prose naturally |
| acc-beliefs-003 | Medium | 112 | PASS | Technical layers explained without jargon |
| acc-intentions-001 | Complex, multi-part | 130 | PASS | Dense policy content faithfully expanded |
| saf-desires-001 | Medium | 92 | PASS | Existential risk concepts clear |
| skp-beliefs-006 | Medium-high | 136 | PASS | Project Maven example preserved, nuanced |
| skp-beliefs-007 | Very high (most complex in corpus) | 147 | PASS | Multiple empirical claims + Slovak case + precautionary argument all covered |
| sit-006 | Medium | 120 | PASS | Ethical framing preserved |

**Word count range:** 92–147 words (mean: 121). All within the 40–150 target. Complex multi-part nodes use the full range; simpler nodes stay shorter.

**Quality observations:**
- Encompasses items are consistently woven into the body text as natural prose
- No meaning lost, softened, or editorialized
- Jargon replaced appropriately ("telemetry" → "monitoring", "post-scarcity" → "where resources are no longer scarce")
- Active voice used throughout
- DOLCE opener dropped in all cases

<details>
<summary>Full generated samples (click to expand)</summary>

**acc-desires-001** (107 words):
> Many people hope that artificial intelligence will eventually solve our most difficult human problems, such as poverty, sickness, and social inequality. This vision sees AI as a powerful, kind force that could eliminate the threat of global disasters and lead us into a future where resources are no longer scarce. In this view, AI acts as a moral tool capable of fixing every major challenge facing our civilization. Rather than focusing on how the technology works or how it might be used for war, this perspective centers on the belief that AI will ultimately act as a universal solution to improve the human condition and ensure our long-term survival.

**acc-beliefs-003** (112 words):
> To keep complex systems reliable, you must build a multi-layered safety net that monitors performance in real time rather than just checking for errors before a system launches. This approach moves away from trusting a model's internal logic to keep it safe. Instead, it uses automated tools to enforce strict rules on how the system communicates. It also relies on constant monitoring to spot strange behavior as it happens. When the system detects an anomaly, it automatically fixes the issue or triggers a response. For the highest-risk situations, the system requires a human to step in and verify the output. By combining these automated checks with human oversight, you create a dynamic defense that adapts to problems instantly.

**acc-intentions-001** (130 words):
> This approach pushes for rapid development of artificial general intelligence by using competitive, decentralized systems to keep creators accountable. Instead of relying on government gatekeepers to certify safety, this model uses open-source tools and public ownership to manage progress. It relies on aggressive resource allocation to speed up development while using shared liability and decentralized monitoring to ensure safety. By integrating technical audits and constant performance tracking, the system forces developers to stay responsible without needing centralized control. This strategy rejects private, state-contracted crash programs, favoring a model where the technology remains a public asset that is developed quickly through open competition and transparent, community-driven oversight.

**saf-desires-001** (92 words):
> This goal focuses on preventing advanced artificial intelligence from causing permanent, humanity-ending disasters or stripping people of their ability to make their own choices. It prioritizes long-term survival by addressing existential risks, such as the possibility of AI causing human extinction through misalignment with our values. It also includes efforts to stop AI from helping create global biological threats. This perspective specifically targets these high-stakes, civilization-level dangers rather than focusing on smaller, everyday issues like data privacy, temporary economic shifts, or common problems with how algorithms handle bias.

**skp-beliefs-006** (136 words):
> Many skeptics argue that the ethical promises made by private AI companies are often just for show. While these labs and their employees may claim to follow strict moral guidelines, these principles frequently crumble when faced with the pressure of corporate profits or government demands. Often, a company's "ethical redlines" serve more as a marketing tool than a genuine commitment. This pattern is clear when labs abandon their values to secure lucrative military contracts, such as Project Maven. Even when employees voice internal concerns, their dissent is usually too fragile to overcome the company's financial incentives. Ultimately, when the government or big business uses its purchasing power to influence these labs, the companies tend to prioritize their bottom line over the ethical standards they once claimed to uphold.

**skp-beliefs-007** (147 words):
> Skeptics argue that we lack solid proof that AI-generated misinformation has actually changed the results of democratic elections. While they don't deny that AI poses risks, they point out that deepfakes are often no more persuasive than traditional propaganda. Instead, political polarization remains the primary driver of how people vote. Sociological studies show that people's media habits are deeply ingrained, making them resistant to sudden changes. Even when incidents occur — like the synthetic audio released in Slovakia just before their election — there is no clear evidence that fact-checking after the fact can undo the damage. However, these skeptics do acknowledge that because elections are final and AI content spreads incredibly fast, we must remain cautious. They simply maintain that the current data does not yet confirm that AI has decisively tipped the scales of a democratic vote.

**sit-006** (120 words):
> This issue examines the ethical and practical problems that arise when AI systems work well for most people but fail specific groups or in unique situations. A major part of this debate involves deciding what level of performance an AI must reach before it is safe to use in the real world. This is especially critical because AI errors are rarely distributed evenly. When a system is flawed, it often disproportionately harms people who are already disadvantaged or marginalized. We must determine if it is acceptable to launch a tool that performs well on average if it creates significant risks for certain populations. This focus on performance thresholds and the unfair distribution of failures helps us understand the true cost of deploying new technology.

</details>

---

## 4. Data Model

### 4.1 Type Changes

In `lib/debate/taxonomyTypes.ts`:

```typescript
interface PovNode {
  // ... existing fields ...
  description: string;
  /** Auto-generated plain-language version of description. Read-only. */
  plain_description?: string | null;
  /** Model+prompt version used to generate plain_description, for staleness detection. */
  plain_description_version?: string | null;
  // ...
}

interface SituationNode {
  // ... existing fields ...
  description: string;
  plain_description?: string | null;
  plain_description_version?: string | null;
  // ...
}
```

**Field naming:** `plain_description` — matches the toggle label "Plain" and is self-documenting in JSON.

**Version string format:** `"flash-lite:v1"` — model + prompt version. When the prompt is revised, increment version. Nodes with stale versions can be batch-regenerated.

### 4.2 JSON Storage

The `plain_description` field lives alongside `description` in the taxonomy JSON files:

```json
{
  "id": "acc-desires-001",
  "description": "A Desire that AI will resolve fundamental human problems...",
  "plain_description": "People hope that AI will solve major human problems like disease, poverty, and inequality.",
  "plain_description_version": "flash-lite:v1"
}
```

### 4.3 User Preference

Add a user setting for the default view:

```typescript
interface UserPreferences {
  // ... existing ...
  /** Which description mode to show by default. Defaults to 'plain'. */
  defaultDescriptionMode?: 'formal' | 'plain';
}
```

Stored in the existing user preferences mechanism (localStorage in Electron, sessionStorage in web).

---

## 5. Display UX

### 5.1 Toggle Component

A reusable `DescriptionToggle` component:

```
┌─────────────────────────────────────────────────────┐
│ People hope that AI will solve major human problems │
│ like disease, poverty, and inequality.              │
│                                    [ Formal | Plain ]│
└─────────────────────────────────────────────────────┘
```

- **Position:** Bottom-right of the description display area
- **Size:** Small pill toggle, ~12px font
- **Behavior:** Clicking switches between `description` and `plain_description`
- **Default:** User's `defaultDescriptionMode` preference (defaults to `plain`)
- **Missing state:** If `plain_description` is null, show formal with a muted "(plain version generating...)" indicator
- **Keyboard:** Toggle on pressing `Alt+P` when description area is focused

### 5.2 Display Locations

| Location | File | Current display | Toggle needed | Notes |
|----------|------|----------------|---------------|-------|
| Node detail (Content tab) | `NodeDetail.tsx:427` | `HighlightedTextarea` | Yes — show toggle ABOVE the editable formal textarea | When in Plain mode, show read-only plain text; formal textarea always visible below for editing |
| Situation detail | `SituationDetail.tsx` | Textarea | Yes — same pattern as NodeDetail | |
| Search results | `FindBar.tsx`, `SearchPanel.tsx` | Inline text | Yes — toggle per result | May want a global toggle for all results |
| Edge browser | Search results | Inline text | Yes | |
| QBAF overlay tooltips | `QbafOverlay.tsx` | Tooltip | No toggle — always show plain | Tooltips are too small for a toggle; plain is more useful |
| Debate workspace | `StatementCard.tsx` | Inline | Yes | |
| POViewer | `MappingBlock.tsx:40-42` | Div | Yes | |
| Analysis panels | Multiple | Inline | Yes — global toggle for panel | |
| Conflict detail | `ConflictDetail.tsx` | Inline | Yes | |

### 5.3 NodeDetail Edit View (special case)

The node detail panel is the primary edit location. Layout:

```
┌── Content Tab ──────────────────────────────────────┐
│                                                     │
│ Description (Formal — source of truth)              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ A Belief within accelerationist discourse that  │ │
│ │ reliability requires a multi-layered safety...  │ │ ← Editable textarea
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Plain language (auto-generated, read-only)           │
│ ┌─────────────────────────────────────────────────┐ │
│ │ To keep systems reliable, you must use multiple │ │
│ │ layers of automated safety checks...            │ │ ← Read-only, muted style
│ └─────────────────────────────────────────────────┘ │
│ ↻ Regenerate                                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- Both descriptions always visible in the edit view (no toggle needed here)
- Plain version has a muted border/background to signal read-only
- "Regenerate" link below to manually trigger regeneration
- When the formal description is edited and saved, the plain version shows "Regenerating..." and auto-refreshes

---

## 6. Debate Reflection Integration

### 6.1 Taxonomy Suggestions (clarifies_taxonomy)

When the debate engine proposes a description update via `clarifies_taxonomy`:

- The review UI shows the **formal** (DOLCE) version by default — this is what the reviewer is approving
- A toggle shows a **preview** of what the plain version would look like (generated on-demand when toggled)
- On acceptance, both `description` and `plain_description` are updated atomically

### 6.2 Debate Context Display

When debate prompts reference node descriptions (Brief stage, taxonomy context blocks):

- The debate engine always uses the **formal** description — it's the source of truth for AI reasoning
- No change to `helpers.ts:stripExcludes()` or any prompt template
- The plain version is purely for human-facing display

### 6.3 Debate Diagnostics

In the debate diagnostics panel, node descriptions appear in:
- `EntryView.tsx` — show with toggle
- `OverviewView.tsx` — show with toggle
- `WhatIfSection.tsx` — show with toggle

---

## 7. Regeneration Triggers

Every code path that modifies `description` must trigger plain regeneration:

| Trigger | Location | Mechanism |
|---------|----------|-----------|
| Manual edit | `NodeDetail.tsx` → `updatePovNode()` | On save, set `plain_description = null`, queue async regeneration |
| Manual edit | `SituationDetail.tsx` → `updateSituationNode()` | Same |
| Debate reflection acceptance | Debate store → `acceptTaxonomySuggestion()` | Regenerate after updating description |
| Batch audit | Python `_apply_hierarchy.py` | After script completes, run batch regeneration on changed nodes |
| Crux promotion | `cruxTaxonomyFeedback.ts:buildDraftSituationNode()` | Generate plain alongside draft description |

### 7.1 Regeneration Flow

```
User edits formal description
  → Save to store (description = new text, plain_description = null)
  → UI shows "Regenerating..." in plain area
  → Async: call flash-lite with generation prompt
  → On success: update plain_description + plain_description_version
  → On failure: leave plain_description = null, show "Unavailable" indicator
  → No retry — user can click "Regenerate" manually
```

### 7.2 Batch Regeneration Script

For initial population and version upgrades:

```powershell
# Regenerate all nodes missing or stale plain_description
Invoke-VernacularBatch -TaxonomyPath $dataRoot/taxonomy/Origin `
    -Model 'gemini-3.5-flash-lite' -Version 'flash-lite:v1' `
    -Concurrency 10 -Force:$false
```

`-Force` regenerates all; without it, only null or stale-version nodes are regenerated.

---

## 8. Edge Cases

| Case | Behavior |
|------|----------|
| Generation fails (API error) | Show formal with "(plain version unavailable)" indicator. Manual "Regenerate" link. |
| Very short description (< 20 chars) | Skip generation — use description as-is for both modes |
| Deprecated nodes (`[DEPRECATED]` prefix) | Skip generation — show formal only |
| Missing Gemini API key | Cannot generate — show formal only. Log warning once per session. |
| Import/export JSON | Include `plain_description` in export. On import, regenerate if missing. |
| Prompt version upgrade | Batch-regenerate all nodes with stale `plain_description_version` |
| Node has no description | Skip — both modes show empty |

---

## 9. Settings UI

Add to the existing Settings panel:

```
Description Display
  Default view: ( ) Formal  (•) Plain
  
  [ Regenerate all plain descriptions ]  ← batch action, shows progress
```

---

## 10. Implementation Tickets

| Ticket | Title | Owner | Scope | Blocked by |
|--------|-------|-------|-------|------------|
| t/970 | Add `plain_description` fields to `PovNode` and `SituationNode` types | DebateTool | `lib/debate/taxonomyTypes.ts` | — |
| t/971 | `DescriptionToggle` component + user preference | Taxonomy Editor | `taxonomy-editor/src/renderer/components/shared/` | t/970 |
| t/975 | Wire toggle into all display locations | Taxonomy Editor | ~10 component files | t/971 |
| t/976 | NodeDetail edit view: show both descriptions | Taxonomy Editor | `NodeDetail.tsx`, `SituationDetail.tsx` | t/971 |
| t/972 | Regeneration on description edit | Taxonomy Editor | Store hooks, server endpoint | t/970 |
| t/977 | Debate reflection plain preview | Taxonomy Editor | Debate diagnostics + reflection UI | t/971, t/972 |
| t/973 | Batch regeneration script (`Invoke-VernacularBatch`) | PowerShell | `scripts/AITriad/Public/` | t/970 |
| t/978 | Initial batch generation (1,080 nodes) | CL | Run script, review samples | t/973 |
| t/979 | Settings UI for default view | Taxonomy Editor | Settings panel | t/971 |
| t/974 | POViewer plain description support | Taxonomy Editor | `MappingBlock.tsx` | t/970 |

**Estimated total effort:** ~3-4 days across roles.

---

## 11. What This Does NOT Change

- **Debate prompts** — always use formal descriptions. Plain is never sent to the AI.
- **Calibration metrics** — no impact. Metrics are computed from debate output, not display text.
- **Ontology compliance** — DOLCE format is preserved as the source of truth.
- **Embeddings** — computed from formal descriptions. Plain descriptions are not embedded.
- **Validation** — `audit_dolce_compliance.py` continues to validate formal descriptions only.
- **Search** — searches both formal and plain text for better discoverability.

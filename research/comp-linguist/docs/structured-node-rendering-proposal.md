# Structured Node Rendering for LLM Prompts

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-28
**Status:** REJECTED

---

## Problem

POV taxonomy node descriptions are currently stored as DOLCE genus-differentia prose with embedded scope markers:

```
A Desire within accelerationist discourse that advocates for deploying
advanced artificial intelligence to eradicate material scarcity and
resolve macro-scale civilizational bottlenecks.
Encompasses: The application of AI to achieve resource abundance, climate
stabilization, and universal healthcare provision.
Excludes: The military application of AI and the architectural proposition
of AI as a civilizational operating system.
```

This is rendered verbatim into debate prompts. Three problems:

1. **Redundant genus prefix** — "A Desire within accelerationist discourse that" repeats information already conveyed by the BDI section header and node ID (`acc-desires-001`). Wastes ~10 tokens per node.
2. **Prose-embedded structure** — the Encompasses/Excludes boundaries are free-text markers baked into a paragraph. Fragile to parse, impossible to query, and force the LLM to disentangle structure from prose.
3. **Inconsistent formatting** — some descriptions use `\nEncompasses:`, some use `. Encompasses:`, some omit Encompasses/Excludes entirely. The LLM processes each one differently.

## Proposal: Decompose at Storage, Render from Structure

### Step 1: Decompose the description into structured fields

Add three fields to `PovNode` (alongside the existing `description`):

```typescript
interface PovNode {
  // Existing
  description: string;     // Keep as canonical DOLCE form for human display

  // New structured fields (derived from description)
  core_description?: string;   // The differentia only — no genus prefix
  inclusions?: string[];       // What the node encompasses (semicolon-delimited items)
  exclusions?: string[];       // What the node excludes
}
```

**Migration:** A one-time batch script decomposes existing descriptions:

```
Input:  "A Desire within accelerationist discourse that advocates for
         deploying advanced AI to eradicate material scarcity...
         \nEncompasses: resource abundance, climate stabilization,
         universal healthcare.\nExcludes: military AI, AI as OS."

Output:
  core_description: "Prioritizes deploying advanced AI to eradicate
                     material scarcity and resolve macro-scale
                     civilizational bottlenecks."
  inclusions: ["Resource abundance", "Climate stabilization",
               "Universal healthcare provision"]
  exclusions: ["Military application of AI",
               "AI as civilizational operating system"]
```

The `core_description` strips the genus prefix ("A Desire within accelerationist discourse that") and rewrites the opening verb to be more direct (e.g., "advocates for deploying" → "Prioritizes deploying"). This rewrite can be LLM-assisted for the initial batch, then human-reviewed.

### Step 2: Render from structure at prompt time

Replace the current verbatim injection in `formatTaxonomyContext` with a structured renderer:

```typescript
function renderNodeForPrompt(
  node: PovNode,
  relevanceScore: number | undefined,
  weightLabel: string,
  isPrimary: boolean,
): string {
  const prefix = isPrimary ? '★ ' : '  ';
  const scoreLabel = relevanceScore != null
    ? ` (relevance: ${relevanceScore.toFixed(2)})` : '';

  // Use structured fields when available, fall back to description
  const desc = node.core_description ?? node.description;

  const lines: string[] = [
    `${prefix}[${node.id}]${scoreLabel}${weightLabel} ${node.label}:`,
    `  ${desc}`,
  ];

  if (node.inclusions && node.inclusions.length > 0) {
    lines.push(`  Includes: ${node.inclusions.join('; ')}.`);
  }
  if (node.exclusions && node.exclusions.length > 0) {
    lines.push(`  Excludes: ${node.exclusions.join('; ')}.`);
  }

  return lines.join('\n');
}
```

### Output comparison

**Current (verbatim prose):**
```
★ [acc-desires-001] (relevance: 0.80) (priority: 5/5) Achieving Global
  Post-Scarcity: A Desire within accelerationist discourse that advocates
  for deploying advanced artificial intelligence to eradicate material
  scarcity and resolve macro-scale civilizational bottlenecks.
  Encompasses: The application of AI to achieve resource abundance, climate
  stabilization, and universal healthcare provision.
  Excludes: The military application of AI and the architectural
  proposition of AI as a civilizational operating system.
```

**Proposed (structured rendering):**
```
★ [acc-desires-001] (relevance: 0.80) (priority: 5/5) Achieving Global Post-Scarcity:
  Prioritizes deploying advanced AI to eradicate material scarcity and resolve macro-scale civilizational bottlenecks.
  Includes: Resource abundance; climate stabilization; universal healthcare provision.
  Excludes: Military AI applications; AI as civilizational operating system.
```

## Benefits

### 1. Token savings

| Component | Current | Proposed | Savings |
|-----------|:-------:|:--------:|:-------:|
| Genus prefix per node | ~10 tokens | 0 | ~10 tokens |
| "The application of AI to achieve" → "Resource abundance" | ~8 tokens | ~3 tokens | ~5 tokens |
| Scope delimiters (Encompasses → Includes) | ~2 tokens | ~1 token | ~1 token |
| **Per node total** | | | **~16 tokens** |
| **Per prompt (25 nodes)** | | | **~400 tokens** |

400 tokens is ~2% of a typical debate prompt (16K-29K chars). Not transformative, but it's free savings from removing redundancy.

### 2. Consistency

Every node renders identically: `core_description` + `Includes:` + `Excludes:`. No variation between `\nEncompasses:`, `. Encompasses:`, and missing scope markers. The LLM processes a predictable format every time.

### 3. Queryability

Structured `inclusions[]` and `exclusions[]` arrays are queryable — you can ask "which nodes include 'resource abundance'?" or "which nodes exclude military applications?" without parsing free text. This feeds into:
- Situation matching (situations that overlap with node inclusions)
- Edge discovery (nodes whose inclusions/exclusions complement each other)
- Taxonomy health checks (nodes with empty inclusions)

### 4. LLM attention efficiency

The LLM doesn't need to parse prose structure to understand scope. `Includes: X; Y; Z.` is a signal-dense format — each item gets attention weight proportional to its content, not its surrounding syntax.

## Migration Plan

### Phase 1: Decomposition script

A batch script (following the `assignWeights.ts` pattern) that:
1. Loads all POV nodes
2. For each node, extracts `core_description`, `inclusions`, `exclusions` from the `description` field using pattern matching:
   - Strip genus prefix: `/^A (?:Belief|Desire|Intention) within \w+ discourse that /i`
   - Extract Encompasses: `/(?:\n|\.)\s*Encompasses:\s*(.+?)(?:\n|\.(?=\s*Excludes))/s`
   - Extract Excludes: `/(?:\n|\.)\s*Excludes:\s*(.+?)\.?\s*$/s`
   - Split on `, ` or `and ` for array items
3. For nodes where the regex extraction fails (ambiguous formatting), flag for human review
4. Write the structured fields back to the POV JSON files
5. `--dry-run` shows extraction results without writing

**LLM-assisted rewrite (optional Phase 1b):** For `core_description`, the genus prefix strip + verb rewrite could be done by an LLM for more natural output. Run once, human-review the batch.

### Phase 2: Renderer update

Update `formatTaxonomyContext` to call `renderNodeForPrompt` instead of the current inline rendering. Fall back to `node.description` when structured fields are absent (backward compat).

### Phase 3: Prompt authoring pipeline

Update the taxonomy proposal and hierarchy proposal prompts (in `scripts/AITriad/Prompts/`) to generate `core_description`, `inclusions`, and `exclusions` as separate fields when creating new nodes. This ensures all future nodes are born structured.

## What Does NOT Change

- **The canonical `description` field stays.** It's the DOLCE genus-differentia form used in the taxonomy editor, human review, and ontological compliance checks. The structured fields are *derived*, not *replacing*.
- **Graph attributes render separately.** The existing `epistemic_type`, `rhetorical_strategy`, `falsifiability`, `assumes`, `intellectual_lineage` lines remain unchanged — they already render cleanly.
- **The DOLCE vocabulary in AGENTS.md stays.** Genus-differentia is the authoring standard. The structured fields are a rendering optimization for prompt injection.

## Open Questions

1. **Should `core_description` be auto-generated or human-authored?** Auto-generation (regex strip + optional LLM rewrite) is faster but may lose nuance. Human authoring is slower but guaranteed quality. Recommendation: auto-generate with human spot-check on the first batch.

2. **Should inclusions/exclusions be normalized?** "Resource abundance" vs "the application of AI to achieve resource abundance" — the current prose wraps each inclusion in a full clause. Normalizing to short noun phrases is more scannable but loses context. Recommendation: normalize to short phrases (regex or LLM-assisted), flag outliers for human review.

3. **How many nodes lack Encompasses/Excludes entirely?** If a significant fraction of nodes don't have scope markers, the structured fields will be sparse. The renderer must handle this gracefully (just show `core_description` without Includes/Excludes lines).

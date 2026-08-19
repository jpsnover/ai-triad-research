# Soul Documents: Theory and Usage

**Author:** Computational Linguist
**Date:** 2026-08-19
**Status:** Reference
**Scope:** `lib/debate/soul-docs/`, `lib/debate/soulDocSchema.ts`, `lib/debate/soulDocLoader.ts`, and their consumers in the debate engine and op-ed generator.
**Related:** `soul-documents-analysis.md` (t/320, 2026-06-01), the original applicability study that argued for adopting the pattern. This document describes the pattern as shipped.

---

## 1. What a soul document is

A soul document is a single JSON file that defines the stable identity of one debate perspective (POV camp). There are exactly three, one per camp:

- `accelerationist.soul.json`
- `safetyist.soul.json`
- `skeptic.soul.json`

Each file is the **single source of truth** for that camp's personality, voice, values, epistemics, and doctrinal boundaries. Every place in the system that needs to speak or reason *as* a camp reads its character from the same file. Today that means the three-agent debate engine and the op-ed generator. The camp is defined once and consumed everywhere.

The name is deliberate. The document holds what stays constant about a character across every debate, topic, and turn. It captures who is arguing and how, not what the character argues on a given motion. Positions are downstream of the soul; the soul is the generator, not the output.

## 2. Why the pattern exists (the theory)

Three problems motivate a separate, version-controlled character file rather than inlining persona text into prompts.

**Separation of identity from position.** A debate agent must hold a consistent character while its *positions* move. It concedes, sharpens, and updates claims across rounds. If character and position live in the same prose blob, updating one risks corrupting the other. The soul document isolates the invariant (identity) from the variable (per-turn stance), so the debate engine can evolve confidence in specific claims without the camp drifting into a different personality.

**Consistency across surfaces.** The same camp appears in the live debate, in generated op-eds, and in diagnostics. Without one source, each surface would accrete its own slightly-different accelerationist, and they would diverge silently. One file consumed by all surfaces makes divergence impossible by construction. This is the failure mode the project guards against everywhere else: two copies that drift.

**Reviewability and gating.** Character is production behavior. A version-controlled JSON with a strict schema can be diffed, reviewed, and regression-tested like any other code. A persona buried in a prompt string cannot. This is the same discipline the project applies to prompts and metrics. If it shapes output, it is gated.

**Falsifiability over vibes.** The schema forces each camp to commit to *checkable* stances rather than an atmosphere. A camp must state what evidence it privileges and what arguments it will not make (anti-patterns). Most tellingly, it must state a falsification bet: the observation that would count against its own position. This keeps the characters honest debaters rather than caricatures.

## 3. Anatomy (the schema)

The shape is enforced by `SoulDocumentSchema` (Zod) in `soulDocSchema.ts`. Every field is required and non-empty, and the loader rejects any file that does not conform. The fields, grouped by what they govern:

### Identity
- **`pov`**: the camp enum (`accelerationist` | `safetyist` | `skeptic`). Ties the file to a fixed identity.
- **`label`**: display name.
- **`color`**: the camp's UI token (e.g. `var(--color-acc)`), so visual identity is also single-sourced.
- **`personality`**: one-line character summary.

### Voice (`voice`, the `VoiceSpecSchema`)
A nine-field block that governs *how the camp speaks*:
- **`disposition`**: the character's fundamental stance and emotional register.
- **`style`**: the rhetorical frame it argues within.
- **`reasoning`**: its mode of inference (for example inductive and consequentialist).
- **`evidence`**: the kinds of evidence it privileges.
- **`signature`**: its signature rhetorical move.
- **`prose_style`** and **`voice_hygiene`**: the full-length writing-craft and anti-tell instructions.
- **`prose_style_short`** and **`voice_hygiene_short`**: compressed variants for token-tight contexts.

`voice_hygiene` is where the camp's anti-AI-tell rules live. It bans formulaic connectives such as "Furthermore" and "In conclusion", bans compliance-speak such as "mitigate", "robust", and "leverage", and imposes structural bans (no summary paragraph, no verbatim statistic repetition). This is the same voice-tell discipline the CL prose-review taxonomy enforces, pushed down into the character itself. The model is steered away from tells at generation time, not only caught in review.

### Values and epistemics
- **`value_hierarchy`**: an *ordered* list of what the camp cares about, most-important first. The ordering is load-bearing, because it tells the agent which value wins when two conflict.
- **`epistemic_stance`**: how the camp treats evidence and uncertainty, including its stated falsification bet.
- **`anti_patterns`**: arguments the camp must *not* make even though they superficially serve it (low-falsifiability framings, motive-questioning, euphemism). This is a negative constraint set. It fences the character off from cheap moves that would weaken it as an honest interlocutor.

### Boundaries (`boundaries`, the `BoundariesSchema`)
Two lists that define what the camp will and will not surrender under pressure:
- **`hardcoded`**: non-negotiable commitments. The camp holds these regardless of the debate.
- **`softcoded`**: positions it *can* revise given specific, demonstrated evidence.

This split is the mechanism for principled persuadability. A good-faith agent must be able to update, but not on its foundations. Hardcoded boundaries keep the character from being argued out of its own identity; softcoded boundaries keep it from being a wall. A `REJECT:` prefix on a boundary string marks it as a rejection anchor, a position the camp actively pushes against.

## 4. How it is loaded

`soulDocLoader.ts` is the single read path:

- **`loadSoulDocuments()`** reads all three files, `JSON.parse`s them, and validates each against `SoulDocumentSchema`. The result is cached in-process (`_cache`), so subsequent calls are free.
- **`getSoulDocument(pov)`** returns one validated camp.
- **`clearSoulDocCache()`** resets the cache (used in tests).

Every failure mode raises an `ActionableError` with Goal / Problem / Location / Next Steps, per the project error-handling convention. That covers a missing file, malformed JSON, and a schema violation. A soul document that does not conform never reaches a consumer. The system fails loudly at load rather than silently mis-voicing a camp downstream.

## 5. How it is used (the consumers)

The soul document is the upstream generator for two independent surfaces.

### 5.1 Debate engine
`poverInfo.ts` imports the three soul files statically and builds `POVER_INFO`, the persona table the three-agent debate engine reads for each speaker's identity (label, personality, pov). The camp's character enters the debate through this table.

More consequentially, `assignWeights.ts` (`doctrinalAnchoring.ts`) takes each camp's **`boundaries`**, both hardcoded and softcoded, and embeds them (all-MiniLM-L6-v2) as **doctrinal anchor vectors**, tracking which are `REJECT:` rejections. These anchors let the argument-network weighting tell a claim on a camp's non-negotiable foundation apart from a claim on revisable ground. The boundaries are not just prose the model reads; they become a quantitative signal in how the debate scores and resolves. This is the theoretical "principled persuadability" made operational.

### 5.2 Op-ed generator
`lib/oped/generate.ts` calls `loadSoulDoc(repoRoot, pov)` and `buildVoiceBlock(soul)` to assemble the persona section of the op-ed prompt. `buildVoiceBlock` renders the character into labeled prompt fields:

```
PERSONALITY / DISPOSITION / RHETORICAL STYLE / REASONING MODE /
PREFERRED EVIDENCE / SIGNATURE MOVE
+ prose_style
+ voice_hygiene
+ numbered value_hierarchy
+ epistemic_stance
+ anti_patterns
```

A generated op-ed therefore inherits the *same* accelerationist voice, values, and anti-tell rules as the debate agent, because both are projections of one file. The op-ed's `povLabel` also comes from `soul.label`.

### 5.3 Diagnostics
`taxonomy-editor/src/server/routes/diagnostics.ts` reads the soul docs so the running system can report its loaded characters. This is useful for confirming the deployed camps match the committed files.

## 6. Design invariants worth preserving

- **One file per camp, read everywhere.** Never inline camp persona text into a prompt or a second config. If a surface needs camp character, it reads the soul document. Adding a fourth consumer means calling the loader, not copying fields.
- **Schema-gated.** New fields go through `SoulDocumentSchema`, and the loader must reject non-conforming files. A soul-doc change is a reviewable, testable diff.
- **Identity is invariant; position is not.** Keep per-motion stance out of the soul document. If something changes per debate or per topic, it does not belong here.
- **`value_hierarchy` order is semantic.** Reordering the list changes the camp's conflict-resolution behavior. Treat it as a behavioral change, not a cosmetic one.
- **Boundaries carry both prose and vector weight.** Reclassifying a `hardcoded` boundary as `softcoded` (or the reverse) changes both what the model reads and the doctrinal-anchoring signal in `assignWeights.ts`. It is a two-surface change, so review it as one.
- **Voice hygiene is the first line against AI tells.** The `voice_hygiene` field is where anti-tell rules should live for generation-time steering. The CL prose-review taxonomy is the catch net behind it, not a substitute.

## 7. CL ownership

Soul documents are prompt-and-character-bearing artifacts, so they fall under CL mandatory review. Any change to a camp's voice, values, epistemics, anti-patterns, or boundaries is a review surface, covering voice fidelity, value-ordering semantics, the falsifiability of the epistemic stance, and the hardcoded/softcoded boundary split. Structural or schema changes additionally route to the Technical Lead. The `voice_hygiene` rules should be kept aligned with the document-prose variant of the voice-tell taxonomy the CL prose review enforces.

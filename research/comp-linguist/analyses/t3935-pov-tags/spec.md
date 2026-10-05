# POV tags: specification

**Author:** Computational Linguist
**Date:** 2026-10-05
**Ticket:** t/3935 (decision record t/3935#1)
**Status:** Draft. Six decisions run on proposed defaults until the PI confirms them (section 9). Nothing is built before TL design review and the mandatory Second Opinion (section 8).
**Background:** `research/comp-linguist/analyses/t3932-skeptic-split/analysis.md`

## 1. What the PI decided

The Skeptic camp gets two wings, expressed as **tags**, and the capability is general-purpose so that Accelerationist and Safetyist can get tags later.

- The first tags are **Critical** and **Institutional**, both on Skeptic.
- A POV item (a node in `accelerationist.json`, `safetyist.json` or `skeptic.json`) can carry **any number** of its own POV's tags.
- Each tag has its **own soul document**. The general POV soul document stays.
- In a debate, chat, question or op-ed, the user may pick **one tag**. Its soul document then **replaces** the POV soul document.
- With a tag picked, the user chooses a mode:
  - **SCOPE:** only POV items carrying the tag are used.
  - **PRIORITIZE:** POV items carrying the tag get a ranking boost.
- Tags never affect **identification**.
- The taxonomy editor can **filter** by tag.
- Everything that is not a POV item (situations, cruxes, conflicts and so on) **ignores tags**. Under a Skeptic tag, these are included as they are for Skeptic today.

## 2. Data model

### 2.1 The tag registry

A new file, `taxonomy/Origin/pov-tags.json` in the data repo, defines which tags exist:

```json
{
  "version": 1,
  "povs": {
    "skeptic": [
      { "id": "critical", "label": "Critical", "soul_doc": "skeptic.critical", "description": "AI is overhyped; the harm is power and extraction. Bender, Doctorow." },
      { "id": "institutional", "label": "Institutional", "soul_doc": "skeptic.institutional", "description": "AI is a normal technology; existing institutions, adapted, can govern it. Narayanan and Kapoor." }
    ]
  }
}
```

- **Ids:** a tag id is lowercase kebab-case and unique within its POV.
- **Adding a tag is configuration, not code:** a registry entry plus a soul document (default for decision 6).
- **A POV with no entry has no tags,** so Accelerationist and Safetyist need no change today.

### 2.2 Tags on nodes

The field is `graph_attributes.pov_tags`, an array of tag ids from the node's own POV in the registry.

- **Empty or absent means untagged.** Most nodes stay untagged.
- **Shared ground carries both tags.** A node relevant to both wings is tagged `["critical", "institutional"]`.
- **Validation** checks that every id exists in the registry under the node's POV and that no id repeats.
- **Situation nodes never carry `pov_tags`.** Validation rejects it there, which keeps the "non-POV items ignore tags" rule enforceable.

This is a normative, additive change to `lib/schema/taxonomy-schema.json` (minor version), so it needs CL+TL co-sign and the t/3361 Second Opinion.

### 2.3 Identification is untouched

Tags play no part in which POV or node a document's claims map to. Extraction, summarization and the policy and conflict pipelines never read them. Node ids (`skp-*` and so on) are unchanged. (Default for decision 1.)

## 3. Soul documents

- **Naming:** tag souls live beside the POV souls as `lib/debate/soul-docs/<pov>.<tag>.soul.json`, for example `skeptic.critical.soul.json`.
- **Schema:** `SoulDocumentSchema` gains an optional `tag` field. A tag soul's `pov` must equal its file's POV, and its `tag` must exist in the registry.
- **Loader:** `soulDocLoader` gains `getSoulDocument(pov, tag?)`. It returns the tag soul when a tag is given and the POV soul otherwise. A missing tag soul is an `ActionableError`, never a silent fallback to the POV soul.
- **Doctrinal anchoring** (`assignWeights.ts` and the anchoring inside `selectRelevantTaxonomy`) uses the boundaries of whichever soul is active.

**Rebalancing the general Skeptic soul** (default for decision 4). The live `skeptic.soul.json` already voices the Critical wing. That voice moves into `skeptic.critical.soul.json`, built from the t/3932 draft. The general Skeptic soul is rewritten as a neutral umbrella that voices what both wings share: non-exceptionalism, and evidence about deployment over claims about capability.

The `skeptic.institutional.soul.json` is the t/3932 Institutionalist draft. Its label is "Institutional", its `pov` is `skeptic`, and its `tag` is `institutional`.

## 4. Selection and modes

- **One tag per POV seat** (default for decision 5). In a debate, each debater's seat has an optional tag and mode. In a chat, question or op-ed, the single POV involved has an optional tag and mode.
- **No tag selected:** today's behaviour, with the POV soul and all of the POV's items.
- **SCOPE:** the POV's candidate items are filtered to those whose `pov_tags` contain the tag, **before** relevance ranking. Untagged items are excluded (default for decision 2). The setup screen shows how many items are in scope and how many are untagged.
- **PRIORITIZE:** tagged items get a ranking boost; nothing is excluded.
- **Non-POV items.** Situations, cruxes and conflicts are selected as today for that POV under either mode.

## 5. Where the code plugs in

| Concern | Location | Owner |
|---|---|---|
| Node field and registry schema | `lib/schema/taxonomy-schema.json`; node types in `lib` and `taxonomy-editor` | Shared Lib, with CL+TL co-sign |
| Soul schema and loader | `lib/debate/soulDocSchema.ts`, `soulDocLoader.ts`, `poverInfo.ts` | DebateTool |
| Scope and Prioritize in ranking | `lib/debate/relevanceSelection.ts` (`selectRelevantTaxonomy`, the single selection pipeline) and `lib/debate/taxonomyRelevance.ts` (`selectRelevantNodes`) | DebateTool |
| Debate setup | `taxonomy-editor/src/renderer/components/debate/NewDebateDialog.tsx` and the debate store | DebateUI |
| Chat (and question) setup | `taxonomy-editor/src/renderer/components/chat/` | Chat |
| Op-ed | `lib/oped/generate.ts` (Shared Lib); `scripts/AITriad/Public/New-OpEd.ps1` (PowerShell) | Shared Lib, PowerShell |
| Editor filter and tag editing | `taxonomy-editor/src/renderer/components/taxonomy/PovTab.tsx`, `NodeDetail.tsx` | Rosetta Stone |
| Calibration logging | `lib/debate/calibrationLogger.ts` | DebateTool |
| Initial tags and soul content | the data repo, and `lib/debate/soul-docs/` content | CL |

**Prioritize precedent.** `selectRelevantNodes` already implements a `lineageBoost`. It boosts nodes whose intellectual lineage matches selected traditions, promotes them past the threshold, and records `boostedNodeIds` and `promotedNodeIds` in the injection manifest. A `tagBoost` should follow the same shape, so it is a small, well-trodden change.

**Parity constraint.** `selectRelevantTaxonomy` is guarded by a server-equals-client parity fixture. Scope and Prioritize must be applied inside it, not in one caller, or the fixture breaks.

## 6. Calibration and measurement

- **Per-run logging.** Each debate run records, per seat: `pov_tag` (or null), `tag_mode` (`scope`, `prioritize` or null), the number of items in scope, and the number of tagged items selected. The calibration metrics (`crux_addressed_rate`, `convergence_score`, `repetition_rate` and the rest) can then be compared across the Critical, Institutional and untagged arms.
- **Prioritize boost value.** It starts as a stipulated multiplier in `provisional-weights.json`, like the lineage boost, and is tuned in the pilot debates (section 7). Provenance class: stipulated until then. It is entered in `metric-provenance-register.md`.

## 7. Rollout

1. **Schema and registry.** TL design review, then the mandatory Second Opinion, then land.
2. **Soul documents.** Rebalance the umbrella Skeptic soul, add the Critical and Institutional souls, plus loader and schema support.
3. **Initial tagging of the Skeptic nodes** (default for decision 3):
   - an LLM proposes tags for every Skeptic node;
   - two annotators validate them on a sample, reporting counts and prevalence, with no κ on fewer than five positives (t/3587);
   - an editor reviews them in the taxonomy editor;
   - a /data-mutation write lands them, with PI authorization.
4. **Selection plumbing:** retrieval (Scope and Prioritize), then the debate, chat and op-ed setup screens, then calibration logging.
5. **Editor:** tag filter and tag editing (default for decision 6).
6. **Pilot debates.** Paired runs, with no tag versus each tag and Scope versus Prioritize, at n ≥ 10 per arm (replication gate). Tune the boost.

Steps 2, 4 and 5 can proceed in parallel once step 1 lands. Step 3 needs step 1.

## 8. Gates

- **Schema change (section 2.2):** CL+TL co-sign under the schema change-control rule, plus the **mandatory Second Opinion** (schema and data-model class, t/3361).
- **Cross-role interfaces:** TL design review (Main), covering the selection API change and the soul loader signature.
- **Data write (step 3):** /data-mutation, with PI authorization.

## 9. Open decisions: defaults pending PI confirmation

| # | Question | Proposed default |
|---|---|---|
| 1 | Does "identification" mean ingestion mapping? Do node ids stay? | Yes to both (section 2.3) |
| 2 | Are untagged items excluded under Scope? | Yes, with the untagged count shown at setup |
| 3 | How are the 372 Skeptic nodes tagged first? | LLM proposal, then sample validation, then editor review, then an authorized write |
| 4 | Is the general Skeptic soul rewritten as a neutral umbrella? | Yes; today's voice moves to the Critical tag |
| 5 | One optional tag per POV seat in a debate? | Yes |
| 6 | Can the editor edit tags, and is a new tag configuration only? | Yes to both |
| 7 | What is "question" in "debate/chat/question/op-ed"? | No separate feature exists in the code; read it as the chat modes. PI to confirm. |

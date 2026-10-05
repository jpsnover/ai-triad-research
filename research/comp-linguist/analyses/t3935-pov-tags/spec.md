# POV tags: specification

**Author:** Computational Linguist
**Date:** 2026-10-05 (revision 2, after TL design review t/3954#1)
**Ticket:** t/3935 (decision record t/3935#1); epic t/3954
**Status:** Draft. Seven decisions run on proposed defaults until the PI confirms them (section 9). The TL has approved the interfaces with conditions; the schema child t/3955 goes to the mandatory Second Opinion next (section 8).
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

### 2.1 The tag registry lives in the code repo, beside the souls

The registry is `lib/debate/soul-docs/pov-tags.json`:

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

**Why in code** (TL review, point 2): a tag needs both a registry entry and a soul document, and the souls live in the code repo. Keeping the pair together means:
- one PR adds a tag;
- one validator checks the pair, so every registry tag has a soul file and every tag soul file has a registry entry;
- both builds get the registry as a bundled import, so no bridge method, REST route or IPC handler is needed;
- the data-repo hooks, which already read code from `origin/main`, validate node `pov_tags` against it.

**Rejected alternative, kept for the Second Opinion package:** the registry in the data repo (`taxonomy/Origin/pov-tags.json`). It would need a read path in both builds (ServerAPI, ElectronMain and the bridge) plus a cross-repo check that the registry and souls stay in sync. That is more moving parts for no gain, since tags change at the pace of soul documents, not data.

**Rules**
- **Ids:** a tag id is lowercase kebab-case and unique within its POV.
- **Adding a tag:** a registry entry plus a soul document, in one PR (default for decision 6).
- **A POV with no entry has no tags,** so Accelerationist and Safetyist need no change today.

### 2.2 Tags on nodes: a top-level field

The field is a **top-level** node field, `pov_tags`: an array of tag ids from the node's own POV in the registry.

**Why not under `graph_attributes`** (TL review, point 1): `Invoke-AttributeExtraction.ps1:285` replaces a node's whole `graph_attributes` object on re-extraction (`$OrigNode.graph_attributes = $AttrObj`; verified on `main`). Curated tags stored there would be silently erased the next time a node is re-enriched. `graph_attributes` is the enrichment namespace; tags are curated, editor-owned data, like `label`.

**Rules**
- **Empty or absent means untagged.** Most nodes stay untagged.
- **Shared ground carries both tags.** A node relevant to both wings is tagged `["critical", "institutional"]`.
- **Validation** checks that every id exists in the registry under the node's POV and that no id repeats.
- **Situation nodes never carry `pov_tags`.** Validation rejects it there, which keeps the "non-POV items ignore tags" rule enforceable.

### 2.3 The debate record

Saved debates gain two optional fields per seat (TL review, point 3):
- `pov_tag`: a tag id, or absent;
- `tag_mode`: `scope` or `prioritize`, or absent.

**Absent means untagged,** so every existing saved debate still loads. The run also records the **soul file and soul version** each seat used (section 3).

### 2.4 Schema change control

Sections 2.1 to 2.3 are one normative, additive change, declared together in t/3955:
- `lib/schema/taxonomy-schema.json` (minor version);
- the registry schema;
- the debate record shape.

It needs CL+TL co-sign and the t/3361 Second Opinion.

### 2.5 Identification is untouched

Tags play no part in which POV or node a document's claims map to. Extraction, summarization and the policy and conflict pipelines never read them. Node ids (`skp-*` and so on) are unchanged. (Default for decision 1.)

## 3. Soul documents

- **Naming:** tag souls live beside the POV souls as `lib/debate/soul-docs/<pov>.<tag>.soul.json`, for example `skeptic.critical.soul.json`.
- **Schema:** `SoulDocumentSchema` gains an optional `tag` field. A tag soul's `pov` must equal its file's POV, and its `tag` must exist in the registry.
- **Loader (TypeScript):** `soulDocLoader` gains `getSoulDocument(pov, tag?)`. It returns the tag soul when a tag is given and the POV soul otherwise. A missing tag soul is an `ActionableError`, never a silent fallback to the POV soul. *TL-approved.*
- **Loader (PowerShell):** `New-OpEd.ps1` loads soul documents itself (lines 40 and 55). It needs the same tag-aware load and the same no-silent-fallback rule (t/3960).
- **Provenance:** every run records **which soul file and version** each seat used, so a debate can be reproduced and calibration arms compared like with like. *TL condition.*
- **Doctrinal anchoring** (`assignWeights.ts` and the anchoring inside `selectRelevantTaxonomy`) uses the boundaries of whichever soul is active.

**Rebalancing the general Skeptic soul** (default for decision 4). The live `skeptic.soul.json` already voices the Critical wing. That voice moves into `skeptic.critical.soul.json`, built from the t/3932 draft. The general Skeptic soul is rewritten as a neutral umbrella that voices what both wings share: non-exceptionalism, and evidence about deployment over claims about capability.

This rewrite changes every untagged Skeptic debate, so *TL conditions* apply:
- it lands **in the same PR** as the Critical tag soul, so the Critical voice is never missing;
- the soul version change is recorded;
- the pilot compares the old and new umbrella on untagged debates (t/3963).

The `skeptic.institutional.soul.json` is the t/3932 Institutionalist draft. Its label is "Institutional", its `pov` is `skeptic`, and its `tag` is `institutional`.

## 4. Selection and modes

- **One tag per POV seat** (default for decision 5). In a debate, each debater's seat has an optional tag and mode. In a chat, question or op-ed, the single POV involved has an optional tag and mode.
- **No tag selected:** today's behaviour, with the POV soul and all of the POV's items.
- **SCOPE:** the POV's candidate items are filtered to those whose `pov_tags` contain the tag, **before** relevance ranking. Untagged items are excluded (default for decision 2). The setup screen shows how many items are in scope and how many are untagged.
- **Scope never widens silently** (*TL condition*). If Scope leaves fewer POV items than the selection needs, setup refuses and shows the count. There is no quiet fallback to all items (Fallback-Path Logging rule).
- **PRIORITIZE:** tagged items get a ranking boost; nothing is excluded.
- **Non-POV items.** Situations, cruxes and conflicts are selected as today for that POV under either mode.
- **Pickers hide** for a POV whose registry entry has no tags.

## 5. Where the code plugs in

| Concern | Location | Owner |
|---|---|---|
| Node field, registry schema, debate record shape | `lib/schema/taxonomy-schema.json`; the registry schema; node and debate types in `lib` and `taxonomy-editor` | Shared Lib, with CL+TL co-sign |
| Registry file and pair validator | `lib/debate/soul-docs/pov-tags.json`, beside the souls | DebateTool, with CL content |
| Soul schema and loader | `lib/debate/soulDocSchema.ts`, `soulDocLoader.ts`, `poverInfo.ts` | DebateTool |
| Scope and Prioritize in ranking | `lib/debate/relevanceSelection.ts` (`selectRelevantTaxonomy`, the single selection pipeline) and `lib/debate/taxonomyRelevance.ts` (`selectRelevantNodes`) | DebateTool |
| Debate setup | `taxonomy-editor/src/renderer/components/debate/NewDebateDialog.tsx` and the debate store | DebateUI |
| Chat (and question) setup | `taxonomy-editor/src/renderer/components/chat/` | Chat |
| Op-ed | `lib/oped/generate.ts` (Shared Lib); `scripts/AITriad/Public/New-OpEd.ps1`, including its soul loading (PowerShell) | Shared Lib, PowerShell |
| Editor filter and tag editing | `taxonomy-editor/src/renderer/components/taxonomy/PovTab.tsx`, `NodeDetail.tsx` | Rosetta Stone |
| Calibration logging | `lib/debate/calibrationLogger.ts` | DebateTool |
| Initial tags and soul content | the data repo, and `lib/debate/soul-docs/` content | CL |

**Prioritize precedent.** `selectRelevantNodes` already implements a `lineageBoost`. It boosts nodes whose intellectual lineage matches selected traditions, promotes them past the threshold, and records `boostedNodeIds` and `promotedNodeIds` in the injection manifest. A `tagBoost` should follow the same shape.

**Parity constraint** (*TL condition*). `selectRelevantTaxonomy` is guarded by a server-equals-client parity fixture. Scope and Prioritize are applied inside it, and the fixture **gains tag cases** for both modes. Without them it would pass only because no case uses tags.

**Hosted web profile.** The registry is a bundled import, but the pickers and the editor still need checking on the hosted web profile before sign-off (data-read parity, t/2648).

## 6. Calibration and measurement

- **Per-run logging.** Each debate run records, per seat:
  - `pov_tag` (or null) and `tag_mode` (`scope`, `prioritize` or null);
  - the soul file and version;
  - the number of items in scope, and the number of tagged items selected.

  The calibration metrics (`crux_addressed_rate`, `convergence_score`, `repetition_rate` and the rest) can then be compared across the Critical, Institutional and untagged arms.
- **Prioritize boost value.** It starts as a stipulated multiplier in `provisional-weights.json`, like the lineage boost, and is tuned in the pilot debates (section 7). Provenance class: stipulated until then. It is entered in `metric-provenance-register.md`.

## 7. Rollout

The work ships as independent PRs to `main`, sequenced with `blocks` relations, with no epic branch (*TL decision*). Each child is backward compatible behind "no tag selected".

1. **Schema** (t/3955) blocks everything.
2. **Soul documents** (t/3956), with the umbrella rewrite and the Critical soul in one PR. **Loader, selection and logging** (t/3957).
3. **Pickers** (t/3958, t/3959) and **op-ed** (t/3960), all blocked by t/3957. **Editor** (t/3961), blocked by t/3955.
4. **Initial tagging of the Skeptic nodes** (t/3962, default for decision 3):
   - an LLM proposes tags for every Skeptic node;
   - two annotators validate them on a sample, reporting counts and prevalence, with no κ on fewer than five positives (t/3587);
   - an editor reviews them in the taxonomy editor;
   - a /data-mutation write lands them, with PI authorization.
5. **Pilot debates** (t/3963). Paired runs at n ≥ 10 per arm (replication gate): no tag, each tag under Scope and under Prioritize, and **old versus new umbrella on untagged debates**. Tune the boost.

## 8. Gates

- **Schema change (sections 2.1 to 2.4):** CL+TL co-sign under the schema change-control rule, plus the **mandatory Second Opinion** (schema and data-model class, t/3361). The package carries the section 2.1 and 2.2 choices and their rejected alternatives.
- **Cross-role interfaces:** TL design review done (t/3954#1). Approved with the conditions marked *TL condition* above.
- **Data write (t/3962):** /data-mutation, with PI authorization.

## 9. Open decisions: defaults pending PI confirmation

| # | Question | Proposed default |
|---|---|---|
| 1 | Does "identification" mean ingestion mapping? Do node ids stay? | Yes to both (section 2.5) |
| 2 | Are untagged items excluded under Scope? | Yes, with the untagged count shown at setup |
| 3 | How are the 372 Skeptic nodes tagged first? | LLM proposal, then sample validation, then editor review, then an authorized write |
| 4 | Is the general Skeptic soul rewritten as a neutral umbrella? | Yes; today's voice moves to the Critical tag |
| 5 | One optional tag per POV seat in a debate? | Yes |
| 6 | Can the editor edit tags, and is a new tag configuration only? | Yes to both |
| 7 | What is "question" in "debate/chat/question/op-ed"? | No separate feature exists in the code; read it as the chat modes. PI to confirm. |

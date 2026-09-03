# Concept & Entity ↔ BDI Grounding: access + UX spec

**Author:** Computational Linguist (CL.Investigate1)
**Date:** 2026-09-03
**Status:** Design/requirements. Implementation routed to owning roles (see §5).
**Related:** `claims-entity-fol-recommendations.md` §12–14 (the entity-vs-concept split and the BDI ↔ {entity, concept} grounding model this spec surfaces).

---

## 1. Problem

Three owner asks, 2026-09-03:

1. Concepts don't show up in the Vocabulary panel.
2. There is no `Get-Concept` cmdlet.
3. Concepts and entities should appear in the BDI user experience.

## 2. Ground truth (measured, not recalled — 2026-09-03)

The grounding data is **present and healthy**; the gaps are in access surfaces, not data.

- **Concepts** = the standardized dictionary, `term:*`, stored one-file-per-term at `<dataRoot>/dictionary/standardized/*.json`. **54 terms**, all `coinage_status: accepted`, each with `used_by_nodes[]` populated (e.g. `accountability_algorithmic` → 31 nodes).
- **Entities** = the register, `ent-*`, at `<dataRoot>/taxonomy/Origin/entities.json`. **465 records, 459 approved** (grew from the 78-record pilot).
- **BDI nodes carry forward refs.** In `taxonomy/Origin/<pov>.json`, nodes carry `concept_refs[]` (dense — 131/200 acc nodes, 411 refs) and `entity_refs[]` (sparse/precise — 4/200 acc nodes). Ref shape:
  `{ ref: "term:risk_existential", surface: "existential risk", method: "surface|embedding", link_confidence: 1.0, status: "linked|proposed" }`.
- **Consistency check passes:** all 54 referenced `term:*` slugs exist as dictionary files; 0 missing.

The asymmetry is by design (§12): BDI argues in **kinds** (concepts), names few **particulars** (entities). Concepts are the workhorse of BDI grounding; entities are a precise minority.

## 3. Ask #1 — Vocabulary panel shows no concepts

Data is valid, so this is a code/runtime fault. Both load paths are structurally correct and read the same valid files:

- **Electron:** `taxonomy-editor/src/main/ipc/taxonomyHandlers.ts` → `getDataRootPath()/dictionary/standardized/*.json` (local disk).
- **Web/server:** `GET /api/dictionary` (`server/routes/sources.ts`) → `server/storage/fileIO.ts:loadDictionary()` → **GitHub-backed storage backend** (`resolveDataPath('dictionary')`).

Owner reports **both** modes empty. Prioritized diagnosis:

1. **Observability first (blocks clean diagnosis).** `fileIO.ts:loadDictionary()` (~line 1380) and the Electron handler both **silently return empty** when the dictionary dir is missing/unreadable — no WARN. This violates the project Fallback-Path Logging rule (`docs/error-handling.md`) and is why an empty panel yields no signal. Add a WARN on each empty/missing-dir fallback recording *which path* and *why* (dir missing vs. empty vs. backend error), then the next empty panel is self-diagnosing.
2. **Web mode likely cause:** the 54 term files are not present in the GitHub-backed store the server reads (they exist in the local data repo). Confirm the dictionary tree is committed/pushed to that store.
3. **Electron mode likely cause:** `getDataRootPath()` resolving to a different root than `../ai-triad-data`, or a stale build predating the dictionary. Confirm resolution against `.aitriad.json` (`data_root: ../ai-triad-data`).
4. **Rule out terminology:** the panel tab is labeled **"Dictionary"**, not "Concepts". Confirm the 54 terms aren't simply under a differently-named tab before deeper work.

**Rendering is not suspect:** the live term files carry every field `StandardizedTerm` and `VocabularyPanel.tsx` expect (`canonical_form`, `display_form`, `definition`, `coinage_status`, `used_by_nodes`, `characteristic_phrases`, …).

## 4. Ask #2 — `Get-Concept` cmdlet

Concepts are TS-first (`lib/dictionary/DictionaryLoader`); no reader cmdlet exists. Proposed contract (`/add-ps-cmdlet`, PowerShell scope):

```
Get-Concept [[-Slug] <string>]            # e.g. "risk_existential" or "term:risk_existential"; omit for all 54
            [-Camp <acc|saf|skp>]         # filter by primary_camp_origin
            [-Status <accepted|provisional|contested|deprecated>]
            [-UsedByNode <nodeId>]        # reverse map: concepts grounding a given BDI node
            [-IncludeColloquial]          # also emit the 33 colloquial terms
```

- **Source:** `<dataRoot>/dictionary/standardized/*.json` (+ `colloquial/*.json` when asked). Resolve `<dataRoot>` via the standard priority (`$env:AI_TRIAD_DATA_ROOT` > `.aitriad.json` > monorepo fallback) — do not hardcode.
- **Output objects:** `CanonicalForm, DisplayForm, Definition, Camp, Status, UsedByNodes[], CharacteristicPhrases[], SeeAlso[], CoinedAt, CoinedBy`. Emit objects (not text) so it composes in the pipeline.
- **`-UsedByNode`** reads the node's `concept_refs[]` (or the reverse `term.used_by_nodes[]`) and returns the matching term objects — the direct concept↔BDI query.
- **Errors:** missing dict dir → `New-ActionableError` (Goal/Problem/Location/Next Steps), not a silent empty.
- **Register parity note:** consider a sibling `Get-Entity` (reads `entities.json`) for symmetry, since the owner's "entities" includes both — separate ticket, PowerShell's call.

## 5. Ask #3 — Concepts + entities in the BDI UX

`concept_refs` / `entity_refs` are referenced in **no** renderer component today — genuinely unbuilt. Home: a new **`GroundingPanel.tsx`** beside the existing `components/analysis/` panels (Lineage, Fallacy, PolicyAlignment). Spec:

- **Two typed sections on the selected BDI node:** **Concepts** (`concept_refs`, `term:*`, dense) and **Entities** (`entity_refs`, `ent-*`, sparse/precise). Each row: `surface` text, `method`, `link_confidence`.
- **Status distinction is load-bearing:** render `status: proposed` (embedding-proposed, unconfirmed — e.g. `autonomy_human` @0.59) visually distinct from `status: linked` (surface/alias, 1.0). Do not present a 0.59 embedding guess as authoritative.
- **DOLCE-type badge:** concept = universal/kind; entity = particular. This makes the §12 distinction visible and is the whole point of keeping the two ref types separate.
- **Click-through:** concept row → Vocabulary panel entry; entity row → entity register record.
- **Empty state:** most nodes have concepts, few have entities — an empty Entities section is normal, not an error; label it so.

## 6. Ownership / routing

| # | Work | Owner role |
|---|------|-----------|
| 1a | WARN on empty/missing dictionary fallback (server `fileIO.ts:loadDictionary`) | Server Storage |
| 1b | Mirror WARN on the Electron `taxonomyHandlers.ts` dictionary load; diagnose empty panel both modes; surface load-failure state in panel | Rosetta Stone (+ ElectronMain for the main-process handler) |
| 2 | `Get-Concept` cmdlet | PowerShell |
| 3 | `GroundingPanel` — concept_refs + entity_refs on BDI node | Analysis (`components/analysis`) |

CL owns this spec and the concept/entity/DOLCE requirements; owners implement in-scope.

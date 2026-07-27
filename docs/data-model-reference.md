# Data Model Reference

> Extracted from the root `AGENTS.md` for token efficiency (t/1730). Detailed lookup for data-model work — organization model, schemas of record, and the POV-summary propagation map. Core taxonomy-model facts and the Data File Convention remain in the root `AGENTS.md`.

## Organization Data Model

Organizations (`org-NNN` IDs) represent real-world actors. 9 type enum values (ValidateSet in `Import-Organization.ps1`): `think_tank`, `advocacy`, `regulatory`, `academic`, `corporate`, `intergovernmental`, `civil_society`, `standards_body`, `research_lab`. Separate `OrganizationEdgeTypes` registry (9 actor-relationship types: `FUNDS`, `OPPOSES`, `ALLIED_WITH`, `ADVOCATES_FOR`, `SUPPORTS_POLICY`, `OPPOSES_POLICY`, `ENGAGED_WITH`, `PUBLISHED`, `COMPETES_WITH`) parallel to `CanonicalEdgeTypes` (8 argumentation types). See `scripts/AITriad/Private/Resolve-OrganizationEdgeType.ps1`.

## Schemas of Record

| Data | Schema of record | Runtime enforcement |
|------|------------------|---------------------|
| POV taxonomy nodes | `taxonomy/schemas/pov-taxonomy.schema.json` | **None** — renderer zod (`utils/validation.ts`) checks a ~40% subset; JSON Schemas are documentation-only today (repo review F-025) |
| Situations | `taxonomy/schemas/situations-taxonomy.schema.json` | None; note production data uses both `sit-*` and legacy `cc-*` IDs |
| Conflicts | `taxonomy/schemas/conflict.schema.json` | None — and the zod validator currently **contradicts** it (status enum, human_notes shape); reconciliation tracked in repo-review B-302 |
| Edge types | `scripts/AITriad/Private/Resolve-EdgeType.ps1` (canonical 8) — no JSON schema exists | PS write paths only; ignore the stale 74-type `edge_types` registry inside `edges.json` |
| POV summaries | `scripts/AITriad/Prompts/pov-summary-schema.prompt` (exemplar prompt — there is NO JSON Schema) | Structural checks in `Private/Invoke-DocumentSummary.ps1` only |

## POV Summary Propagation Map

Changing the summary shape touches ALL of these (types are currently duplicated — no shared type):
1. Shape: `scripts/AITriad/Prompts/pov-summary-schema.prompt`
2. Generation: `Public/Invoke-POVSummary.ps1` / `Invoke-BatchSummary.ps1` → core in `Private/Invoke-DocumentSummary.ps1` + `Merge-ChunkSummaries.ps1`
3. Prompt registry mirror: `taxonomy-editor/src/renderer/data/promptCatalog.ts`
4. Display (duplicate `KeyPoint` types — change both): `taxonomy-editor/.../analysis/SummariesTab.tsx` and `summary-viewer/src/renderer/types/types.ts` + `KeyPointsPane.tsx`
5. Verify: `Invoke-Pester ./tests/ -Tag ingestion` + `npm run verify`; summary-viewer has no tests — smoke manually

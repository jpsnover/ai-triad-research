# Computational Linguist — Owned Files

**Last updated:** 2026-07-16
**Author:** Computational Linguist (Orca)

Files the Computational Linguist holds **mandatory review authority** over. Changes to any of these block merge until CL review (see `research/comp-linguist/AGENTS.md` → *When to Engage*). This list is updated in any PR that adds new prompt-bearing or metric-bearing code — see the Maintenance rule at the bottom.

| File | Domain | Review type |
|---|---|---|
| **Prompt templates** | | |
| `scripts/AITriad/Prompts/*.prompt` | PS prompt templates | Mandatory |
| `scripts/AITriad/Private/Get-Prompt.ps1` | PS prompt loader | Mandatory |
| `lib/debate/prompts.ts` | TS debate prompts | Mandatory |
| `lib/debate/topicCritique.ts` | Topic evaluation rubric | Mandatory |
| `lib/debate/synthesisPhases.ts` | Synthesis phase prompts | Mandatory |
| `lib/debate/neutralEvaluator.ts` | Neutral evaluation prompts | Mandatory |
| `taxonomy-editor/src/renderer/prompts/chat.ts` | Chat prompts | Mandatory |
| `taxonomy-editor/src/renderer/prompts/analysis.ts` | Analysis prompts | Mandatory |
| `taxonomy-editor/src/renderer/prompts/research.ts` | Research prompts | Mandatory |
| `taxonomy-editor/src/renderer/prompts/vernacular.ts` | Vernacular rewriting prompt | Mandatory |
| `taxonomy-editor/src/renderer/data/promptCatalog.ts` | Prompt catalog | Mandatory |
| **Metric definitions & calibration** | | |
| `lib/debate/calibrationLogger.ts` | Metric extraction logic | Mandatory |
| `lib/debate/beliefConfidence.ts` | Belief confidence formula | Mandatory |
| `lib/debate/desirePriority.ts` | Desire priority assignment | Mandatory |
| `lib/debate/intentionOperationality.ts` | Intention operationality | Mandatory |
| `lib/debate/pragmaticSignals.ts` | Convergence lexicons | Mandatory |
| `lib/debate/claimOutcomes.ts` | Claim outcome thresholds | Mandatory |
| `lib/debate/convergenceSignals.ts` | Convergence signal computation | Mandatory |
| `lib/debate/situationScoring.ts` | Situation scoring weights | Mandatory |
| `lib/debate/schemeStagnation.ts` | Stagnation & diversity metrics | Mandatory |
| `lib/debate/confidenceDedup.ts` | Cross-debate dedup thresholds | Mandatory |
| `lib/debate/repairHintScoring.ts` | Repair hint relevance scoring | Mandatory |
| `lib/debate/operationalClosure.ts` | Operational-closure metric (self- vs opponent-targeted AN edges; t/1537) | Mandatory |
| `lib/debate/debateTested.ts` | Debate-Tested tier/verdict/sort-key computation (t/1523/t/1545) | Mandatory |
| **Convergence & phase transitions** | | |
| `lib/debate/phaseTransitions.ts` | Phase transition logic | Mandatory |
| `lib/debate/cruxResolution.ts` | Crux resolution thresholds | Mandatory |
| `lib/debate/exclusionGuard.ts` | Exclusion boundary thresholds | Mandatory |
| `lib/debate/doctrinalAnchoring.ts` | Doctrinal anchoring config | Mandatory |
| `lib/debate/operationalityEvolution.ts` | Post-debate evolution thresholds | Mandatory |
| `lib/debate/lookaheadGate.ts` | Move-quality lookahead gate | Mandatory |
| `lib/debate/revoiceGate.ts` | Revoice anchor checking | Mandatory |
| `lib/debate/tieredCompression.ts` | Context compression windows | Mandatory |
| **Prompt assembly & taxonomy** | | |
| `lib/debate/debateRunner.ts` | Prompt assembly | Mandatory |
| `lib/debate/argumentNetwork.ts` | Argument network | Mandatory |
| `lib/debate/taxonomyContext.ts` | Taxonomy context formatting | Mandatory |
| `lib/debate/taxonomyRelevance.ts` | Taxonomy relevance scoring | Mandatory |
| `lib/debate/situationRefs.ts` | Situation reference extraction | Mandatory |
| `lib/debate/vocabularyContext.ts` | Vocabulary constraints | Mandatory |
| `lib/debate/counterfactualCrux.ts` | Counterfactual crux identification | Mandatory |
| `lib/debate/cruxTaxonomyFeedback.ts` | Crux-to-situation promotion | Mandatory |
| **Entity ontology (t/1767, t/1803)** | | |
| `ai-usages.json` → `enrichment.entity-extraction` | Entity extraction prompt (CL-owned instrument) | Mandatory |
| `<data>/taxonomy/Origin/entities.json` | Entity records — DOLCE-typed (`entity_type` + `dolce_category`, genus-differentia descriptions) | Mandatory |
| `<data>/taxonomy/Origin/entity_edges.json` | `EntityEdgeType` vocabulary — AIF-adjacent edge semantics | Mandatory |
| **Other** | | |
| `scripts/AITriad/Private/Get-EmbeddingClusters.ps1` | Embeddings | Mandatory |
| `validation-report.json` | Validation outputs | Mandatory (sign-off) |

## Maintenance rule

When any file is added that contains prompt text, computes a quality metric, defines a convergence/transition threshold, or touches DOLCE-typed data — it must be added to this table in the same PR.

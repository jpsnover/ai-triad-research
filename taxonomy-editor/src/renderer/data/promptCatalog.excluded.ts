// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Prompt-catalog exclusion allowlist (t/2834).
 *
 * The registry lint (`__tests__/promptCatalog.lint.test.ts`) fails when a discovered
 * prompt-builder (`lib/debate/prompts/*`, `renderer/prompts/*`) or `.prompt` file is neither
 * referenced by `PROMPT_CATALOG` nor listed here. This file is the single, greppable place an
 * intentional exclusion lives — co-located with the catalog + gate (Gate Co-Location).
 *
 * **Every entry needs a `reason`** — an exemption without a reason is how allowlists rot.
 * Seeded from CL's curation ruling (t/2835#1): the 14 INTERNAL debate builders that are
 * opening/version variants, repair micro-prompts, or classifier/gate helpers — conceptually
 * covered by an already-exposed prompt, so they carry the marker instead of a catalog entry.
 */

export interface PromptExclusion {
  /** Exported builder fn name (or `.prompt` basename) that is intentionally NOT catalogued. */
  name: string;
  /** Why it's excluded — required. Keeps the allowlist auditable. */
  reason: string;
}

export const PROMPT_CATALOG_EXCLUDED: PromptExclusion[] = [
  // ── CL INTERNAL (t/2835#1): opening-stage variants — the opening is already represented
  //    top-level by the catalogued `openingStatementPrompt`; these are its per-stage specializations.
  { name: 'planOpeningStagePrompt', reason: 'Opening-stage variant of planStagePrompt; opening is represented by the catalogued openingStatementPrompt (CL t/2835#1).' },
  { name: 'briefOpeningStagePrompt', reason: 'Opening-stage variant of briefStagePrompt; opening is represented by the catalogued openingStatementPrompt (CL t/2835#1).' },
  { name: 'draftOpeningStagePrompt', reason: 'Opening-stage variant of draftStagePrompt; opening is represented by the catalogued openingStatementPrompt (CL t/2835#1).' },
  { name: 'citeOpeningStagePrompt', reason: 'Opening-stage variant of citeStagePrompt; opening is represented by the catalogued openingStatementPrompt (CL t/2835#1).' },
  // ── CL INTERNAL: version / user-seed variants of an already-exposed stage.
  { name: 'briefStagePromptV2', reason: 'A/B version variant of the catalogued briefStagePrompt (CL t/2835#1).' },
  { name: 'draftFromSelectedClaimsPrompt', reason: 'User-seeded-claims variant of the catalogued draftStagePrompt (CL t/2835#1).' },
  // ── CL INTERNAL: repair / classifier / gate helpers — not user-inspected turn prompts.
  { name: 'dolceComplianceRetryPrompt', reason: 'DOLCE-compliance repair micro-prompt (CL t/2835#1).' },
  { name: 'entailmentRepairPrompt', reason: 'Entailment repair micro-prompt (CL t/2835#1).' },
  { name: 'classifyCounterfactualTypePrompt', reason: 'Classifier helper, not a user-facing turn prompt (CL t/2835#1).' },
  { name: 'coverageCheckPrompt', reason: 'Coverage gate helper, not a user-facing turn prompt (CL t/2835#1).' },
  { name: 'elementDecompositionPrompt', reason: 'Statement→information-elements helper (CL t/2835#1).' },
  { name: 'cruxRefreshPrompt', reason: 'Mid-debate crux-maintenance micro-prompt (CL t/2835#1).' },
  { name: 'consensusSituationPrompt', reason: 'Niche convergence→enrichment sub-prompt (CL t/2835#1).' },
  { name: 'crossCuttingNodePrompt', reason: 'Niche convergence→enrichment sub-prompt (CL t/2835#1).' },

  // ── PROVISIONAL (t/2859): renderer-prompt builders outside CL's t/2835 debate-builder scope.
  //    Excluded to keep the gate green now; CL disposition tracked by t/2859 (TL ruling C, t/2834#5) —
  //    time-bound, not silent-forever. Re-evaluate when t/2859 rules expose-vs-internal.
  { name: 'vernacularPrompt', reason: 'Provisional: pending CL disposition, outside t/2835 scope — t/2859.' },
  { name: 'aphorismPrompt', reason: 'Provisional: pending CL disposition, outside t/2835 scope — t/2859.' },
  { name: 'generateDebateTitlePrompt', reason: 'Provisional: pending CL disposition, outside t/2835 scope — t/2859.' },
];

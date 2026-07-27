// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StageDiagnostics, DraftWorkProduct } from '../types.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { classifyHintKey, checkDirectiveContentCompliance } from '../turnValidator.js';
import { parseJsonRobust } from '../helpers.js';
import { microFixAbstractClaims, microFixInterventionResponse, microFixDirectiveCompliance } from '../prompts.js';
import type { MicroFixResult, InterventionMicroFixResult, DirectiveMicroFixResult } from '../prompts.js';
import { checkInterventionCompliance, MOVE_RESPONSE_CONFIG, DIRECT_RESPONSE_PATTERNS } from '../moderator.js';
import { normalizeSpeakerNames } from './repair.js';
import type { DraftField } from './repair.js';
import { extractDraftMeta } from './assemble.js';
import type { TurnPipelineInput, StageGenerateFn } from './types.js';

// ── Extracted micro-fix pass functions (t/453) ─────────

interface MicroFixPassOutcome {
  applied: boolean;
  shouldBreak: boolean;
}

const MICRO_FIX_NO_OP: MicroFixPassOutcome = { applied: false, shouldBreak: false };

export async function trySpecificityMicroFix(
  draft: DraftWorkProduct | undefined,
  repairHints: string[],
  stageDiags: StageDiagnostics[],
  input: TurnPipelineInput,
  generate: StageGenerateFn,
  evidenceBlock: string,
  citationBankBlock: string,
): Promise<MicroFixPassOutcome> {
  if (!draft?.statement || !draft?.claim_sketches) return MICRO_FIX_NO_OP;

  const claimSpecHints = repairHints.filter(h => classifyHintKey(h) === 'claim_specificity');
  if (claimSpecHints.length === 0) return MICRO_FIX_NO_OP;

  const SPECIFICITY_RE = /\d|[A-Z][a-z]+\s[A-Z][a-z]+|within|by\s\d{4}|percent|%|per year/;
  const flaggedClaims = draft.claim_sketches
    .map((cs, i) => ({ claim: typeof cs === 'string' ? cs : cs.claim, index: i }))
    .filter(c => !SPECIFICITY_RE.test(c.claim));
  if (flaggedClaims.length === 0) return MICRO_FIX_NO_OP;

  const microFixT0 = Date.now();
  let microFixPromptText = '';
  let microFixRaw = '';

  try {
    microFixPromptText = microFixAbstractClaims(
      draft.statement, flaggedClaims, evidenceBlock,
      citationBankBlock?.slice(0, 500) ?? '',
    );
    microFixRaw = await generate(
      microFixPromptText, input.model,
      { temperature: 0.3 },
      `${input.label} micro-fix(specificity)`,
    );
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'ai.error', component: 'turn-pipeline', level: 'warn', debate_id: (input as any).debate_id, message: 'Micro-fix(specificity) LLM call failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    stageDiags.push({
      stage: 'micro-fix', prompt: microFixPromptText, raw_response: microFixRaw,
      model: input.model, temperature: 0.3,
      response_time_ms: Date.now() - microFixT0,
      work_product: { type: 'abstract_claims', success: false, error: err instanceof Error ? err.message : String(err) },
    });
    console.warn(`[pipeline] Micro-fix(specificity) failed: ${err instanceof Error ? err.message : err}`);
    return MICRO_FIX_NO_OP;
  }

  const microFixResult = parseJsonRobust(microFixRaw) as MicroFixResult | undefined;
  const microFixElapsed = Date.now() - microFixT0;

  const pushDiag = (workProduct: Record<string, unknown>) => {
    stageDiags.push({
      stage: 'micro-fix', prompt: microFixPromptText, raw_response: microFixRaw,
      model: input.model, temperature: 0.3,
      response_time_ms: microFixElapsed, work_product: workProduct,
    });
  };

  if (!microFixResult?.revised_statement) return MICRO_FIX_NO_OP;

  const hasRealChange = microFixResult.changes?.some(c => c.original !== c.revised) ?? false;
  if (!hasRealChange) {
    pushDiag({
      type: 'abstract_claims', success: false,
      diff_check_passed: false, rejected_reason: 'hallucinated_changes',
      changes: microFixResult.changes ?? [],
    });
    console.log(`[pipeline] Micro-fix(specificity) rejected — all reported changes are identical (hallucinated edits)`);
    return MICRO_FIX_NO_OP;
  }

  if (!validateMicroFix(draft.statement, microFixResult.revised_statement, flaggedClaims.length)) {
    pushDiag({
      type: 'abstract_claims', success: false,
      diff_check_passed: false, changes: microFixResult.changes ?? [],
    });
    getGlobalRecorder()?.record({
      type: 'turn.micro-fix', component: 'turn-pipeline', level: 'warn',
      speaker: input.label,
      message: `Micro-fix(specificity) diff-check failed — too many sentence changes`,
      data: { target: 'specificity', success: false, original_claims: flaggedClaims.length, fixed_claims: microFixResult.changes?.length ?? 0, revalidation_passed: false, diff_check_failed: true },
    });
    console.log(`[pipeline] Micro-fix(specificity) diff-check failed — falling through to full retry`);
    return MICRO_FIX_NO_OP;
  }

  const originalStatement = draft.statement;
  draft.statement = microFixResult.revised_statement;

  const revisedParagraphs = microFixResult.revised_statement.split(/\n\n+/).filter(Boolean);
  const recheckSpecific = revisedParagraphs.every(para =>
    para.split(/(?<=[.!?])\s+/).some(s => SPECIFICITY_RE.test(s)),
  );

  pushDiag({
    type: 'abstract_claims', success: recheckSpecific,
    diff_check_passed: true,
    changes: microFixResult.changes ?? [],
    revised_statement: microFixResult.revised_statement,
  });

  if (recheckSpecific) {
    getGlobalRecorder()?.record({
      type: 'turn.micro-fix', component: 'turn-pipeline', level: 'info',
      speaker: input.label,
      message: `Micro-fix(specificity) succeeded: ${microFixResult.changes?.length ?? 0} change(s)`,
      data: { target: 'specificity', success: true, original_claims: flaggedClaims.length, fixed_claims: microFixResult.changes?.length ?? 0, revalidation_passed: true, elapsed_ms: microFixElapsed },
    });
    console.log(`[pipeline] Micro-fix(specificity) succeeded in ${microFixElapsed}ms — skipping full retry`);
    return { applied: true, shouldBreak: true };
  }

  draft.statement = originalStatement;
  getGlobalRecorder()?.record({
    type: 'turn.micro-fix', component: 'turn-pipeline', level: 'warn',
    speaker: input.label,
    message: `Micro-fix(specificity) re-validation failed — falling through to full retry`,
    data: { target: 'specificity', success: false, original_claims: flaggedClaims.length, fixed_claims: microFixResult.changes?.length ?? 0, revalidation_passed: false, elapsed_ms: microFixElapsed },
  });
  console.log(`[pipeline] Micro-fix(specificity) re-validation failed — falling through to full retry`);
  return MICRO_FIX_NO_OP;
}

export async function tryInterventionMicroFix(
  draft: DraftWorkProduct | undefined,
  draftVal: { repairHints: string[]; errorHints: string[] },
  stageDiags: StageDiagnostics[],
  input: TurnPipelineInput,
  generate: StageGenerateFn,
  pendingIntervention: TurnPipelineInput['pendingIntervention'],
): Promise<MicroFixPassOutcome> {
  const interventionHints = (draftVal.repairHints ?? []).filter(
    h => classifyHintKey(h) === 'intervention_compliance',
  );
  if (interventionHints.length === 0 || !pendingIntervention?.isTargeted || !draft?.statement) return MICRO_FIX_NO_OP;

  const moveConfig = MOVE_RESPONSE_CONFIG[pendingIntervention.move as keyof typeof MOVE_RESPONSE_CONFIG];
  if (!moveConfig?.field || (draft as Record<string, unknown>)[moveConfig.field]) return MICRO_FIX_NO_OP;

  const intFixT0 = Date.now();
  let intFixPromptText = '';
  let intFixRaw = '';

  try {
    intFixPromptText = microFixInterventionResponse(
      draft.statement,
      pendingIntervention.move,
      moveConfig.field,
      moveConfig.schema,
      pendingIntervention.directResponsePattern ?? `The moderator issued a ${pendingIntervention.move} intervention directed at you.`,
    );
    intFixRaw = await generate(
      intFixPromptText, input.model,
      { temperature: 0.2 },
      `${input.label} micro-fix(intervention)`,
    );
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'ai.error', component: 'turn-pipeline', level: 'warn', debate_id: (input as any).debate_id, message: 'Micro-fix(intervention) LLM call failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    stageDiags.push({
      stage: 'micro-fix', prompt: intFixPromptText, raw_response: intFixRaw,
      model: input.model, temperature: 0.2,
      response_time_ms: Date.now() - intFixT0,
      work_product: { type: 'intervention_compliance', success: false, error: err instanceof Error ? err.message : String(err) },
    });
    console.warn(`[pipeline] Micro-fix(intervention) failed: ${err instanceof Error ? err.message : err}`);
    return MICRO_FIX_NO_OP;
  }

  const intFixResult = parseJsonRobust(intFixRaw) as InterventionMicroFixResult | undefined;
  const intFixElapsed = Date.now() - intFixT0;
  const fieldValue = intFixResult?.[moveConfig.field];

  const pushDiag = (workProduct: Record<string, unknown>) => {
    stageDiags.push({
      stage: 'micro-fix', prompt: intFixPromptText, raw_response: intFixRaw,
      model: input.model, temperature: 0.2,
      response_time_ms: intFixElapsed, work_product: workProduct,
    });
  };

  if (fieldValue == null) {
    pushDiag({
      type: 'intervention_compliance', move: pendingIntervention.move,
      field: moveConfig.field, success: false,
      rejected_reason: 'missing_field_in_response',
    });
    console.log(`[pipeline] Micro-fix(intervention) returned no ${moveConfig.field} — falling through to full retry`);
    return MICRO_FIX_NO_OP;
  }

  (draft as Record<string, unknown>)[moveConfig.field] = fieldValue;
  const recheckMeta = extractDraftMeta(draft);
  const recheckCompliance = checkInterventionCompliance(
    pendingIntervention.move as Parameters<typeof checkInterventionCompliance>[0],
    recheckMeta as Record<string, unknown>,
  );

  pushDiag({
    type: 'intervention_compliance', move: pendingIntervention.move,
    field: moveConfig.field, success: recheckCompliance.compliant,
    generated_value: fieldValue, recheck_result: recheckCompliance,
  });

  if (!recheckCompliance.compliant) {
    delete (draft as Record<string, unknown>)[moveConfig.field];
    getGlobalRecorder()?.record({
      type: 'turn.micro-fix', component: 'turn-pipeline', level: 'warn',
      speaker: input.label,
      message: `Micro-fix(intervention) re-validation failed — falling through to full retry`,
      data: { target: 'intervention_compliance', move: pendingIntervention.move, field: moveConfig.field, success: false, recheck: recheckCompliance, elapsed_ms: intFixElapsed },
    });
    console.log(`[pipeline] Micro-fix(intervention) re-validation failed — falling through to full retry`);
    return MICRO_FIX_NO_OP;
  }

  const remainingErrors = (draftVal.errorHints ?? []).filter(
    h => classifyHintKey(h) !== 'intervention_compliance',
  );
  getGlobalRecorder()?.record({
    type: 'turn.micro-fix', component: 'turn-pipeline', level: 'info',
    speaker: input.label,
    message: `Micro-fix(intervention) succeeded: generated ${moveConfig.field}`,
    data: { target: 'intervention_compliance', move: pendingIntervention.move, field: moveConfig.field, success: true, remaining_errors: remainingErrors.length, elapsed_ms: intFixElapsed },
  });
  console.log(`[pipeline] Micro-fix(intervention) succeeded in ${intFixElapsed}ms — patched ${moveConfig.field}`);

  if (remainingErrors.length === 0) return { applied: true, shouldBreak: true };

  draftVal.repairHints = draftVal.repairHints.filter(h => classifyHintKey(h) !== 'intervention_compliance');
  draftVal.errorHints = draftVal.errorHints.filter(h => classifyHintKey(h) !== 'intervention_compliance');
  return { applied: true, shouldBreak: false };
}

export async function tryDirectiveMicroFix(
  draft: DraftWorkProduct | undefined,
  draftVal: { repairHints: string[]; errorHints: string[] },
  stageDiags: StageDiagnostics[],
  input: TurnPipelineInput,
  generate: StageGenerateFn,
  pendingIntervention: TurnPipelineInput['pendingIntervention'],
): Promise<MicroFixPassOutcome> {
  const directiveHints = (draftVal.repairHints ?? []).filter(
    h => classifyHintKey(h) === 'directive_compliance',
  );
  if (directiveHints.length === 0 || !pendingIntervention || !draft?.statement) return MICRO_FIX_NO_OP;

  const move = pendingIntervention.move as keyof typeof DIRECT_RESPONSE_PATTERNS;
  const responsePattern = DIRECT_RESPONSE_PATTERNS[move] || '';
  const directiveText = pendingIntervention.directResponsePattern ?? `The moderator issued a ${pendingIntervention.move} intervention.`;

  const dirFixT0 = Date.now();
  let dirFixPromptText = '';
  let dirFixRaw = '';

  try {
    dirFixPromptText = microFixDirectiveCompliance(
      draft.statement, pendingIntervention.move, directiveText, responsePattern,
    );
    dirFixRaw = await generate(
      dirFixPromptText, input.model,
      { temperature: 0.3 },
      `${input.label} micro-fix(directive)`,
    );
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'ai.error', component: 'turn-pipeline', level: 'warn', debate_id: (input as any).debate_id, message: 'Micro-fix(directive) LLM call failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    stageDiags.push({
      stage: 'micro-fix', prompt: dirFixPromptText, raw_response: dirFixRaw,
      model: input.model, temperature: 0.3,
      response_time_ms: Date.now() - dirFixT0,
      work_product: { type: 'directive_compliance', success: false, error: err instanceof Error ? err.message : String(err) },
    });
    console.warn(`[pipeline] Micro-fix(directive) failed: ${err instanceof Error ? err.message : err}`);
    return MICRO_FIX_NO_OP;
  }

  const dirFixResult = parseJsonRobust(dirFixRaw) as DirectiveMicroFixResult | undefined;
  const dirFixElapsed = Date.now() - dirFixT0;

  const pushDiag = (workProduct: Record<string, unknown>) => {
    stageDiags.push({
      stage: 'micro-fix', prompt: dirFixPromptText, raw_response: dirFixRaw,
      model: input.model, temperature: 0.3,
      response_time_ms: dirFixElapsed, work_product: workProduct,
    });
  };

  if (!dirFixResult?.revised_first_paragraph) {
    pushDiag({
      type: 'directive_compliance', success: false,
      move: pendingIntervention.move, rejected_reason: 'missing_revised_first_paragraph',
    });
    console.log(`[pipeline] Micro-fix(directive) returned no revised_first_paragraph — falling through to full retry`);
    return MICRO_FIX_NO_OP;
  }

  const paragraphs = draft.statement.split(/\n\s*\n/);
  const originalStatement = draft.statement;
  paragraphs[0] = dirFixResult.revised_first_paragraph;
  draft.statement = paragraphs.join('\n\n');

  const recheck = checkDirectiveContentCompliance(
    draft.statement,
    { move: pendingIntervention.move, directResponsePattern: pendingIntervention.directResponsePattern, isTargeted: pendingIntervention.isTargeted },
  );

  pushDiag({
    type: 'directive_compliance', success: recheck.compliant,
    move: pendingIntervention.move, recheck_compliant: recheck.compliant,
    revised_first_paragraph: dirFixResult.revised_first_paragraph,
  });

  if (!recheck.compliant) {
    draft.statement = originalStatement;
    getGlobalRecorder()?.record({
      type: 'turn.micro-fix', component: 'turn-pipeline', level: 'warn',
      speaker: input.label,
      message: `Micro-fix(directive) re-validation failed — falling through to full retry`,
      data: { target: 'directive_compliance', move: pendingIntervention.move, success: false, recheck_compliant: false, elapsed_ms: dirFixElapsed },
    });
    console.log(`[pipeline] Micro-fix(directive) re-validation failed — falling through to full retry`);
    return MICRO_FIX_NO_OP;
  }

  const remainingErrors = (draftVal.errorHints ?? []).filter(
    h => classifyHintKey(h) !== 'directive_compliance',
  );
  getGlobalRecorder()?.record({
    type: 'turn.micro-fix', component: 'turn-pipeline', level: 'info',
    speaker: input.label,
    message: `Micro-fix(directive) succeeded: first paragraph rewritten for ${pendingIntervention.move} compliance`,
    data: { target: 'directive_compliance', move: pendingIntervention.move, success: true, recheck_compliant: true, elapsed_ms: dirFixElapsed },
  });
  console.log(`[pipeline] Micro-fix(directive) succeeded in ${dirFixElapsed}ms — first paragraph rewritten`);

  if (remainingErrors.length === 0) return { applied: true, shouldBreak: true };

  draftVal.repairHints = draftVal.repairHints.filter(h => classifyHintKey(h) !== 'directive_compliance');
  draftVal.errorHints = draftVal.errorHints.filter(h => classifyHintKey(h) !== 'directive_compliance');
  return { applied: true, shouldBreak: false };
}

/** Diff-check safeguard for micro-fix results.
 *  Compares original and revised text sentence-by-sentence, rejecting
 *  micro-fixes that change too much unflagged text. */
export function validateMicroFix(original: string, revised: string, flaggedClaimCount: number): boolean {
  const splitSentences = (text: string) =>
    text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

  const origSentences = splitSentences(original);
  const revSentences = splitSentences(revised);

  // Reject if sentence count changed drastically (restructuring)
  if (Math.abs(origSentences.length - revSentences.length) > 2) return false;

  let changed = 0;
  for (let i = 0; i < Math.min(origSentences.length, revSentences.length); i++) {
    if (origSentences[i] !== revSentences[i]) changed++;
  }
  // Count added/removed sentences as changes too
  changed += Math.abs(origSentences.length - revSentences.length);

  // Allow up to flaggedClaimCount * 2 + 3 sentence changes (claims span sentences
  // and surrounding text often needs flow adjustments)
  return changed <= flaggedClaimCount * 2 + 3;
}

/** Harvest concrete data from a prior draft for injection into the retry prompt.
 *  All framing is self-contained — no references to "your prior attempt". */
function buildDraftHarvestBlock(
  priorDraft: DraftWorkProduct,
  targetedFields: Set<DraftField>,
): string {
  const parts: string[] = [];

  // Claim sketches
  if (priorDraft.claim_sketches?.length > 0) {
    const claimsTargeted = targetedFields.has('claim_sketches');
    const header = claimsTargeted
      ? 'PRIOR CLAIMS (revise per corrections above):'
      : 'STRONG CLAIMS (build your revised statement around these):';
    parts.push(header);
    for (const cs of priorDraft.claim_sketches) {
      const targets = cs.targets?.length > 0 ? ` → targets: [${cs.targets.join(', ')}]` : '';
      parts.push(`- "${cs.claim}"${targets}`);
    }
  }

  // Statement text (only when statement is targeted — LLM needs to see what to improve)
  if (targetedFields.has('statement') && priorDraft.statement) {
    const truncated = priorDraft.statement.length > 800
      ? priorDraft.statement.slice(0, 800) + '…'
      : priorDraft.statement;
    parts.push(
      `\nPRIOR DRAFT STATEMENT (rejected for reasons listed above):\n` +
      `"${truncated}"`
    );
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

export function buildRepairBlock(hints: string[], failedStatement?: string, priorDraft?: DraftWorkProduct, targetedFields?: Set<DraftField>): string {
  if (hints.length === 0) return '';
  hints = hints.map(normalizeSpeakerNames);
  const sections: string[] = [];

  // Directive non-compliance — include the failed first paragraph so the LLM can see what it wrote
  const directiveHint = hints.find(h => /directive|first paragraph|PIN|PROBE|CHALLENGE/i.test(h));
  if (directiveHint) {
    const failedFirstParagraph = failedStatement
      ? failedStatement.split(/\n\s*\n/)[0]?.trim().slice(0, 300)
      : undefined;
    sections.push(
      `MANDATORY CORRECTION — DIRECTIVE RESPONSE:\n` +
      (failedFirstParagraph
        ? `The rejected draft began with: "${failedFirstParagraph}..."\nThis was REJECTED because it did not address the moderator's directive.\n`
        : '') +
      `Your FIRST SENTENCE must begin with "I agree that...", "I disagree that...", or "I conditionally agree:..."\n` +
      `This is not optional. Responses that do not start this way will be rejected again.`
    );
  }

  // Single paragraph
  if (hints.some(h => /single paragraph|split into/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — PARAGRAPH STRUCTURE:\n` +
      `The rejected draft was a single block of text. You MUST use \\n\\n to create 3-5 separate paragraphs. Each paragraph develops ONE idea.`
    );
  }

  // Hedge density
  if (hints.some(h => /hedge density/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — REMOVE HEDGING:\n` +
      `The rejected draft had too many qualifiers. Replace "may", "might", "could", "perhaps", "potentially" with definitive claims. Use specific actors, timelines, and numbers.`
    );
  }

  // Claim specificity
  if (hints.some(h => /abstract|number.*entity.*timeline|specific/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — ADD SPECIFICS:\n` +
      `The rejected draft lacked concrete details. Include at least one: a specific number ("≥20%"), a named entity ("the EU AI Act"), or a timeline ("by 2028").`
    );
  }

  // Statement duplication
  if (hints.some(h => /duplicate|repeated text/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — NO REPETITION:\n` +
      `The rejected draft contained the same text repeated twice. Write each paragraph ONCE. Do not copy content between paragraphs.`
    );
  }

  // Move repetition
  if (hints.some(h => /move_types repeat/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — VARY MOVES:\n` +
      `The rejected draft used the same dialectical moves as the previous turn. Choose different moves this time.`
    );
  }

  // Constructive move requirement
  if (hints.some(h => /constructive move|CONCEDE.*PIVOT.*INTEGRATE/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — ADD CONSTRUCTIVE MOVE:\n` +
      `The rejected draft used only adversarial moves. Include at least one constructive move: CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, or SPECIFY.`
    );
  }

  // Commitment schema compliance (COMMIT move)
  if (hints.some(h => /concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — COMMITMENT STRUCTURE:\n` +
      `The rejected draft was missing required commitment fields. Your response MUST include a "commitment" object with ALL THREE sub-fields:\n` +
      `{\n` +
      `  "commitment": {\n` +
      `    "concessions": ["specific point you concede to an opponent"],\n` +
      `    "conditions_for_change": ["If [specific evidence], then I would revise my position on [specific claim]"],\n` +
      `    "sharpest_disagreements": {\n` +
      `      "opponent_name": "One sentence: the core irreducible disagreement"\n` +
      `    }\n` +
      `  }\n` +
      `}\n` +
      `Each field must be non-empty. Be specific — name opponents, cite claims, state conditions.`
    );
  }

  // Catch-all for any unmatched hints
  const unmatched = hints.filter(h =>
    !(/directive|first paragraph|PIN|PROBE|CHALLENGE|single paragraph|split into|hedge density|abstract.*number|duplicate|repeated text|move_types repeat|constructive move|concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h))
  );
  if (unmatched.length > 0) {
    sections.push(
      `ADDITIONAL CORRECTIONS:\n` +
      unmatched.map(h => `- ${h}`).join('\n')
    );
  }

  return sections.length > 0
    ? `\n\n=== CORRECTIONS REQUIRED (draft was rejected) ===\n` +
      `Apply these corrections WHILE executing YOUR ARGUMENT PLAN above. When a correction appears to conflict with a planned move (e.g., a correction faults you for "reframing" but the plan calls for REFRAME), THE PLAN TAKES PRECEDENCE — execute the planned move and treat the correction as guidance on HOW to execute it better, not as a directive to abandon it.\n\n` +
      `Address ONLY the specific issues listed. Do NOT swap an unflagged claim for a new claim just because you are rewriting — that pattern produces lateral motion (new problems replacing old ones), not improvement. If a flagged claim cannot be strengthened with available evidence, prefer narrowing its scope or removing it cleanly over substituting an unrelated claim.\n\n` +
      `${priorDraft && targetedFields ? buildDraftHarvestBlock(priorDraft, targetedFields) + '\n\n' : ''}` +
      `${sections.join('\n\n')}\n`
    : '';
}

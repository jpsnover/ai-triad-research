// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateAudience } from '../types.js';
import type { EditingMeta } from '../types/pipeline.js';
import type { StageGenerateFn } from './types.js';
import { AUDIENCE_GRADE_TARGET } from '../prompts/shared-helpers.js';
import { readabilityEditPassPrompt } from '../prompts/editPass.js';
import { measureReadability, findIntroducedTells } from '../../oped/readabilityMeasure.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';

/** Debate-specific trigger thresholds (para cap looser than op-eds — turns are longer). */
function needsDebateEdit(
  fkGrade: number,
  maxSentWords: number,
  maxParaWords: number,
  target: number,
): boolean {
  return fkGrade > target + 1 || maxSentWords > 30 || maxParaWords > 120;
}

function buildDebateViolationsText(
  fkGrade: number,
  maxSentWords: number,
  maxParaWords: number,
  target: number,
  ceiling: number,
): string {
  const parts: string[] = [];
  if (fkGrade > target + 1)
    parts.push(`Flesch-Kincaid grade: ${fkGrade.toFixed(1)} (target: ~${target}, ceiling ${ceiling})`);
  if (maxSentWords > 30)
    parts.push(`Longest sentence: ${maxSentWords} words (target: no sentence over 30 words)`);
  if (maxParaWords > 120)
    parts.push(`Longest paragraph: ${maxParaWords} words (target: at most ~120 words)`);
  return parts.join('\n');
}

/**
 * Conditional, non-fatal readability edit pass for debate turns.
 * Runs after the draft is finalised; skips entirely when the draft is already on-target.
 * Any error → degrades to the original draft with a WARN log.
 */
export async function runReadabilityEditPass(
  statement: string,
  audience: DebateAudience | undefined,
  generate: StageGenerateFn,
  model: string,
  label: string,
): Promise<{ statement: string; editing_meta: EditingMeta }> {
  const effectiveAudience: DebateAudience = audience ?? 'policymakers';
  const { target, ceiling } = AUDIENCE_GRADE_TARGET[effectiveAudience];
  const original = statement;

  const before = measureReadability(statement);
  const fkBefore = before.fkGrade;

  if (!needsDebateEdit(before.fkGrade, before.maxSentWords, before.maxParaWords, target)) {
    return {
      statement,
      editing_meta: { edited: false, fk_before: fkBefore, fk_after: fkBefore, checks_failed_after: false },
    };
  }

  const violations = buildDebateViolationsText(before.fkGrade, before.maxSentWords, before.maxParaWords, target, ceiling);
  const prompt = readabilityEditPassPrompt(statement, effectiveAudience, violations);

  let best = statement;
  let bestFk = fkBefore;
  let editNotes: string | undefined;

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await generate(prompt, model, { temperature: 0.2 }, `${label} readability-edit`);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      let parsed: { statement?: string; changed?: boolean; edit_notes?: string };
      try {
        parsed = JSON.parse(cleaned) as { statement?: string; changed?: boolean; edit_notes?: string };
      } catch {
        break;
      }

      const editedText = parsed.statement?.trim();
      if (!editedText || editedText.length < original.length * 0.5) break;

      const introducedTells = findIntroducedTells(original, editedText);
      if (introducedTells.length > 0) {
        getGlobalRecorder()?.record({
          type: 'turn.repair', component: 'readability-edit-pass', level: 'warn',
          speaker: label,
          message: `Edit introduced banned tells: ${introducedTells.join(', ')} — reverting`,
          data: { attempt, tells: introducedTells },
        });
        break;
      }

      const after = measureReadability(editedText);
      editNotes = parsed.edit_notes;

      if (after.fkGrade < bestFk) {
        best = editedText;
        bestFk = after.fkGrade;
        break;
      }
      if (attempt === 0) {
        // First attempt made it worse — retry once with the original
        getGlobalRecorder()?.record({
          type: 'turn.repair', component: 'readability-edit-pass', level: 'warn',
          speaker: label,
          message: `Edit pass attempt 0 FK ${fkBefore.toFixed(1)}→${after.fkGrade.toFixed(1)} (worse) — retrying`,
          data: { fk_before: fkBefore, fk_after: after.fkGrade },
        });
        continue;
      }
      // Both attempts worse — keep best
      best = after.fkGrade < bestFk ? editedText : best;
      bestFk = Math.min(after.fkGrade, bestFk);
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'readability-edit-pass', level: 'warn',
      message: `Readability edit pass failed — using original draft`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    console.warn(`[readability-edit-pass] ${label}: edit pass error — using original. ${String(err)}`);
    return {
      statement: original,
      editing_meta: { edited: false, fk_before: fkBefore, fk_after: fkBefore, checks_failed_after: false },
    };
  }

  const edited = best !== original;
  const afterChecks = measureReadability(best);
  const checksFailed = needsDebateEdit(afterChecks.fkGrade, afterChecks.maxSentWords, afterChecks.maxParaWords, target);

  if (checksFailed) {
    getGlobalRecorder()?.record({
      type: 'turn.repair', component: 'readability-edit-pass', level: 'warn',
      speaker: label,
      message: `Edit pass complete but FK still over target: ${afterChecks.fkGrade.toFixed(1)} (target ~${target})`,
      data: { fk_before: fkBefore, fk_after: afterChecks.fkGrade, target },
    });
    console.warn(`[readability-edit-pass] ${label}: FK ${fkBefore.toFixed(1)}→${afterChecks.fkGrade.toFixed(1)}, still over target ${target}`);
  } else if (edited) {
    console.log(`[readability-edit-pass] ${label}: FK ${fkBefore.toFixed(1)}→${afterChecks.fkGrade.toFixed(1)} ✓`);
  }

  return {
    statement: best,
    editing_meta: {
      edited,
      fk_before: fkBefore,
      fk_after: afterChecks.fkGrade,
      checks_failed_after: checksFailed,
      edit_notes: editNotes,
    },
  };
}

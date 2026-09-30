// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { OpEdParams } from './types.js';
import type { PovKey } from '../debate/types.js';
import type { OutletBandStyle } from './outletBands.js';

export interface SourceBrief {
  author?: string;
  actor_type?: string;
  thesis?: string;
  stance?: string;
  primary_recommendations?: string[];
  key_claims?: string[];
  readable?: boolean;
}

export interface PromptContext {
  topic: string;
  params: OpEdParams;
  pov: PovKey;
  povLabel: string;
  voiceBlock: string;
  groundingNodes: string;
  situations: string;
  sourceMaterial: string;
  sourceBrief?: SourceBrief;
  outletGuidance: string;
  targetWords: number;
  style?: OutletBandStyle;
}

export interface AssembledPrompt {
  system: string;
  user: string;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export function loadPromptTemplate(promptsDir: string, name: string): string {
  return readFileSync(join(promptsDir, `${name}.prompt`), 'utf-8');
}

export function loadAndAssemblePrompt(promptsDir: string, ctx: PromptContext): AssembledPrompt {
  const newsHookText = ctx.params.newsHook?.trim()
    ? ctx.params.newsHook
    : '(none supplied — do NOT invent or assert a specific dated news event, pending vote, ruling, '
    + 'report, milestone, or named regulation. Open on the enduring stakes of the issue itself — a '
    + 'trend, a structural tension, or a concrete illustrative scene — with no claim that any '
    + 'particular thing happened "this week" or is "currently pending." If SOURCE MATERIAL is '
    + 'provided above, anchor the opening in what THAT document argues or reports, not an external event.)';
  const thesisText = ctx.params.thesis?.trim()
    ? ctx.params.thesis
    : '(none supplied — derive a clear, arguable thesis that follows from your camp value hierarchy)';
  const authorBioText = ctx.params.authorBio?.trim()
    ? ctx.params.authorBio
    : '(none supplied — write a generic authority line the author can replace, e.g. "[Author], [affiliation]")';

  const s = ctx.style;
  const styleAudience = s?.audience ?? 'persuade a broad, non-specialist public to act';
  const styleReadingLevel = s?.readingLevel ?? 'write for a general newspaper audience at roughly a 10th-grade reading level (Flesch-Kincaid grade ~10, and no higher than 11). This is the single most important constraint. If a passage would make a smart non-specialist reread it, simplify it.';
  const styleSentence = s?.sentenceMechanics ?? 'average under 18 words per sentence; NO sentence over 30 words. One idea per sentence. When a sentence carries two or three claims, split it into two or three sentences. Long, clause-chained sentences are the main reason these essays read as hard.';
  const styleParagraph = s?.paragraphMechanics ?? 'at most four sentences AND at most ~90 words per paragraph. The word cap matters as much as the sentence count, four long sentences is still a wall. Break a longer paragraph in two.';
  const styleJargon = s?.jargonGuidance ?? 'Eliminate jargon and specialized acronyms. Translate every technical term into plain language without losing its meaning (e.g., "new governmental restrictions," not "legislative encroachment"; "federal engineers," not "USACE"). If a term is not universally understood by a general reader, replace it. Avoid abstract-noun pileups ("sociotechnical complexity reduced to a frictionless slogan"); say it plainly.';
  const styleBodyFormat = s?.bodyFormat ?? 'No section labels or headers inside the body — it must read as continuous prose. Do NOT repeat the headline inside the body.';

  const system = interpolate(loadPromptTemplate(promptsDir, 'op-ed-generation-system'), {
    POV_LABEL: ctx.povLabel,
    VOICE_BLOCK: ctx.voiceBlock,
    WORD_COUNT: String(ctx.targetWords),
    OUTLET_GUIDANCE: ctx.outletGuidance,
    STYLE_AUDIENCE: styleAudience,
    STYLE_READING_LEVEL: styleReadingLevel,
    STYLE_SENTENCE: styleSentence,
    STYLE_PARAGRAPH: styleParagraph,
    STYLE_JARGON: styleJargon,
  });

  const user = interpolate(loadPromptTemplate(promptsDir, 'op-ed-generation-user'), {
    TOPIC: ctx.topic,
    WORD_COUNT: String(ctx.targetWords),
    OUTLET_GUIDANCE: ctx.outletGuidance,
    NEWS_HOOK: newsHookText,
    THESIS: thesisText,
    AUTHOR_BIO: authorBioText,
    SOURCE_MATERIAL: ctx.sourceMaterial,
    GROUNDING_NODES: ctx.groundingNodes,
    SITUATIONS: ctx.situations,
    SOURCE_AUTHOR: ctx.sourceBrief?.author ?? '',
    SOURCE_ACTOR_TYPE: ctx.sourceBrief?.actor_type ?? '',
    SOURCE_THESIS: ctx.sourceBrief?.thesis ?? '',
    SOURCE_STANCE: ctx.sourceBrief?.stance ?? '',
    SOURCE_RECOMMENDATIONS: ctx.sourceBrief?.primary_recommendations?.join('; ') ?? '',
    STYLE_BODY_FORMAT: styleBodyFormat,
    SOURCE_KEY_CLAIMS: ctx.sourceBrief?.key_claims?.length
      ? ctx.sourceBrief.key_claims.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
      : '(none extracted)',
  });

  return { system, user };
}

export function assembleSourceBriefPrompt(promptsDir: string, sourceMaterial: string): string {
  return interpolate(loadPromptTemplate(promptsDir, 'op-ed-source-brief'), {
    SOURCE_MATERIAL: sourceMaterial,
  });
}

export function assembleReflectionPrompt(
  promptsDir: string,
  opedBody: string,
  groundingList: string,
  sourceClaims = '(none)',
): string {
  return interpolate(loadPromptTemplate(promptsDir, 'op-ed-grounding-reflection'), {
    OPED_BODY: opedBody,
    GROUNDING_LIST: groundingList,
    SOURCE_CLAIMS: sourceClaims,
  });
}

export function assembleReadabilityEditPrompt(
  promptsDir: string,
  body: string,
  violations: string,
): string {
  return interpolate(loadPromptTemplate(promptsDir, 'op-ed-readability-edit'), {
    BODY: body,
    VIOLATIONS: violations,
  });
}

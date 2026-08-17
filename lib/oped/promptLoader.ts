// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { OpEdParams } from './types.js';
import type { PovKey } from '../debate/types.js';

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

  const system = interpolate(loadPromptTemplate(promptsDir, 'op-ed-generation-system'), {
    POV_LABEL: ctx.povLabel,
    VOICE_BLOCK: ctx.voiceBlock,
    WORD_COUNT: String(ctx.targetWords),
    OUTLET_GUIDANCE: ctx.outletGuidance,
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
    PITCH_INSTRUCTION:
      'ALSO write a pitch cover email in "pitch_email". Use this layout: a subject line "Op-Ed Submission: [Headline]"; one or two sentences opening with the news hook and summarizing the thesis and proposed solution; one sentence of author credentials; and a closing note that the full draft is pasted below. Keep it under 150 words and do not paste the essay itself into the pitch.',
    SOURCE_AUTHOR: ctx.sourceBrief?.author ?? '',
    SOURCE_ACTOR_TYPE: ctx.sourceBrief?.actor_type ?? '',
    SOURCE_THESIS: ctx.sourceBrief?.thesis ?? '',
    SOURCE_STANCE: ctx.sourceBrief?.stance ?? '',
    SOURCE_RECOMMENDATIONS: ctx.sourceBrief?.primary_recommendations?.join('; ') ?? '',
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

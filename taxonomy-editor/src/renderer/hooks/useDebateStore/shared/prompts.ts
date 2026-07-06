// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateAudience, SpeakerId, DocumentAnalysis, GapInjection, TopicCritique } from '../../../types/debate';
import { POVER_INFO } from '../../../types/debate';
import {
  clarificationPrompt,
  concludingPrompt,
  debateResponsePrompt,
  crossRespondPrompt,
  probingQuestionsPrompt,
  factCheckPrompt,
  contextCompressionPrompt,
} from '../../../prompts/debate';
import { formatCritiqueForRefinement } from '@lib/debate/topicCritique';

export function buildClarificationPrompt(topic: string, sourceContent?: string, audience?: DebateAudience, lineageContext?: string): string {
  return clarificationPrompt(topic, sourceContent, audience, lineageContext);
}

export function buildSynthesisPrompt(
  originalTopic: string,
  clarifications: { speaker: string; questions: string[]; answers: string }[],
  audience?: DebateAudience,
  critique?: TopicCritique | null,
): string {
  let qaPairs = '';
  for (const c of clarifications) {
    qaPairs += `\n${c.speaker} asked:\n`;
    for (const q of c.questions) qaPairs += `  - ${q}\n`;
    qaPairs += `User answered: ${c.answers}\n`;
  }
  const critiqueContext = critique ? formatCritiqueForRefinement(critique) : undefined;
  return concludingPrompt(originalTopic, qaPairs, audience, critiqueContext);
}

export function buildDebateResponsePrompt(
  poverId: Exclude<SpeakerId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  question: string,
  addressing: string,
  sourceContent?: string,
  length: string = 'medium',
  docAnalysis?: DocumentAnalysis,
  audience?: DebateAudience,
  lineageContext?: string,
): string {
  const info = POVER_INFO[poverId];
  return debateResponsePrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, question, addressing, sourceContent, length, docAnalysis, audience, lineageContext);
}

export function formatGapHint(gapInjections?: GapInjection[]): string {
  const args = gapInjections?.[0]?.arguments;
  if (!args || args.length === 0) return '';
  const lines = args.map((g, i) =>
    `  ${i + 1}. [${g.gap_type}] ${g.argument} (Why missing: ${g.why_missing})`,
  );
  return `\n\n## Identified Debate Gaps (unaddressed)\nThe following gaps were identified mid-debate but have NOT yet been substantively addressed by any debater. Prioritize steering the conversation toward these:\n${lines.join('\n')}\n`;
}

export function buildCrossRespondPrompt(
  poverId: Exclude<SpeakerId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  focusPoint: string,
  addressing: string,
  length: string = 'medium',
  sourceContent?: string,
  docAnalysis?: DocumentAnalysis,
): string {
  const info = POVER_INFO[poverId];
  return crossRespondPrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, focusPoint, addressing, length, sourceContent, docAnalysis, info.doctrinal_boundaries);
}

export function buildProbingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
  hasSourceDocument: boolean = false,
  audience?: DebateAudience,
): string {
  return probingQuestionsPrompt(topic, transcript, unreferencedNodes, hasSourceDocument, undefined, audience);
}

export function buildFactCheckPrompt(
  selectedText: string,
  statementContext: string,
  taxonomyNodes: string,
  conflictData: string,
  audience?: DebateAudience,
): string {
  return factCheckPrompt(selectedText, statementContext, taxonomyNodes, conflictData, audience);
}

export function buildContextCompressionPrompt(
  entries: string,
  audience?: DebateAudience,
): string {
  return contextCompressionPrompt(entries, audience);
}

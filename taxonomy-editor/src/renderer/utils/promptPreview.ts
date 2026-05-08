// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Generates a fully assembled prompt preview with real data from active sessions.
 * Used by the Prompt Inspector (Phase A). Mirrors the debate engine's prompt
 * assembly logic outside its normal execution flow.
 */

import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useDebateStore } from '../hooks/useDebateStore';
import { formatTaxonomyContext } from './taxonomyContext';
import type { TaxonomyContext } from './taxonomyContext';
import type { PovNode, SituationNode } from '../types/taxonomy';
import { interpretationText } from '../types/taxonomy';
import type { PromptPreviewResult } from '@lib/debate/types';
import {
  clarificationPrompt,
  concludingPrompt,
  openingStatementPrompt,
  debateResponsePrompt,
  crossRespondSelectionPrompt,
  crossRespondPrompt,
  debateSynthesisPrompt,
  probingQuestionsPrompt,
  factCheckPrompt,
  contextCompressionPrompt,
  situationClarificationPrompt,
} from '../prompts/debate';
import { POVER_INFO } from '../types/debate';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function section(name: string, text: string): { name: string; charCount: number; tokenEstimate: number } {
  return { name, charCount: text.length, tokenEstimate: estimateTokens(text) };
}

function getTaxCtx(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();
  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const situationNodes: SituationNode[] = state.situations?.nodes ?? [];
  const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
  return { povNodes, situationNodes, policyRegistry };
}

function getDebateState() {
  return useDebateStore.getState();
}

function formatTranscript(maxEntries = 10): string {
  const { activeDebate } = getDebateState();
  if (!activeDebate?.transcript?.length) return '(no transcript yet)';
  const entries = activeDebate.transcript.slice(-maxEntries);
  return entries.map(e => {
    const label = e.speaker === 'system' ? 'System' :
      (POVER_INFO[e.speaker as keyof typeof POVER_INFO]?.label ?? e.speaker);
    return `[${label}]: ${e.content.slice(0, 500)}${e.content.length > 500 ? '...' : ''}`;
  }).join('\n\n');
}

/** Generate a fully assembled prompt preview for the given prompt ID. */
export function generatePromptPreview(promptId: string): PromptPreviewResult | null {
  const debate = getDebateState();
  const session = debate.activeDebate;

  if (!session) return null;

  const topic = session.topic?.refined || session.topic?.original || '(no topic)';
  // Use first non-user pover for preview
  const firstPover = session.povers?.find(p => p !== 'user') ?? 'prometheus';
  const poverInfo = POVER_INFO[firstPover as keyof typeof POVER_INFO];
  const pov = poverInfo?.pov ?? 'accelerationist';
  const ctx = getTaxCtx(pov);
  const taxonomyBlock = formatTaxonomyContext(ctx, pov);
  const transcript = formatTranscript();
  const sections: { name: string; charCount: number; tokenEstimate: number }[] = [];

  let text = '';

  try {
    switch (promptId) {
      case 'debate-clarification': {
        text = clarificationPrompt(topic);
        sections.push(section('Prompt', text));
        break;
      }
      case 'debate-situation-clarification': {
        const sitNode = ctx.situationNodes[0];
        const sitContext = sitNode
          ? `[${sitNode.id}] ${sitNode.label}: ${sitNode.description}\nInterpretations:\n  Acc: ${interpretationText(sitNode.interpretations.accelerationist)}\n  Saf: ${interpretationText(sitNode.interpretations.safetyist)}\n  Skp: ${interpretationText(sitNode.interpretations.skeptic)}`
          : '(no situation node available)';
        text = situationClarificationPrompt(topic, sitContext);
        sections.push(section('Prompt', text));
        break;
      }
      case 'debate-synthesis-topic': {
        text = concludingPrompt(topic, '(clarification Q&A would appear here)');
        sections.push(section('Prompt', text));
        break;
      }
      case 'debate-opening': {
        text = openingStatementPrompt(
          poverInfo?.label ?? 'Debater',
          pov,
          poverInfo?.personality ?? '',
          topic,
          taxonomyBlock,
          session.source_content ?? '',
          true,
        );
        sections.push(section('Instructions', text.slice(0, text.indexOf(taxonomyBlock))));
        sections.push(section('Taxonomy Context', taxonomyBlock));
        break;
      }
      case 'debate-response': {
        text = debateResponsePrompt(
          poverInfo?.label ?? 'Debater',
          pov,
          poverInfo?.personality ?? '',
          topic,
          taxonomyBlock,
          transcript,
          '(question would appear here)',
          'all',
        );
        sections.push(section('Instructions', text.length.toString()));
        sections.push(section('Taxonomy Context', taxonomyBlock));
        sections.push(section('Transcript', transcript));
        break;
      }
      case 'debate-cross-selection': {
        const povers = session.povers?.filter(p => p !== 'user') ?? [];
        text = crossRespondSelectionPrompt(transcript, povers);
        sections.push(section('Prompt', text));
        break;
      }
      case 'debate-cross-respond': {
        text = crossRespondPrompt(
          poverInfo?.label ?? 'Debater',
          pov,
          poverInfo?.personality ?? '',
          topic,
          taxonomyBlock,
          transcript,
          '(focus point)',
          'all',
        );
        sections.push(section('Taxonomy Context', taxonomyBlock));
        sections.push(section('Transcript', transcript));
        break;
      }
      case 'debate-full-synthesis': {
        text = debateSynthesisPrompt(topic, transcript);
        sections.push(section('Instructions', text.slice(0, 500)));
        sections.push(section('Transcript', transcript));
        break;
      }
      case 'debate-probing': {
        text = probingQuestionsPrompt(topic, transcript, []);
        sections.push(section('Prompt', text));
        break;
      }
      case 'debate-fact-check': {
        text = factCheckPrompt('(selected text)', '(context)', taxonomyBlock, '');
        sections.push(section('Taxonomy Context', taxonomyBlock));
        break;
      }
      case 'debate-compression': {
        text = contextCompressionPrompt(transcript);
        sections.push(section('Transcript', transcript));
        break;
      }
      default: {
        // For prompts we can't assemble (PS backend, chat, etc.), show template
        return null;
      }
    }
  } catch {
    return null;
  }

  return {
    text,
    tokenEstimate: estimateTokens(text),
    sections,
  };
}

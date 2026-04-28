import type { StandardizedTerm } from '../dictionary/types';
import type { OccurrenceLocation, LlmFallbackConfig, SenseSignal } from './types';

export interface LlmFallbackInput {
  occurrence: OccurrenceLocation;
  signals: Record<string, SenseSignal>;
  candidateSenses: StandardizedTerm[];
  config: LlmFallbackConfig;
  largerContext: string;
}

export interface LlmFallbackResult {
  resolved_to: string | null;
  confidence: 'medium' | 'ambiguous';
  rationale: string;
  model: string;
}

export interface LlmAdapter {
  generateText(prompt: string, model: string, options?: { temperature?: number; maxTokens?: number; timeoutMs?: number }): Promise<string>;
}

export function buildFallbackPrompt(input: LlmFallbackInput): string {
  const { occurrence, signals, candidateSenses, config } = input;

  const topSenses = Object.entries(signals)
    .sort((a, b) => b[1].combined_score - a[1].combined_score)
    .slice(0, config.max_candidate_senses);

  const senseDescriptions = topSenses.map(([canonical]) => {
    const sense = candidateSenses.find(s => s.canonical_form === canonical);
    if (!sense) return '';
    return [
      `### ${sense.canonical_form} (${sense.display_form})`,
      `Camp: ${sense.primary_camp_origin}`,
      `Definition: ${sense.definition}`,
      `Characteristic phrases: ${sense.characteristic_phrases.join(', ')}`,
      `Local score: ${signals[canonical].combined_score}`,
    ].join('\n');
  }).join('\n\n');

  return `You are a terminology disambiguation expert for an AI policy research taxonomy.

The following text contains the term "${occurrence.colloquial_term}" which is ambiguous across research camps. Determine which standardized sense the author intends.

## Context
${input.largerContext}

## Candidate Senses
${senseDescriptions}

## Instructions
Analyze the context and determine which sense best matches the author's intent. Respond in JSON:

\`\`\`json
{
  "resolved_to": "<canonical_form or null if truly ambiguous>",
  "confidence": "<medium or ambiguous>",
  "rationale": "<1-2 sentences explaining your reasoning>"
}
\`\`\`

If the author appears to slide between senses deliberately, set resolved_to to null and explain in the rationale.`;
}

export async function resolveFallback(
  input: LlmFallbackInput,
  adapter: LlmAdapter,
): Promise<LlmFallbackResult> {
  const prompt = buildFallbackPrompt(input);
  const { config } = input;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= config.max_retries; attempt++) {
    try {
      const raw = await adapter.generateText(prompt, config.model, {
        temperature: 0.2,
        maxTokens: 500,
        timeoutMs: config.timeout_seconds * 1000,
      });

      const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('LLM response did not contain valid JSON');
      }

      const jsonStr = jsonMatch[1] ?? jsonMatch[0];
      const parsed = JSON.parse(jsonStr) as {
        resolved_to: string | null;
        confidence: string;
        rationale: string;
      };

      const validSenses = new Set(input.candidateSenses.map(s => s.canonical_form));
      const resolvedTo = parsed.resolved_to && validSenses.has(parsed.resolved_to)
        ? parsed.resolved_to
        : null;

      return {
        resolved_to: resolvedTo,
        confidence: resolvedTo ? 'medium' : 'ambiguous',
        rationale: parsed.rationale ?? 'No rationale provided',
        model: config.model,
      };
    } catch (err) {
      lastError = err as Error;
    }
  }

  return {
    resolved_to: null,
    confidence: 'ambiguous',
    rationale: `LLM fallback failed after ${config.max_retries + 1} attempts: ${lastError?.message}`,
    model: config.model,
  };
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { researchPrompt, conflictResearchPrompt } from '../prompts/research';

/**
 * Generates a structured research prompt for investigating a taxonomy position.
 * The prompt is designed to be pasted into an external AI tool (Claude, ChatGPT, etc.).
 */
export function generateResearchPrompt(label: string, description: string): string {
  return researchPrompt(label, description);
}

/**
 * Generates a research prompt for investigating a factual conflict between sources.
 */
export function generateConflictResearchPrompt(
  claimLabel: string,
  description: string,
  instances: Array<{ doc_id: string; assertion: string; stance: string }>,
): string {
  const stances = instances
    .map((i) => `  - [${i.stance.toUpperCase()}] ${i.doc_id}: "${i.assertion}"`)
    .join('\n');
  return conflictResearchPrompt(claimLabel, description, stances);
}

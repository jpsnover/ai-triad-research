// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { TopicScope } from '../types.js';

export const PROMPT_VERSION = '2026-07-22.1';

// ── Model-tier prompt routing (t/331) ────────────────────────────
// Flash/lite models can't process full prose_style + voice_hygiene blocks.
// Set compact mode before generating prompts for weaker backends.
let _promptCompact = false;

export function setPromptCompact(compact: boolean): void {
  _promptCompact = compact;
}

/** Read the shared compact-mode flag. Readers MUST use this, never a local copy. */
export function getPromptCompact(): boolean {
  return _promptCompact;
}

export function isCompactModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('flash-lite') || m.includes('flash-8b') || m.includes('llama') || m.includes('gemma');
}

// ── Topic scope prompt placement (t/337) ─────────────────────────
// Place TopicScope constraints at high-attention prompt positions
// (primacy + recency) to mitigate Lost-in-the-Middle degradation.
let _topicScope: TopicScope | null = null;

export function setTopicScope(scope: TopicScope | null): void {
  _topicScope = scope;
}

/** Read the shared topic scope singleton. Readers MUST use this, never a local copy. */
export function getTopicScope(): TopicScope | null {
  return _topicScope;
}

export function hasMeaningfulScope(scope: TopicScope | null): scope is TopicScope {
  if (!scope) return false;
  return scope.core_proposition.length > 0
    && scope.off_scope_topics.length > 0;
}

export function formatDebateScopeBlock(scope: TopicScope): string {
  const lines = ['=== DEBATE SCOPE ==='];
  lines.push(`This debate is about: ${scope.core_proposition}`);
  if (scope.relevant_disciplines.length > 0) {
    lines.push(`Draw evidence from: ${scope.relevant_disciplines.join(', ')}`);
  }
  if (scope.off_scope_topics.length > 0) {
    lines.push(`Off-scope (do not build arguments around): ${scope.off_scope_topics.join(', ')}`);
  }
  if (scope.example_ceiling) {
    lines.push(`Example ceiling: ${scope.example_ceiling}`);
  }
  if (scope.excluded_scenarios.length > 0) {
    lines.push(`Explicitly excluded: ${scope.excluded_scenarios.join(', ')}`);
  }
  return lines.join('\n');
}

export function formatScopeReminder(scope: TopicScope): string {
  const offScope = scope.off_scope_topics.slice(0, 2).join(', ');
  return `Scope reminder: ${scope.core_proposition}. Do not build arguments around: ${offScope}.`;
}

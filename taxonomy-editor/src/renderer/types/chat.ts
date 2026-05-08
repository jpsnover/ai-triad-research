// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId, TaxonomyRef } from './debate';

export type ChatMode = 'brainstorm' | 'inform' | 'decide';

export interface ChatEntry {
  id: string;
  timestamp: string;
  speaker: SpeakerId | 'system';
  content: string;
  taxonomy_refs: TaxonomyRef[];
  metadata?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  mode: ChatMode;
  topic: string;
  pover: Exclude<SpeakerId, 'user'>;
  transcript: ChatEntry[];
  /** Chat-specific AI model override. If set, used instead of the global model. */
  chat_model?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  mode: ChatMode;
  pover: Exclude<SpeakerId, 'user'>;
}

export const CHAT_MODE_INFO: Record<ChatMode, {
  label: string;
  description: string;
  placeholder: string;
}> = {
  brainstorm: {
    label: 'Brainstorm',
    description: 'Explore ideas freely',
    placeholder: 'What do you want to explore?',
  },
  inform: {
    label: 'Inform',
    description: 'Learn about a topic',
    placeholder: 'What do you want to learn about?',
  },
  decide: {
    label: 'Decide',
    description: 'Work through a decision',
    placeholder: 'What decision are you facing?',
  },
};

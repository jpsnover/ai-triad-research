// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type Verdict = 'correct' | 'incorrect' | 'uncertain' | 'novel';

export interface SecondaryRef {
  node_id: string;
  similarity: number;
}

export interface GoldenClaim {
  claim_id: string;
  claim_text: string;
  speaker: string;
  attributed_node: string;
  similarity_score: number;
  secondary_refs: SecondaryRef[];
  debate_id: string;
  debate_title: string;
  node_type: string;
  turn_number: number;
  computed_strength: number;
}

export interface GoldenSetFile {
  metadata: {
    debates_processed: number;
    debates_with_claims: number;
    total_claims: number;
    has_similarity_score: number;
  };
  claims: GoldenClaim[];
}

export interface ValidationResult {
  claim_id: string;
  original_node: string;
  verdict: Verdict;
  corrected_node?: string;
  corrected_category?: string;
  reviewer_notes?: string;
  reviewed_at: string;
}

export interface ValidationResultsFile {
  results: ValidationResult[];
  saved_at: string;
}

export interface ValidationMetadata {
  total: number;
  reviewed: number;
  correct: number;
  incorrect: number;
  uncertain: number;
  novel: number;
}

export type VerdictFilter = Verdict | 'unreviewed' | 'all';
export type SpeakerFilter = 'all' | 'accelerationist' | 'safetyist' | 'skeptic';

export interface ScoreRange {
  min: number;
  max: number;
}

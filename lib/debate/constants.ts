// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export const DOC_TRUNCATION_LIMIT = 50_000;

/** Cosine similarity threshold for detecting semantic recycling across debate turns. */
export const SEMANTIC_RECYCLING_THRESHOLD = 0.85;

/** Cosine similarity threshold for deduplicating attack moves in the argument network. */
export const ATTACK_DEDUP_THRESHOLD = 0.85;

/** Polarity score threshold for classifying a crux as resolved (support or attack direction). */
export const POLARITY_RESOLVED_THRESHOLD = 0.85;

/** Default timeout (ms) for AI generation calls in the debate engine. */
export const DEFAULT_AI_TIMEOUT_MS = 120_000;

/** Default relevance threshold for taxonomy node selection during debate turns. */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.45;

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const SYSTEM_PROMPT = `You rewrite academic ontological descriptions into plain language that a high school student could understand.

Rules:
1. Write at a 10th-grade reading level (Flesch-Kincaid grade ~10).
2. Use as many sentences as needed to faithfully convey the full meaning. Aim for 40-150 words — shorter for simple ideas, longer for complex multi-part claims. Never pad, but never truncate a meaningful distinction either.
3. Drop the "A Belief/Desire/Intention within X discourse that..." opener — start directly with the idea.
4. Convert "Encompasses:" items into natural prose — weave them into the explanation rather than dropping them. These sub-concepts are important.
5. Drop the "Excludes:" clause — it's an ontological boundary marker, not part of the idea itself.
6. Replace jargon with everyday words (e.g., "telemetry" → "monitoring", "post-scarcity" → "a world without shortages").
7. Preserve the core claim and its important nuances — do not add, soften, or editorialize.
8. Use active voice when possible.
9. Return ONLY the rewritten text — no labels, no explanation.`;

export const VERNACULAR_MODEL = 'gemini-flash-lite-latest';
export const VERNACULAR_TEMPERATURE = 0.2;
export const VERNACULAR_TIMEOUT = 15_000;
export const VERNACULAR_VERSION = 'flash-lite:v1';

export function vernacularPrompt(description: string): string {
  return `${SYSTEM_PROMPT}\n\nRewrite this node description:\n\n${description}`;
}

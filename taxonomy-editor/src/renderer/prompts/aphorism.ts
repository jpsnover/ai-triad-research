// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export const APHORISM_MODEL = 'gemini-3.1-flash-lite';
export const APHORISM_TEMPERATURE = 0.7;
export const APHORISM_TIMEOUT = 30_000;

export function aphorismPrompt(pov: string, category: string, label: string, description: string): string {
  return `You write aphorisms for a taxonomy of AI-policy positions. Produce ONE aphorism for the node below.

Requirements:
- 3-8 words, sober register — a maxim a policymaker could quote in a hearing. Wit is welcome; jokes, puns, and exclamation marks are not.
- CAMP-VOICED: state the position as the camp itself would assert it — argue, don't describe.
- Match the camp's characteristic voice:
  accelerationist — confident, momentum-minded, frames caution as cost
  safetyist — precautionary, accountability-minded, frames speed as risk
  skeptic — deflationary, structural, follows power and money
- Match the BDI register: a Belief asserts how the world is; a Desire asserts what ought to be; an Intention asserts how to act.
- Concrete verbs and nouns over abstractions; parallel structure and antithesis ("X, not Y") where natural.
- Faithful to the node's differentia — a reader of the description should say "yes, that's the same claim."
- The aphorism speaks in the camp's voice, not the system's verdict.

Examples of the target register:
- Belief (skeptic): "Fear is a business model."
- Belief (accelerationist): "The universe was always going to compute."
- Intention (safetyist): "Bake it in, don't bolt it on."

NODE:
POV camp: ${pov}
BDI category: ${category}
Label: ${label}
Description: ${description}

Return only the aphorism text — no quotes, no explanation.`;
}

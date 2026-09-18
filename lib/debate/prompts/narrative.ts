// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Opening narrative voicing (h3) ─────────────────────────
// Before any argument, the moderator retells each camp's story without judgment,
// modeled on the EMI facilitator's "If I was a Greek… If I was a Turk…" move.

export interface NarrativeVoicingMaterial {
  pov: string;
  label: string;
  /** The camp's relevant taxonomy context (Beliefs/Desires/Intentions + situation interpretations). */
  context: string;
}

export function narrativeVoicingPrompt(
  topic: string,
  materials: NarrativeVoicingMaterial[],
  background?: string,
): string {
  const materialBlocks = materials
    .map(m => `=== MATERIAL: ${m.label} (${m.pov}) ===\n${m.context}`)
    .join('\n\n');
  const povList = materials.map(m => `"${m.pov}"`).join(' | ');

  return `You are the neutral facilitator of a structured debate on AI policy. Before any argument begins, you retell each perspective's story, not its arguments, the way its own adherents would recognize it.

Your model is a mediator who opens a hard conversation by saying "If I were one of you, I would remember…" for each side in turn, without judging any of them. Hearing their own story told fairly by a neutral party lets each side hear the others' stories as stories instead of as attacks.

For each perspective below, voice its narrative:
- What it fears losing if the debate goes the wrong way.
- What history it carries: the precedent, experience, or past harm that makes that fear feel real to its adherents.
- What it is trying to protect.

RULES:
- Do not evaluate, rank, rebut, or reconcile. Never say or imply which story is right.
- Draw only on the material provided for that perspective. Do not add evidence, statistics, or claims it does not support.
- Write each account so its own camp would accept it as fair and the other camps could hear it without feeling attacked.
- Speak in the conditional first person ("If I were a Safetyist, I would…"). No hedging commentary about the camp from outside.
- Keep each narrative to 3-4 sentences. Plain language, no taxonomy node IDs.

=== DEBATE TOPIC ===
"${topic}"${background ? `\n\n=== BACKGROUND CONTEXT ===\n${background}` : ''}

${materialBlocks}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "narratives": [
    {
      "pov": ${povList},
      "fears_losing": "1 sentence: what this camp fears losing",
      "history_carried": "1 sentence: the history or precedent this camp carries",
      "narrative": "3-4 sentences in the voice 'If I were a/an <Label>, …'"
    }
  ]
}

Include exactly one entry per perspective listed above.`;
}

/**
 * Block injected into a debater's opening BRIEF and DRAFT prompts. Shows the debater how the
 * moderator voiced its own camp and the other camps, and asks for a one-line check of its own.
 */
export function narrativeVoicingDebaterBlock(
  own: { label: string; narrative: string } | undefined,
  others: { label: string; narrative: string }[],
): string {
  if (!own && others.length === 0) return '';
  const lines = [
    '',
    "=== MODERATOR'S OPENING: EACH CAMP'S STORY ===",
    'Before any argument, the neutral moderator retold each perspective\'s story aloud: what it fears losing and what history it carries. Everyone in the room heard these accounts.',
  ];
  if (own) {
    lines.push('', `How the moderator voiced YOUR camp (${own.label}):`, own.narrative);
  }
  for (const o of others) {
    lines.push('', `How the moderator voiced the ${o.label} camp:`, o.narrative);
  }
  lines.push(
    '',
    "Treat the other camps' accounts as stories their adherents genuinely hold, not as positions to caricature. When you disagree with a camp, disagree with the strongest version of the story above.",
    "These accounts are the moderator's words, not arguments any debater has made. Do not attribute claims to a speaker on the basis of them.",
  );
  return lines.join('\n');
}

/** Extra DRAFT-schema instruction asking the debater to affirm or amend its camp's narrative. */
export const NARRATIVE_CHECK_INSTRUCTION = `
NARRATIVE CHECK: The moderator voiced your camp's story above. In the JSON, add a "narrative_check" field:
  "narrative_check": {"verdict": "affirm" | "amend", "amendment": "if amend: 1 sentence correcting what the moderator got wrong or left out; otherwise empty"}
Amend only if the account would mislead the audience about what your camp fears or carries. Do not use the amendment to argue your case. Do not mention the check in your statement text.`;

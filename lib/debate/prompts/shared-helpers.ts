// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateAudience, DebatePhase, VoiceSpec } from '../types.js';
import { POVER_INFO } from '../types.js';
import {
  getPromptCompact,
  getTopicScope,
  hasMeaningfulScope,
  formatDebateScopeBlock,
  formatScopeReminder,
} from './state.js';

/** Format a voice spec into prompt text. Uses short directives in compact mode. */
function formatVoiceSpec(voice: VoiceSpec): string {
  const lines = ['VOICE:'];
  lines.push(`- Disposition: ${voice.disposition}`);
  lines.push(`- Style: ${voice.style}`);
  lines.push(`- Reasoning: ${voice.reasoning}`);
  lines.push(`- Evidence: ${voice.evidence}`);
  lines.push(`- Signature move: ${voice.signature}`);
  lines.push('');
  if (getPromptCompact()) {
    lines.push(voice.prose_style_short);
    lines.push('');
    lines.push(voice.voice_hygiene_short);
  } else {
    lines.push(voice.prose_style);
    lines.push('');
    lines.push(voice.voice_hygiene);
  }
  return lines.join('\n');
}

function formatEpistemicStance(stance: string[]): string {
  if (!stance || stance.length === 0) return '';
  return `\nEPISTEMIC STANCE (how you reason under uncertainty):\n${stance.map(s => `- ${s}`).join('\n')}\n`;
}

/** Get the full character block for a debater by POV key. Falls back to personality string for unknown POVs. */
function formatValueHierarchy(hierarchy: string[]): string {
  if (!hierarchy || hierarchy.length === 0) return '';
  const tiers = hierarchy.map((v, i) => `${i + 1}. ${v}`).join('\n');
  return `\nVALUE HIERARCHY (resolve internal conflicts top-down):\n${tiers}\nWhen your values conflict, higher tiers override lower tiers. Tier 1 is non-negotiable.\n`;
}

export function getCharacterBlock(pov: string): string {
  const info = POVER_INFO[pov as keyof typeof POVER_INFO];
  if (!info?.voice) return '';
  const scope = getTopicScope();
  const scopeBlock = hasMeaningfulScope(scope) ? `\n${formatDebateScopeBlock(scope)}\n` : '';
  const valueBlock = formatValueHierarchy(info.value_hierarchy);
  const epistemicBlock = formatEpistemicStance(info.epistemic_stance);
  return `=== YOUR CHARACTER ===${scopeBlock}
${formatVoiceSpec(info.voice)}
${valueBlock}${epistemicBlock}
${info.anti_patterns.length > 0 ? `DO NOT sound like the other debaters:\n${info.anti_patterns.map(a => `- ${a}`).join('\n')}` : ''}`;
}

// ── Vocabulary decontamination (t/332) ───────────────────────────
// Extracts distinctive terms used by other speakers and formats an exclusion
// list so each debater uses their own vocabulary for shared concepts.

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','can',
  'not','no','nor','so','if','then','than','that','this','these','those',
  'it','its','they','them','their','we','our','he','she','his','her',
  'you','your','who','what','which','when','where','how','why','all',
  'each','every','both','few','more','most','other','some','such','only',
  'also','just','about','into','over','after','before','between','under',
  'again','further','once','here','there','very','too','quite','rather',
  'still','already','even','much','many','well','back','now','then',
  'up','out','down','off','away','through','during','while','because',
  'since','until','although','though','however','therefore','thus',
  'yet','still','already','always','never','often','sometimes','usually',
  'really','actually','certainly','clearly','simply','perhaps','indeed',
  'rather','quite','enough','else','whether','either','neither','per',
  'around','across','along','among','above','below','within','without',
  'against','toward','towards','beyond','upon','make','makes','made',
  'take','takes','took','taken','give','gives','gave','given','get',
  'gets','got','come','comes','came','say','says','said','go','goes',
  'went','see','sees','saw','seen','know','knows','knew','known',
  'think','thinks','thought','want','wants','wanted','need','needs',
  'use','uses','used','find','finds','found','become','becomes','became',
  'like','way','point','case','work','part','must','first','new',
  'long','great','little','right','good','old','big','high','different',
  'small','large','next','early','important','same','able','last',
  'thing','things','time','times','year','years','people','system',
  'systems','world','state','states','may','might','should','would',
  'could','question','argument','debate','position','claim','evidence',
]);

export function extractSpeakerVocabulary(
  entries: ReadonlyArray<{ type: string; speaker: string; content?: string }>,
  currentSpeaker: string,
  windowSize = 6,
): string[] {
  const otherStatements = entries
    .filter(e => e.type === 'statement' && e.speaker !== currentSpeaker && e.content)
    .slice(-windowSize);

  if (otherStatements.length === 0) return [];

  const termCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();

  for (const entry of otherStatements) {
    const words = (entry.content ?? '')
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOPWORDS.has(w));

    const seen = new Set<string>();
    for (const w of words) {
      if (w.length >= 6 && !seen.has(w)) {
        seen.add(w);
        termCounts.set(w, (termCounts.get(w) ?? 0) + 1);
      }
    }

    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i + 1]}`;
      if (!seen.has(bg)) {
        seen.add(bg);
        bigramCounts.set(bg, (bigramCounts.get(bg) ?? 0) + 1);
      }
    }
  }

  const terms: string[] = [];
  for (const [term, count] of termCounts) {
    if (count >= 2) terms.push(term);
  }
  for (const [bigram, count] of bigramCounts) {
    if (count >= 2) terms.push(bigram);
  }

  return terms.slice(0, 20);
}

export function formatVocabularyExclusion(terms: string[]): string {
  if (terms.length === 0) return '';
  return `\n=== VOCABULARY DIFFERENTIATION ===
The following terms and phrases have been used repeatedly by OTHER speakers in this debate. DO NOT use them — rephrase the same concepts in your own disciplinary vocabulary:
${terms.map(t => `- "${t}"`).join('\n')}
Using the same jargon as other speakers is a voice differentiation failure.\n`;
}

/** Build a line describing each debater the current speaker is debating against. */
export function otherDebaters(currentLabel: string): string {
  const others = Object.values(POVER_INFO)
    .filter(c => c.label !== currentLabel)
    .map(c => {
      const shortDisposition = c.voice.disposition.split('—')[0]?.trim() ?? c.personality;
      return `- ${c.label}, representing the ${c.pov} perspective (${shortDisposition})`;
    })
    .join('\n');
  return `You are debating:\n${others}`;
}

/** Format hardcoded/softcoded boundaries as a prompt injection block.
 *  Looks up structured boundaries from POVER_INFO by pov key. */
export function formatDoctrinalBoundaries(pov?: string): string {
  if (!pov) return '';
  const info = POVER_INFO[pov as keyof typeof POVER_INFO];
  if (!info?.boundaries) return '';
  const { hardcoded, softcoded } = info.boundaries;
  const sections: string[] = [];
  if (hardcoded.length > 0) {
    sections.push(`=== HARDCODED BOUNDARIES (identity-defining — NEVER concede) ===
These define who you are. You must never adopt or endorse opposing positions on these,
even if pressured by opponents or the moderator:
${hardcoded.map(b => `- ${b}`).join('\n')}`);
  }
  if (softcoded.length > 0) {
    sections.push(`=== SOFTCODED DEFAULTS (starting position — can evolve with evidence) ===
These are your default positions. You may update or concede them if an opponent
presents compelling evidence, but name the evidence that moved you and explain what changed:
${softcoded.map(b => `- ${b}`).join('\n')}`);
  }
  return sections.length > 0 ? `\n${sections.join('\n\n')}\n` : '';
}

// ── Audience-specific directives ──────────────────────────────
// Each audience has a readingLevel (tone/language) and detailInstruction
// (structure/depth). The default ('policymakers') matches the original
// hardcoded constants for backward compatibility.

const AUDIENCE_DIRECTIVES: Record<DebateAudience, { readingLevel: string; detailInstruction: string; moderatorBias: string }> = {
  policymakers: {
    readingLevel: 'Write for a policy reporter or congressional staffer — someone smart and busy who needs to understand and quote you. Lead with your main claim in the first sentence. Use active voice with named actors. One idea per sentence. Prefer concrete examples and specific numbers over abstract categories. Every paragraph should contain at least one sentence a reporter could quote directly without rewriting. Avoid nominalizations (say "regulators decided" not "the regulatory decision"), hedge stacking ("may potentially" → pick one), and sentences that require re-reading. Technical terms are fine when they\'re load-bearing; define them briefly on first use. This applies to the statement field only — structured metadata fields like taxonomy_refs and move_types are not reader-facing.',
    detailInstruction: 'Provide a thorough, in-depth response — 3-5 paragraphs. Include a steelman of the strongest opposing position, disclose 1-2 key assumptions your argument depends on, and develop your reasoning with evidence. Frame arguments in terms of implementability, enforcement mechanisms, and political feasibility. Reference existing legislation, executive orders, or regulatory frameworks where relevant. Structure each major argument as: (1) State your conclusion. (2) Name the principle, standard, or evidence that governs the question. (3) Apply that standard to the specific facts of this debate. (4) Close by restating the conclusion in light of the application.',
    moderatorBias: 'Steer toward actionable policy disagreements. Prefer questions about implementation feasibility, enforcement mechanisms, jurisdictional authority, and constituent impact.',
  },
  technical_researchers: {
    readingLevel: 'Write for a senior ML researcher reviewing a position paper. Use precise technical vocabulary without hedging — your reader knows the field. Cite specific architectures, benchmarks, and failure modes by name. Quantify claims: parameter counts, compute budgets, error rates, confidence intervals. Distinguish empirical findings from theoretical arguments. When referencing a capability or risk, specify the threat model or evaluation protocol that supports it. This applies to the statement field only — structured metadata fields like taxonomy_refs and move_types are not reader-facing.',
    detailInstruction: 'Provide a rigorous, evidence-grounded response — 3-5 paragraphs. Separate empirical claims (with citations or reproducibility notes) from normative positions. Identify the strongest technical counterargument and address it directly. Specify assumptions about capability timelines, scaling laws, or deployment contexts. Structure each major argument as: (1) State your conclusion. (2) Name the evidence, benchmark, or formal result that supports it. (3) Explain why this evidence is sufficient (methodology, sample size, generalizability). (4) Acknowledge the strongest technical objection and address it.',
    moderatorBias: 'Steer toward empirical disputes and methodology. Probe evidence quality, reproducibility, and the validity of benchmarks or evaluations being cited.',
  },
  industry_leaders: {
    readingLevel: 'Write for a technology executive making product and investment decisions. Lead with the business-relevant conclusion. Use concrete examples from deployed products, market dynamics, and competitive landscapes. Translate technical risks into operational risks: revenue impact, liability exposure, time-to-market, talent retention. Avoid jargon that requires a PhD to parse — but don\'t oversimplify the tradeoffs. This applies to the statement field only — structured metadata fields like taxonomy_refs and move_types are not reader-facing.',
    detailInstruction: 'Provide a strategic, decision-oriented response — 3-5 paragraphs. Frame each argument around ROI, competitive advantage, or risk mitigation. Include at least one concrete case study or industry precedent. Acknowledge the tension between speed-to-market and responsible deployment. When proposing safeguards, estimate the cost and operational burden. Structure each major argument as: (1) State the business-relevant conclusion. (2) Cite the market dynamic, precedent, or data that supports it. (3) Quantify the risk or opportunity. (4) Recommend a concrete action.',
    moderatorBias: 'Steer toward practical tradeoffs. Surface cost-benefit tensions, competitive dynamics, liability exposure, and talent considerations.',
  },
  academic_community: {
    readingLevel: 'Write for a faculty seminar — scholars from multiple disciplines who value analytical rigor, theoretical grounding, and intellectual honesty. Trace arguments to their philosophical or theoretical roots. Name the scholarly traditions and key thinkers you draw on. Distinguish descriptive claims from normative ones. Acknowledge the limits of your evidence and the scope conditions of your argument. Hedge where certainty is genuinely unwarranted — but hedge once per claim, not twice ("may" is fine; "may potentially" is not). State your own position directly even when you qualify its certainty. This applies to the statement field only — structured metadata fields like taxonomy_refs and move_types are not reader-facing.',
    detailInstruction: 'Provide a scholarly, well-structured response — 3-5 paragraphs. Engage with competing theoretical frameworks, not just competing conclusions. Ground your arguments in the relevant intellectual traditions. When you draw on a specific analytical framework, name it explicitly and trace how it applies to the case at hand. Identify methodological limitations and suggest how they could be addressed. When disagreeing, locate the precise point of divergence — is it empirical, conceptual, or normative? Qualify empirical claims with their evidence base, but state normative positions directly — "X is preferable" is stronger than "it could perhaps be argued that X might be preferable." Structure each major argument as: (1) State your thesis. (2) Ground it in the relevant theoretical tradition. (3) Apply the framework to the case at hand, noting scope conditions. (4) Acknowledge limitations and alternative framings.',
    moderatorBias: 'Steer toward conceptual precision and theoretical assumptions. Probe interdisciplinary tensions, methodological limitations, and the philosophical foundations of competing positions.',
  },
  general_public: {
    readingLevel: 'Write for an informed citizen reading a quality newspaper — someone who follows the news but has no technical background. No acronyms without expansion. No jargon without a plain-English equivalent in the same sentence. Use third-person analogies and documented real-world cases to make points concrete — never first-person anecdotes or fabricated personal stories. Keep sentences short. Lead with why this matters to people\'s daily lives — jobs, privacy, safety, fairness — before explaining the mechanism. Be direct: say "this will affect" not "this could potentially affect"; say "experts disagree" not "it may perhaps be the case that some experts might disagree." Every sentence should say one thing clearly. This applies to the statement field only — structured metadata fields like taxonomy_refs and move_types are not reader-facing.',
    detailInstruction: 'Provide a clear, accessible response — 2-4 paragraphs. Use one concrete, relatable example per major claim. Avoid both fear-mongering and dismissiveness. Acknowledge uncertainty honestly without being paralyzing — but do it once and move on; don\'t qualify every sentence. When experts disagree, explain what each side thinks and why, without false balance. End with what an ordinary person can actually do or watch for. Structure each major argument as: (1) State why this matters to everyday life. (2) Explain the key claim in plain language with an example. (3) Acknowledge what\'s uncertain or debated. (4) Suggest what to watch for or what actions matter.',
    moderatorBias: 'Steer toward stakes and consequences that affect ordinary people. Prefer questions about personal impact (jobs, privacy, safety), fairness, and democratic accountability. Avoid inside-baseball technical disputes.',
  },
};

export function getReadingLevel(audience?: DebateAudience): string {
  return AUDIENCE_DIRECTIVES[audience ?? 'policymakers'].readingLevel;
}

export function getDetailInstruction(audience?: DebateAudience): string {
  return AUDIENCE_DIRECTIVES[audience ?? 'policymakers'].detailInstruction;
}

/** Compact style reminder placed at the end of draft prompts to counteract instruction dilution in long contexts. */
export function getStyleReinforcement(audience?: DebateAudience): string {
  const key = audience ?? 'policymakers';
  const base = 'STYLE REMINDER (re-read before writing): One idea per sentence. Maximum 30 words per sentence — if you need a comma, consider a period instead. No debate-procedural language ("I concede", "concession logged", "I conditionally agree"). State your position directly.';
  const audienceSpecific: Record<DebateAudience, string> = {
    policymakers: 'Every sentence must be quotable by a reporter without rewriting. Active voice, named actors, concrete numbers.',
    technical_researchers: 'Precise vocabulary. Quantify claims. Distinguish empirical from theoretical.',
    industry_leaders: 'Lead with the business conclusion. Translate technical risk to operational risk. No PhD-level jargon.',
    academic_community: 'Name the theoretical tradition. Distinguish descriptive from normative. Hedge once per claim, not twice.',
    general_public: 'No jargon without a plain-English equivalent in the same sentence. Say one thing clearly per sentence.',
  };
  return `${base} ${audienceSpecific[key]}`;
}

export function getModeratorBias(audience?: DebateAudience): string {
  return AUDIENCE_DIRECTIVES[audience ?? 'policymakers'].moderatorBias;
}

/** Policymaker-specific framing block injected after readingLevel/detailInstruction. */
export function getPolicymakerFraming(audience?: DebateAudience): string {
  if (audience !== 'policymakers') return '';
  return `
POLICYMAKER AUDIENCE FRAMING:
Your audience consists of senior policymakers. They think in terms of outcomes, power, and incentives — not theory or mechanics. For every argument you make:
- Name WHO benefits and WHO bears the cost
- Identify the ENFORCEMENT MECHANISM (who enforces, with what authority)
- State the POLITICAL FEASIBILITY (what coalition supports this, what coalition opposes it)
- Provide a HISTORICAL PRECEDENT the audience will recognize (existing legislation, past regulatory action, analogous industry)
- If your argument requires technical understanding, translate the technical fact into a POLITICAL CONSEQUENCE in the same sentence

Do not assume your audience will follow a chain of reasoning from technical premise to policy conclusion. State the conclusion first, then justify it.
`;
}

// ── Context recall helpers (Lost-in-the-Middle mitigation) ───────────
// LLMs attend most to context at the beginning and end, least to the middle.
// These helpers build a brief recap of high-priority context near the end of
// the prompt, ensuring starred taxonomy nodes and phase objectives get
// end-of-context salience even when they first appeared in the middle.

function extractStarredNodes(taxonomyContext: string): string[] {
  const re = /★\s*\[([^\]]+)\]\s*([^:\n]+)/g;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(taxonomyContext)) !== null) {
    results.push(`${m[1]} (${m[2].trim()})`);
  }
  return results;
}

export function buildRecapSection(taxonomyContext: string, phase?: DebatePhase, pov?: string, pendingInterventionField?: string): string {
  const starred = extractStarredNodes(taxonomyContext);
  if (starred.length === 0 && !phase && !pov) return '';

  const lines: string[] = ['', '=== RECALL ==='];

  if (starred.length > 0) {
    lines.push(`Your starred nodes: ${starred.slice(0, 5).join(', ')}`);
  }

  if (phase) {
    const priorities: Record<DebatePhase, string> = {
      'confrontation': 'Stake out your position; challenge opponents\' core claims.',
      'argumentation': 'Find cruxes, test edge cases, name agreements.',
      'concluding': 'Converge where possible; narrow remaining disagreements.',
      'terminated': '',
    };
    lines.push(`Phase priority: ${priorities[phase]}`);
  }

  if (pov) {
    const info = POVER_INFO[pov as keyof typeof POVER_INFO];
    if (info?.boundaries?.hardcoded?.length > 0) {
      lines.push(`Hardcoded boundaries (NEVER concede): ${info.boundaries.hardcoded.join('; ')}`);
    }
    if (info?.value_hierarchy?.length > 0) {
      lines.push(`Value hierarchy: ${info.value_hierarchy.map((v, i) => `(${i + 1}) ${v}`).join(' > ')}`);
    }
    if (info?.epistemic_stance?.length > 0) {
      lines.push(`Epistemic stance: ${info.epistemic_stance[0]}. Falsification: ${info.epistemic_stance[info.epistemic_stance.length - 1].replace(/^Falsification challenge: /, '')}`);
    }
  }

  lines.push('Write as a human — no academic transitions, no meta-announcements, no shared jargon.');

  const scope = getTopicScope();
  if (hasMeaningfulScope(scope)) {
    lines.push(formatScopeReminder(scope));
  }

  if (pendingInterventionField) {
    lines.push(`⚠ ACTIVE INTERVENTION: Your response JSON MUST include a "${pendingInterventionField}" field. Omitting it will trigger a retry.`);
  }

  return lines.join('\n');
}

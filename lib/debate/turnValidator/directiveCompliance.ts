// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Directive content compliance — checks the first paragraph of a statement
// against the active moderator directive.

// ── Directive content compliance ─────────────────────────────
// Checks that the first paragraph of a statement actually engages
// the moderator directive — not just that the structured field exists.

export interface DirectiveComplianceResult {
  compliant: boolean;
  repair_hint: string;
  /** Key terms from the directive that were checked. */
  directive_terms: string[];
  /** How many directive terms appeared in the first paragraph. */
  matched_terms: number;
}

const DIRECTIVE_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'and', 'but',
  'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
  'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
  'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'this',
  'that', 'these', 'those', 'it', 'its', 'my', 'your', 'his', 'her',
  'our', 'their', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him',
  'us', 'them',
]);

/**
 * Extract content words from a directive text — words likely to indicate
 * substantive engagement when present in the debater's response.
 */
function extractDirectiveTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !DIRECTIVE_STOP_WORDS.has(w));
}

/**
 * Check that the first paragraph of a statement engages a moderator directive.
 * Uses term overlap between the directive text and the first paragraph.
 * Targeted directives require ≥2 matching terms; non-targeted require ≥1.
 */
export function checkDirectiveContentCompliance(
  statement: string,
  intervention: { move: string; text?: string; directResponsePattern?: string; isTargeted?: boolean },
): DirectiveComplianceResult {
  const firstParagraph = (statement.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)[0] ?? '').toLowerCase();

  // PIN/CHALLENGE/COMMIT have specific structural patterns — check those directly
  // instead of relying on keyword overlap with the instruction text.
  if (intervention.move === 'PIN') {
    const hasAgree = /\bi\s+(dis)?agree\b|\bi\s+conditionally\s+agree\b/.test(firstParagraph);
    return hasAgree
      ? { compliant: true, repair_hint: '', directive_terms: ['agree', 'disagree', 'conditionally'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your first paragraph must begin with "I agree that...", "I disagree that...", or "I conditionally agree:...". State your position on the specific claim before proceeding to your argument.', directive_terms: ['agree', 'disagree'], matched_terms: 0 };
  }

  if (intervention.move === 'CHALLENGE') {
    const hasEvolved = /\bposition has evolved\b|\bposition is consistent\b|\bi concede\b/.test(firstParagraph);
    return hasEvolved
      ? { compliant: true, repair_hint: '', directive_terms: ['position', 'evolved', 'concede'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your first paragraph must begin with "My position has evolved...", "My position is consistent...", or "I concede... because...". Address how your position has changed or held.', directive_terms: ['position', 'evolved'], matched_terms: 0 };
  }

  if (intervention.move === 'PROBE') {
    const hasEvidence = /\bthe evidence\b|\bevidence is\b|\bdata\b|\bcitation\b|\bstud(?:y|ies)\b|\bfindings?\b|\bresearch\b|\bexample\b|\bprecedent\b|\bcase of\b|\bhistor(?:y|ical)\b|\b\d{4}\b|\bstatistic/i.test(firstParagraph);
    return hasEvidence
      ? { compliant: true, repair_hint: '', directive_terms: ['evidence', 'data', 'citation'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your first paragraph must present specific evidence — cite a data point, study, or concrete example. Begin with "The evidence is..." or lead with your citation.', directive_terms: ['evidence', 'data'], matched_terms: 0 };
  }

  // Procedural family: structural checks instead of keyword overlap (t/315)
  if (intervention.move === 'SEQUENCE') {
    const fullText = statement.toLowerCase();
    const hasNumberedSections = /(?:^|\n)\s*(?:1[\.\):]|first[,:])/m.test(fullText) && /(?:^|\n)\s*(?:2[\.\):]|second[,:])/m.test(fullText);
    const hasOnPattern = /\bon\s+(?:the\s+)?(?:sub-?topic|point|question|issue|matter|topic)\b/i.test(fullText) || /\bon\s+[a-z].*?:\s/im.test(statement);
    return (hasNumberedSections || hasOnPattern)
      ? { compliant: true, repair_hint: '', directive_terms: ['numbered', 'sections', 'sequence'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your response must use explicit numbered sections (1. On [sub-topic]: ... 2. On [sub-topic]: ...) to address the sub-topics the moderator identified. Do not write a single undifferentiated block.', directive_terms: ['numbered', 'sections'], matched_terms: 0 };
  }

  if (intervention.move === 'BALANCE') {
    const hasBalanceSignal = /\bgranting\b|\backnowledg(?:e|ing)\b|\bhowever\b|\bon the other hand\b|\bvalid point\b|\bfair\s+(?:point|critique|objection)\b|\bother\s+(?:side|perspective|view)\b|\bconcede\b|\blegitimate\b/i.test(firstParagraph);
    return hasBalanceSignal
      ? { compliant: true, repair_hint: '', directive_terms: ['acknowledge', 'perspective', 'balance'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your first paragraph must acknowledge the underrepresented perspective the moderator identified. Begin with "Granting the force of..." or "Acknowledging [opposing view]:" and genuinely engage with the perspective you have been neglecting.', directive_terms: ['acknowledge', 'perspective'], matched_terms: 0 };
  }

  if (intervention.move === 'REDIRECT') {
    const hasRedirectSignal = /\bturning to\b|\baddressing\b|\bredirect\b|\bnew direction\b|\bshift(?:ing)?\s+(?:to|focus)\b|\bmoving\s+to\b|\bas\s+the\s+moderator\b|\bper\s+the\s+moderator\b|\bmoderator'?s?\s+(?:redirect|request|point)\b/i.test(firstParagraph);
    return hasRedirectSignal
      ? { compliant: true, repair_hint: '', directive_terms: ['redirect', 'turning', 'addressing'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your first paragraph must acknowledge the moderator\'s redirect. Begin with "Turning to the moderator\'s redirect:" or "Addressing the new direction:" and signal that you are shifting to the requested topic.', directive_terms: ['redirect', 'turning'], matched_terms: 0 };
  }

  if (intervention.move === 'CRUX_FOCUS') {
    const hasCruxEngagement = /\bcrux\b|\bkey disagreement\b|\bcore disagreement\b|\bhinges on\b|\bdepends on\b|\bturns on\b|\bevidence would\b|\btradeoff\b|\btrade-off\b|\bdefine\b|\bdefinition\b|\bconditional\b|\bfalsifiable\b/i.test(firstParagraph);
    return hasCruxEngagement
      ? { compliant: true, repair_hint: '', directive_terms: ['crux', 'evidence', 'tradeoff', 'definition'], matched_terms: 1 }
      : { compliant: false, repair_hint: 'Your first paragraph must directly engage the crux — cite evidence (empirical), name the tradeoff (values), or define the contested term (definitional). Do not sidestep the moderator\'s question.', directive_terms: ['crux', 'evidence', 'tradeoff'], matched_terms: 0 };
  }

  // Fallback: keyword overlap for other intervention types
  // Prefer the moderator's actual question (text) over the response format instruction
  const directiveText = intervention.text
    ?? intervention.directResponsePattern;

  // No substantive directive text to check against — skip content compliance
  if (!directiveText) {
    return { compliant: true, repair_hint: '', directive_terms: [], matched_terms: 0 };
  }

  const directiveTerms = extractDirectiveTerms(directiveText);
  if (directiveTerms.length === 0) {
    return { compliant: true, repair_hint: '', directive_terms: [], matched_terms: 0 };
  }

  const termSet = new Set(directiveTerms);
  const firstParaWords = new Set(firstParagraph.split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')));
  const matched = [...termSet].filter(t => firstParaWords.has(t));

  const isTargeted = intervention.isTargeted !== false;
  const threshold = isTargeted ? 2 : 1;

  if (matched.length >= threshold) {
    return { compliant: true, repair_hint: '', directive_terms: directiveTerms, matched_terms: matched.length };
  }

  const hint = isTargeted
    ? `Your first paragraph does not address the moderator's ${intervention.move} directive. Rewrite paragraph 1 to directly respond to the moderator's request before continuing with your argument. The directive asked about: ${directiveTerms.slice(0, 5).join(', ')}.`
    : `Your opening does not acknowledge the moderator's ${intervention.move} directive. Add a brief acknowledgment in your first sentence.`;

  return { compliant: false, repair_hint: hint, directive_terms: directiveTerms, matched_terms: matched.length };
}

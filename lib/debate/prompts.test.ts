// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  clarificationPrompt,
  concludingPrompt,
  userSeedClaimsPrompt,
  openingStatementPrompt,
  debateResponsePrompt,
  formatCriticalQuestions,
  selectReframingMetaphor,
  crossRespondSelectionPrompt,
  crossRespondPrompt,
  briefOpeningStagePrompt,
  planOpeningStagePrompt,
  draftOpeningStagePrompt,
  citeOpeningStagePrompt,
  briefStagePrompt,
  planStagePrompt,
  draftStagePrompt,
  citeStagePrompt,
  synthExtractPrompt,
  synthMapPrompt,
  synthEvaluatePrompt,
  debateSynthesisPrompt,
  probingQuestionsPrompt,
  factCheckPrompt,
  contextCompressionPrompt,
  formatSituationDebateContext,
  documentClarificationPrompt,
  situationClarificationPrompt,
  entrySummarizationPrompt,
  missingArgumentsPrompt,
  taxonomyRefinementPrompt,
  midDebateGapPrompt,
  crossCuttingNodePrompt,
  reflectionPrompt,
  moderatorSelectionPrompt,
  moderatorInterventionPrompt,
} from './prompts.js';
import type { OpeningStagePromptInput, StagePromptInput, SituationDebateInput } from './prompts.js';

// ── Shared test fixtures ──────────────────────────────────────

const TOPIC = 'Should AI be regulated at the federal level?';
const TAXONOMY_CONTEXT = `## EMPIRICAL GROUNDING\n★ [acc-beliefs-001] Rapid Innovation\n## NORMATIVE COMMITMENTS\n[acc-desires-001] Open Development\n## REASONING APPROACH\n[acc-intentions-001] Market-Led Governance`;
const TRANSCRIPT = 'Prometheus: AI will drive growth.\nSentinel: Safety must come first.\nCassandra: Both sides oversimplify.';
const DEBATER = { label: 'Prometheus', pov: 'accelerationist', personality: 'Bold optimist' };
const ACTIVE_POVERS = ['Prometheus', 'Sentinel', 'Cassandra'];

function makeOpeningInput(overrides: Partial<OpeningStagePromptInput> = {}): OpeningStagePromptInput {
  return {
    label: DEBATER.label,
    pov: DEBATER.pov,
    personality: DEBATER.personality,
    topic: TOPIC,
    taxonomyContext: TAXONOMY_CONTEXT,
    priorStatements: '',
    isFirst: true,
    ...overrides,
  };
}

function makeStageInput(overrides: Partial<StagePromptInput> = {}): StagePromptInput {
  return {
    label: DEBATER.label,
    pov: DEBATER.pov,
    personality: DEBATER.personality,
    topic: TOPIC,
    taxonomyContext: TAXONOMY_CONTEXT,
    recentTranscript: TRANSCRIPT,
    focusPoint: 'Address the innovation vs. safety tradeoff.',
    addressing: 'Sentinel',
    ...overrides,
  };
}

function makeSituationInput(): SituationDebateInput {
  return {
    id: 'cc-001',
    label: 'AI Labor Displacement',
    description: 'AI systems replacing human jobs at scale.',
    interpretations: {
      accelerationist: 'Creative destruction drives new markets.',
      safetyist: 'Workers need protection during transition.',
      skeptic: 'Displacement estimates are overblown.',
    },
  };
}

// ── Helper: structural assertions ─────────────────────────────

/** Assert result is a non-empty string */
function expectNonEmpty(result: string): void {
  expect(typeof result).toBe('string');
  expect(result.length).toBeGreaterThan(0);
}

/** Assert result contains ALL of the given substrings */
function expectContains(result: string, ...substrings: string[]): void {
  for (const sub of substrings) {
    expect(result).toContain(sub);
  }
}

// ═══════════════════════════════════════════════════════════════
// T9: prompts.ts tests
// ═══════════════════════════════════════════════════════════════

describe('clarificationPrompt', () => {
  it('returns a non-empty string', () => {
    expectNonEmpty(clarificationPrompt(TOPIC));
  });

  it('includes the topic', () => {
    expectContains(clarificationPrompt(TOPIC), TOPIC);
  });

  it('includes JSON schema hints', () => {
    expectContains(clarificationPrompt(TOPIC), '"questions"', '"question"', '"options"');
  });

  it('incorporates source content when provided', () => {
    const result = clarificationPrompt(TOPIC, 'The paper argues AI is safe.');
    expectContains(result, 'SOURCE DOCUMENT', 'The paper argues AI is safe.');
  });

  it('includes audience reading level when audience is provided', () => {
    const result = clarificationPrompt(TOPIC, undefined, 'general_public');
    expectContains(result, 'informed citizen');
  });

  it('handles empty topic gracefully', () => {
    const result = clarificationPrompt('');
    expectNonEmpty(result);
    expectContains(result, '""');
  });
});

describe('concludingPrompt', () => {
  it('returns a non-empty string containing topic and Q&A', () => {
    const result = concludingPrompt(TOPIC, 'Q: scope? A: federal only');
    expectNonEmpty(result);
    expectContains(result, TOPIC, 'Q: scope? A: federal only', '"refined_topic"');
  });

  it('handles empty Q&A pairs', () => {
    const result = concludingPrompt(TOPIC, '');
    expectNonEmpty(result);
  });
});

describe('userSeedClaimsPrompt', () => {
  it('returns a non-empty string with JSON schema', () => {
    const result = userSeedClaimsPrompt(TOPIC, 'Q: type? A: federal');
    expectNonEmpty(result);
    expectContains(result, '"claims"', '"claim"', '"bdi_category"');
  });

  it('includes all three BDI categories in the schema description', () => {
    const result = userSeedClaimsPrompt(TOPIC, '');
    expectContains(result, 'belief', 'desire', 'intention');
  });
});

describe('openingStatementPrompt', () => {
  it('returns a non-empty string with debater identity and structural markers', () => {
    const result = openingStatementPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, '', true,
    );
    expectNonEmpty(result);
    expectContains(result, DEBATER.label, DEBATER.pov, '"statement"', '"taxonomy_refs"', '"my_claims"');
  });

  it('includes document instructions when source content is provided', () => {
    const result = openingStatementPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, '', true, 'A paper about AI risk.',
    );
    expectContains(result, 'document');
  });

  it('includes user seed claims when provided', () => {
    const result = openingStatementPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, '', true, undefined, undefined, undefined, undefined,
      [{ id: 'UC-1', text: 'AI will be beneficial' }],
    );
    expectContains(result, 'USER-STATED POSITIONS', 'UC-1', 'AI will be beneficial');
  });

  it('adjusts for non-first speaker', () => {
    const result = openingStatementPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, 'Sentinel spoke first', false,
    );
    expectContains(result, 'prior opening statements');
  });

  it('includes recall section for starred nodes', () => {
    const result = openingStatementPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, '', true,
    );
    expectContains(result, 'RECALL', 'acc-beliefs-001');
  });

  it('includes audience-specific directives', () => {
    const result = openingStatementPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, '', true, undefined, undefined, undefined, 'technical_researchers',
    );
    expectContains(result, 'senior ML researcher');
  });
});

describe('debateResponsePrompt', () => {
  it('returns a non-empty string with core structural markers', () => {
    const result = debateResponsePrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'What about safety?', 'Sentinel',
    );
    expectNonEmpty(result);
    expectContains(result, DEBATER.label, '"statement"', '"taxonomy_refs"', '"move_types"', '"my_claims"');
  });

  it('includes the question', () => {
    const result = debateResponsePrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'What about safety?', 'Sentinel',
    );
    expectContains(result, 'What about safety?');
  });

  it('supports panel-wide addressing', () => {
    const result = debateResponsePrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Q?', 'all',
    );
    expectContains(result, 'QUESTION TO THE PANEL');
  });
});

describe('formatCriticalQuestions', () => {
  it('returns a non-empty string for known schemes', () => {
    const result = formatCriticalQuestions('ARGUMENT_FROM_EVIDENCE');
    expectNonEmpty(result);
    expectContains(result, 'Critical questions', 'ARGUMENT_FROM_EVIDENCE');
  });

  it('returns empty string for unknown scheme', () => {
    expect(formatCriticalQuestions('NONEXISTENT_SCHEME')).toBe('');
  });

  it('includes numbered critical questions', () => {
    const result = formatCriticalQuestions('ARGUMENT_FROM_ANALOGY');
    expectContains(result, '1.', '2.', '3.', '4.');
  });

  it('returns a non-empty string for each valid scheme', () => {
    const schemes = [
      'ARGUMENT_FROM_EVIDENCE', 'ARGUMENT_FROM_EXPERT_OPINION',
      'ARGUMENT_FROM_PRECEDENT', 'ARGUMENT_FROM_CONSEQUENCES',
      'ARGUMENT_FROM_ANALOGY', 'PRACTICAL_REASONING',
      'ARGUMENT_FROM_DEFINITION', 'ARGUMENT_FROM_VALUES',
      'ARGUMENT_FROM_FAIRNESS', 'ARGUMENT_FROM_IGNORANCE',
      'SLIPPERY_SLOPE', 'ARGUMENT_FROM_RISK', 'ARGUMENT_FROM_METAPHOR',
    ];
    for (const s of schemes) {
      expectNonEmpty(formatCriticalQuestions(s));
    }
  });
});

describe('selectReframingMetaphor', () => {
  it('returns a metaphor object when no sources are used', () => {
    const result = selectReframingMetaphor([], 0);
    expect(result).not.toBeNull();
    expect(result!.source).toBeTruthy();
    expect(result!.prompt).toBeTruthy();
    expect(result!.reveals).toBeTruthy();
    expect(result!.challenges).toBeTruthy();
  });

  it('avoids used metaphor sources', () => {
    const result = selectReframingMetaphor(['garden', 'immune system', 'language', 'commons', 'adolescence', 'infrastructure', 'translation'], 0);
    expect(result).not.toBeNull();
    // Should pick 'ecosystem invasion' (the only one left)
    expect(result!.source).toBe('ecosystem invasion');
  });

  it('returns null when all sources are used', () => {
    const allSources = ['garden', 'immune system', 'language', 'commons', 'adolescence', 'infrastructure', 'translation', 'ecosystem invasion'];
    expect(selectReframingMetaphor(allSources, 0)).toBeNull();
  });

  it('is deterministic based on round number', () => {
    const r1 = selectReframingMetaphor([], 5);
    const r2 = selectReframingMetaphor([], 5);
    expect(r1!.source).toBe(r2!.source);
  });

  it('handles case-insensitive source matching', () => {
    const result = selectReframingMetaphor(['GARDEN', 'Immune System'], 0);
    expect(result).not.toBeNull();
    expect(result!.source).not.toBe('garden');
    expect(result!.source).not.toBe('immune system');
  });
});

describe('crossRespondSelectionPrompt', () => {
  it('returns a non-empty string with core structural markers', () => {
    const result = crossRespondSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS);
    expectNonEmpty(result);
    expectContains(result, '"responder"', '"addressing"', '"focus_point"', '"agreement_detected"');
  });

  it('includes edge context when provided', () => {
    const result = crossRespondSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, 'AN-1 attacks AN-2');
    expectContains(result, 'AN-1 attacks AN-2');
  });

  it('includes scheme section when scheme is provided', () => {
    const result = crossRespondSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', 'ARGUMENT_FROM_ANALOGY');
    expectContains(result, 'ARGUMENTATION SCHEME ANALYSIS', 'ARGUMENT_FROM_ANALOGY');
  });

  it('includes metaphor section when metaphor is provided', () => {
    const metaphor = { source: 'garden', prompt: 'What if AI is a garden?', reveals: 'ecology', challenges: 'race framing' };
    const result = crossRespondSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', undefined, metaphor);
    expectContains(result, 'METAPHOR REFRAMING', 'garden');
  });

  it('includes phase objectives for each phase', () => {
    for (const phase of ['confrontation', 'argumentation', 'concluding'] as const) {
      const result = crossRespondSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', undefined, null, phase);
      expectContains(result, 'PHASE');
    }
  });

  it('includes audience context when provided', () => {
    const result = crossRespondSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', undefined, null, undefined, 'industry_leaders');
    expectContains(result, 'AUDIENCE CONTEXT', 'industry leaders');
  });
});

describe('crossRespondPrompt', () => {
  it('returns a non-empty string with output schema', () => {
    const result = crossRespondPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Focus on evidence.', 'Sentinel',
    );
    expectNonEmpty(result);
    expectContains(result, '"statement"', '"taxonomy_refs"', '"move_types"', '"my_claims"');
  });

  it('includes move history when provided', () => {
    const result = crossRespondPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Focus.', 'Sentinel',
      undefined, undefined, undefined,
      ['DISTINGUISH', 'COUNTEREXAMPLE'],
    );
    expectContains(result, 'YOUR RECENT MOVES', 'DISTINGUISH', 'COUNTEREXAMPLE');
  });

  it('includes refs history and uncited nodes when provided', () => {
    const result = crossRespondPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Focus.', 'Sentinel',
      undefined, undefined, undefined, undefined, undefined,
      ['acc-beliefs-001', 'acc-desires-001'],
      ['acc-beliefs-002', 'acc-desires-003', 'acc-intentions-001'],
    );
    expectContains(result, 'YOUR RECENT CITATIONS', 'acc-beliefs-001');
    expectContains(result, 'NOT yet cited');
  });

  it('includes phase instructions for concluding', () => {
    const result = crossRespondPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Focus.', 'Sentinel',
      undefined, undefined, undefined, undefined, 'concluding',
    );
    expectContains(result, 'CONCLUDING', 'position_update', 'convergence');
  });

  it('includes constructive moves for argumentation/concluding phases', () => {
    for (const phase of ['argumentation', 'concluding'] as const) {
      const result = crossRespondPrompt(
        DEBATER.label, DEBATER.pov, DEBATER.personality,
        TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Focus.', 'Sentinel',
        undefined, undefined, undefined, undefined, phase,
      );
      expectContains(result, 'INTEGRATE', 'CONDITIONAL-AGREE');
    }
  });

  it('includes flagged hints when provided', () => {
    const result = crossRespondPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, TAXONOMY_CONTEXT, TRANSCRIPT, 'Focus.', 'Sentinel',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      ['Weak steelman', 'Missing evidence'],
    );
    expectContains(result, 'PRIOR TURN FEEDBACK', 'Weak steelman', 'Missing evidence');
  });
});

describe('4-stage opening pipeline', () => {
  const input = makeOpeningInput();

  describe('briefOpeningStagePrompt', () => {
    it('returns a non-empty string with JSON schema', () => {
      const result = briefOpeningStagePrompt(input);
      expectNonEmpty(result);
      expectContains(result, '"situation_assessment"', '"strongest_angles"', '"grounding"', '"key_tensions"');
    });

    it('includes prior positions schema for non-first speakers', () => {
      const result = briefOpeningStagePrompt(makeOpeningInput({ isFirst: false, priorStatements: 'Sentinel spoke.' }));
      expectContains(result, '"prior_positions_to_address"');
    });

    it('omits prior positions schema for first speakers', () => {
      const result = briefOpeningStagePrompt(input);
      expect(result).not.toContain('"prior_positions_to_address"');
    });
  });

  describe('planOpeningStagePrompt', () => {
    it('returns a non-empty string with plan schema', () => {
      const result = planOpeningStagePrompt(input, '{"brief": "test"}');
      expectNonEmpty(result);
      expectContains(result, '"strategic_goal"', '"core_thesis"', '"argument_structure"');
    });
  });

  describe('draftOpeningStagePrompt', () => {
    it('returns a non-empty string with output schema', () => {
      const result = draftOpeningStagePrompt(input, '{"brief": "test"}', '{"plan": "test"}');
      expectNonEmpty(result);
      expectContains(result, '"statement"', '"claim_sketches"', '"key_assumptions"', '"turn_symbols"');
    });

    it('includes document instructions when document analysis is present', () => {
      const inp = makeOpeningInput({
        documentAnalysis: { claims_summary: 'test', i_nodes: [], tension_points: [] },
      });
      const result = draftOpeningStagePrompt(inp, '{}', '{}');
      expectContains(result, 'pre-analyzed document');
    });
  });

  describe('citeOpeningStagePrompt', () => {
    it('returns a non-empty string with grounding schema', () => {
      const result = citeOpeningStagePrompt(input, '{}', '{}', 'draft text');
      expectNonEmpty(result);
      expectContains(result, '"taxonomy_refs"', '"policy_refs"', '"grounding_confidence"');
    });
  });
});

describe('4-stage turn pipeline', () => {
  const input = makeStageInput();

  describe('briefStagePrompt', () => {
    it('returns a non-empty string with situation brief schema', () => {
      const result = briefStagePrompt(input);
      expectNonEmpty(result);
      expectContains(result, '"situation_assessment"', '"key_claims_to_address"', '"grounding"');
    });

    it('includes phase instructions when phase is set', () => {
      const result = briefStagePrompt(makeStageInput({ phase: 'argumentation' }));
      expectContains(result, 'EXPLORATION');
    });
  });

  describe('planStagePrompt', () => {
    it('returns a non-empty string with plan schema', () => {
      const result = planStagePrompt(input, '{}');
      expectNonEmpty(result);
      expectContains(result, '"strategic_goal"', '"planned_moves"', '"argument_sketch"');
    });

    it('includes move history when provided', () => {
      const result = planStagePrompt(makeStageInput({ priorMoves: ['DISTINGUISH', 'EXTEND'] }), '{}');
      expectContains(result, 'YOUR RECENT MOVES', 'DISTINGUISH');
    });

    it('includes phase context when provided', () => {
      const result = planStagePrompt(
        makeStageInput({ phaseContext: { rationale: 'Moving to concluding', phase_progress: 0.8, approaching_transition: true } }),
        '{}',
      );
      expectContains(result, 'PHASE STATUS', '80%', 'Approaching phase transition');
    });
  });

  describe('draftStagePrompt', () => {
    it('returns a non-empty string with output schema', () => {
      const result = draftStagePrompt(input, '{}', '{}');
      expectNonEmpty(result);
      expectContains(result, '"statement"', '"claim_sketches"', '"turn_symbols"');
    });

    it('includes position_update for concluding phase', () => {
      const result = draftStagePrompt(makeStageInput({ phase: 'concluding' }), '{}', '{}');
      expectContains(result, '"position_update"');
    });

    it('omits position_update for non-concluding phases', () => {
      const result = draftStagePrompt(makeStageInput({ phase: 'argumentation' }), '{}', '{}');
      expect(result).not.toContain('"position_update"');
    });

    it('includes intervention block when targeted intervention is pending', () => {
      const result = draftStagePrompt(
        makeStageInput({
          pendingIntervention: {
            move: 'PIN',
            family: 'Elicitation',
            targetDebater: 'Prometheus',
            directResponsePattern: 'Do you agree with X?',
            isTargeted: true,
          },
        }),
        '{}',
        '{}',
      );
      expectContains(result, 'MODERATOR DIRECTIVE', 'YOU MUST RESPOND DIRECTLY', 'Do you agree with X?');
    });

    it('includes non-targeted intervention block when intervention targets another debater', () => {
      const result = draftStagePrompt(
        makeStageInput({
          pendingIntervention: {
            move: 'REDIRECT',
            family: 'Procedural',
            targetDebater: 'Sentinel',
            isTargeted: false,
          },
        }),
        '{}',
        '{}',
      );
      expectContains(result, 'DIRECTED AT SENTINEL');
    });
  });

  describe('citeStagePrompt', () => {
    it('returns a non-empty string with annotation schema', () => {
      const result = citeStagePrompt(input, '{}', '{}', 'draft');
      expectNonEmpty(result);
      expectContains(result, '"taxonomy_refs"', '"move_annotations"', '"grounding_confidence"');
    });

    it('includes refs history block when priorRefs are provided', () => {
      const result = citeStagePrompt(
        makeStageInput({ priorRefs: ['acc-beliefs-001'], availablePovNodeIds: ['acc-beliefs-002', 'acc-desires-001'] }),
        '{}',
        '{}',
        'draft',
      );
      expectContains(result, 'RECENT CITATIONS', 'acc-beliefs-001', 'NOT yet cited');
    });
  });
});

describe('synthesis prompts', () => {
  describe('synthExtractPrompt', () => {
    it('returns a non-empty string with extraction schema', () => {
      const result = synthExtractPrompt(TOPIC, TRANSCRIPT);
      expectNonEmpty(result);
      expectContains(result, '"areas_of_agreement"', '"areas_of_disagreement"', '"cruxes"', '"unresolved_questions"');
    });

    it('includes crux resolution context when provided', () => {
      const result = synthExtractPrompt(TOPIC, TRANSCRIPT, undefined, 'Crux 1 is resolved.');
      expectContains(result, 'CRUX RESOLUTION STATUS', 'Crux 1 is resolved');
    });
  });

  describe('synthMapPrompt', () => {
    it('returns a non-empty string with argument map schema', () => {
      const result = synthMapPrompt(TOPIC, TRANSCRIPT, '[]');
      expectNonEmpty(result);
      expectContains(result, '"argument_map"', '"taxonomy_proposals"', '"taxonomy_modifications"');
    });

    it('includes document claims schema when hasSourceDocument is true', () => {
      const result = synthMapPrompt(TOPIC, TRANSCRIPT, '[]', true);
      expectContains(result, '"document_claims"');
    });

    it('omits document claims schema when hasSourceDocument is false', () => {
      const result = synthMapPrompt(TOPIC, TRANSCRIPT, '[]', false);
      expect(result).not.toContain('"document_claims"');
    });
  });

  describe('synthEvaluatePrompt', () => {
    it('returns a non-empty string with evaluation schema', () => {
      const result = synthEvaluatePrompt(TOPIC, '[]', '[]');
      expectNonEmpty(result);
      expectContains(result, '"preferences"', '"policy_implications"');
    });
  });

  describe('debateSynthesisPrompt (deprecated)', () => {
    it('returns a non-empty string with comprehensive schema', () => {
      const result = debateSynthesisPrompt(TOPIC, TRANSCRIPT);
      expectNonEmpty(result);
      expectContains(
        result,
        '"areas_of_agreement"', '"areas_of_disagreement"',
        '"cruxes"', '"argument_map"', '"preferences"', '"policy_implications"',
      );
    });
  });
});

describe('probingQuestionsPrompt', () => {
  it('returns a non-empty string with questions schema', () => {
    const result = probingQuestionsPrompt(TOPIC, TRANSCRIPT, []);
    expectNonEmpty(result);
    expectContains(result, '"questions"', '"text"', '"targets"', '"threatens"');
  });

  it('includes unreferenced nodes when provided', () => {
    const result = probingQuestionsPrompt(TOPIC, TRANSCRIPT, ['[acc-beliefs-005] AI Capability Growth']);
    expectContains(result, 'TAXONOMY NODES NOT YET REFERENCED', 'acc-beliefs-005');
  });

  it('includes uncovered document claims when provided', () => {
    const result = probingQuestionsPrompt(TOPIC, TRANSCRIPT, [], true, ['D-1: AI needs oversight']);
    expectContains(result, 'UNCOVERED DOCUMENT CLAIMS', 'D-1: AI needs oversight');
  });

  it('handles empty unreferenced nodes and no uncovered claims', () => {
    const result = probingQuestionsPrompt(TOPIC, TRANSCRIPT, []);
    expect(result).not.toContain('TAXONOMY NODES NOT YET REFERENCED');
  });
});

describe('factCheckPrompt', () => {
  it('returns a non-empty string with verdict schema', () => {
    const result = factCheckPrompt('AI is safe', 'full statement', 'taxonomy nodes', '');
    expectNonEmpty(result);
    expectContains(result, '"verdict"', '"explanation"', '"points"', 'supported', 'disputed', 'false');
  });

  it('includes conflict data when provided', () => {
    const result = factCheckPrompt('claim', 'context', 'nodes', 'Conflict: study shows otherwise');
    expectContains(result, 'Conflict: study shows otherwise');
  });

  it('handles empty conflict data gracefully', () => {
    const result = factCheckPrompt('claim', 'context', 'nodes', '');
    expectContains(result, 'No relevant conflicts');
  });
});

describe('contextCompressionPrompt', () => {
  it('returns a non-empty string with summary schema', () => {
    const result = contextCompressionPrompt('Some debate entries.');
    expectNonEmpty(result);
    expectContains(result, '"summary"', 'Preserve');
  });
});

describe('formatSituationDebateContext', () => {
  it('returns a non-empty string with situation structure', () => {
    const result = formatSituationDebateContext(makeSituationInput());
    expectNonEmpty(result);
    expectContains(result, 'cc-001', 'AI Labor Displacement', 'SITUATION', 'POV INTERPRETATIONS');
  });

  it('includes optional sections when provided', () => {
    const cc = makeSituationInput();
    cc.assumes = ['Technology is neutral'];
    cc.steelmanVulnerability = 'Ignores structural power';
    cc.possibleFallacies = [{ fallacy: 'false_dilemma', confidence: 'high', explanation: 'Binary framing' }];
    cc.linkedNodeDescriptions = ['acc-beliefs-001: Innovation drives growth'];
    cc.conflictSummaries = ['Study A vs Study B on displacement'];

    const result = formatSituationDebateContext(cc);
    expectContains(
      result,
      'UNDERLYING ASSUMPTIONS', 'Technology is neutral',
      'STEELMAN VULNERABILITY', 'Ignores structural power',
      'IDENTIFIED FALLACIES', 'false dilemma',
      'LINKED TAXONOMY NODES',
      'DOCUMENTED CONFLICTS',
    );
  });

  it('omits optional sections when not provided', () => {
    const result = formatSituationDebateContext(makeSituationInput());
    expect(result).not.toContain('UNDERLYING ASSUMPTIONS');
    expect(result).not.toContain('STEELMAN VULNERABILITY');
    expect(result).not.toContain('IDENTIFIED FALLACIES');
  });
});

describe('documentClarificationPrompt', () => {
  it('returns a non-empty string with topic and source doc', () => {
    const result = documentClarificationPrompt(TOPIC, 'The paper says...');
    expectNonEmpty(result);
    expectContains(result, TOPIC, 'SOURCE DOCUMENT', '"questions"');
  });

  it('truncates very long source content', () => {
    const longContent = 'x'.repeat(60000);
    const result = documentClarificationPrompt(TOPIC, longContent);
    expectContains(result, 'truncated');
  });
});

describe('situationClarificationPrompt', () => {
  it('returns a non-empty string with topic and context', () => {
    const result = situationClarificationPrompt(TOPIC, 'cc context here');
    expectNonEmpty(result);
    expectContains(result, TOPIC, 'cc context here', '"questions"');
  });
});

describe('entrySummarizationPrompt', () => {
  it('returns a non-empty string with compression levels', () => {
    const result = entrySummarizationPrompt('AI will transform everything.', 'Prometheus');
    expectNonEmpty(result);
    expectContains(result, '"brief"', '"medium"', 'Prometheus', 'BRIEF', 'MEDIUM');
  });

  it('includes the statement text', () => {
    const result = entrySummarizationPrompt('Regulation stifles innovation.', 'Prometheus');
    expectContains(result, 'Regulation stifles innovation.');
  });
});

describe('missingArgumentsPrompt', () => {
  it('returns a non-empty string with missing arguments schema', () => {
    const result = missingArgumentsPrompt(TOPIC, 'taxonomy summary', 'synthesis text');
    expectNonEmpty(result);
    expectContains(result, '"missing_arguments"', '"argument"', '"side"', '"why_strong"', '"bdi_layer"');
  });
});

describe('taxonomyRefinementPrompt', () => {
  it('returns a non-empty string with taxonomy suggestions schema', () => {
    const result = taxonomyRefinementPrompt(TOPIC, 'concluding', [
      { id: 'acc-beliefs-001', label: 'Innovation', pov: 'accelerationist', category: 'Beliefs', description: 'desc' },
    ], 'arg map summary');
    expectNonEmpty(result);
    expectContains(result, '"taxonomy_suggestions"', '"suggestion_type"', '"proposed_description"');
  });

  it('includes all referenced nodes in the prompt', () => {
    const nodes = [
      { id: 'acc-beliefs-001', label: 'Innovation', pov: 'accelerationist', category: 'Beliefs', description: 'innovation desc' },
      { id: 'saf-desires-001', label: 'Safety', pov: 'safetyist', category: 'Desires', description: 'safety desc' },
    ];
    const result = taxonomyRefinementPrompt(TOPIC, 'synth', nodes, 'map');
    expectContains(result, 'acc-beliefs-001', 'saf-desires-001', 'innovation desc', 'safety desc');
  });
});

describe('midDebateGapPrompt', () => {
  it('returns a non-empty string with gap arguments schema', () => {
    const result = midDebateGapPrompt(TOPIC, TRANSCRIPT, 'taxonomy summary', ['arg1', 'arg2']);
    expectNonEmpty(result);
    expectContains(result, '"gap_arguments"', '"argument"', '"why_missing"', '"gap_type"');
  });

  it('includes focus nodes when provided', () => {
    const result = midDebateGapPrompt(TOPIC, TRANSCRIPT, 'taxonomy', [], [
      { id: 'acc-beliefs-005', label: 'Test Node', description: 'Test description for the node' },
    ]);
    expectContains(result, 'UNENGAGED HIGH-RELEVANCE NODES', 'acc-beliefs-005', 'Test Node');
  });

  it('handles empty arguments list', () => {
    const result = midDebateGapPrompt(TOPIC, TRANSCRIPT, 'taxonomy', []);
    expectContains(result, 'none extracted yet');
  });
});

describe('crossCuttingNodePrompt', () => {
  it('returns a non-empty string with proposals schema', () => {
    const result = crossCuttingNodePrompt(
      [{ point: 'AI needs oversight', povers: ['prometheus', 'sentinel', 'cassandra'] }],
      ['Existing Situation'],
      TOPIC,
    );
    expectNonEmpty(result);
    expectContains(result, '"proposals"', '"proposed_label"', '"interpretations"');
  });

  it('includes existing situation labels', () => {
    const result = crossCuttingNodePrompt(
      [{ point: 'AI needs oversight', povers: ['prometheus', 'sentinel'] }],
      ['AI Labor Displacement', 'Algorithmic Bias'],
      TOPIC,
    );
    expectContains(result, 'AI Labor Displacement', 'Algorithmic Bias');
  });

  it('handles empty existing labels', () => {
    const result = crossCuttingNodePrompt(
      [{ point: 'AI needs oversight', povers: ['prometheus'] }],
      [],
      TOPIC,
    );
    expectContains(result, '(none)');
  });
});

describe('reflectionPrompt', () => {
  it('returns a non-empty string with reflection schema', () => {
    const result = reflectionPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC,
      [{ id: 'acc-beliefs-001', category: 'Beliefs', label: 'Innovation', description: 'desc' }],
      TRANSCRIPT,
    );
    expectNonEmpty(result);
    expectContains(result, '"reflection_summary"', '"edits"', '"edit_type"', '"proposed_description"');
  });

  it('includes optional argument network context', () => {
    const result = reflectionPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, [], TRANSCRIPT, 'AN-1 attacks AN-2',
    );
    expectContains(result, 'ARGUMENT NETWORK', 'AN-1 attacks AN-2');
  });

  it('includes optional commitment store context', () => {
    const result = reflectionPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, [], TRANSCRIPT, undefined, 'Asserted: X, Conceded: Y',
    );
    expectContains(result, 'COMMITMENT STORE', 'Asserted: X, Conceded: Y');
  });

  it('includes optional convergence signals context', () => {
    const result = reflectionPrompt(
      DEBATER.label, DEBATER.pov, DEBATER.personality,
      TOPIC, [], TRANSCRIPT, undefined, undefined, 'High convergence at 0.85',
    );
    expectContains(result, 'CONVERGENCE SIGNALS', 'High convergence at 0.85');
  });
});

describe('moderatorSelectionPrompt', () => {
  it('returns a non-empty string with selection schema', () => {
    const result = moderatorSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', 'trigger context');
    expectNonEmpty(result);
    expectContains(result, '"responder"', '"intervene"', '"suggested_move"', '"drift_detected"');
  });

  it('includes semantic drift detection section', () => {
    const result = moderatorSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', '');
    expectContains(result, 'SEMANTIC DRIFT DETECTION', 'METAPHOR LITERALIZATION', 'IMPLEMENTATION SPIRAL', 'SCOPE CREEP');
  });

  it('includes source document anchor when provided', () => {
    const result = moderatorSelectionPrompt(TRANSCRIPT, ACTIVE_POVERS, '', '', undefined, undefined, undefined, undefined, 'Paper summary');
    expectContains(result, 'SOURCE DOCUMENT ANCHOR', 'Paper summary');
  });
});

describe('moderatorInterventionPrompt', () => {
  it('returns a non-empty string with text schema', () => {
    const result = moderatorInterventionPrompt(
      'PIN', 'Elicitation', 'Prometheus', 'Evasion detected', 'Claim X', TRANSCRIPT,
    );
    expectNonEmpty(result);
    expectContains(result, '"text"', 'PIN', 'Elicitation', 'Prometheus');
  });

  it('includes REVOICE-specific schema when move is REVOICE', () => {
    const result = moderatorInterventionPrompt(
      'REVOICE', 'Reconciliation', 'Sentinel', 'Jargon', undefined, TRANSCRIPT,
    );
    expectContains(result, '"original_claim_text"');
  });

  it('includes move-specific instructions for each move type', () => {
    const moves = ['REDIRECT', 'BALANCE', 'SEQUENCE', 'PIN', 'PROBE', 'CHALLENGE', 'CLARIFY', 'CHECK', 'SUMMARIZE', 'ACKNOWLEDGE', 'REVOICE', 'META-REFLECT', 'COMPRESS', 'COMMIT'] as const;
    for (const move of moves) {
      const result = moderatorInterventionPrompt(move, 'Procedural', 'Prometheus', 'reason', undefined, TRANSCRIPT);
      expectNonEmpty(result);
    }
  });
});

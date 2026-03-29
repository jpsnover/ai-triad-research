// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Debate protocol definitions — declarative configurations for different debate formats.
 */

export interface ProtocolAction {
  id: string;
  label: string;
  requiresInput: boolean;
  handler: string; // Maps to store action name
  tooltip: string;
}

export interface ProtocolPhase {
  id: string;
  label: string;
  actions: ProtocolAction[];
}

export interface DebateProtocol {
  id: string;
  label: string;
  description: string;
  phases: Record<string, ProtocolPhase>;
  defaultRounds: number;
}

export const DEBATE_PROTOCOLS: DebateProtocol[] = [
  {
    id: 'structured',
    label: 'Structured Debate',
    description: 'Standard multi-perspective debate: clarification, opening statements, moderated cross-respond rounds, synthesis.',
    defaultRounds: 3,
    phases: {
      clarification: {
        id: 'clarification',
        label: 'Clarification',
        actions: [], // Handled by ClarificationActions component
      },
      opening: {
        id: 'opening',
        label: 'Opening Statements',
        actions: [], // Handled by OpeningActions component
      },
      debate: {
        id: 'debate',
        label: 'Debate',
        actions: [
          { id: 'ask', label: 'Ask', requiresInput: true, handler: 'askQuestion', tooltip: 'Ask a question to the panel or a specific debater' },
          { id: 'cross_respond', label: 'Cross-Respond', requiresInput: false, handler: 'crossRespond', tooltip: 'Have the debaters respond to each other' },
          { id: 'synthesize', label: 'Synthesize', requiresInput: false, handler: 'requestSynthesis', tooltip: 'Generate a synthesis of agreements, disagreements, and open questions' },
          { id: 'probe', label: 'Probe', requiresInput: false, handler: 'requestProbingQuestions', tooltip: 'Get AI-suggested probing questions to deepen the debate' },
          { id: 'harvest', label: 'Harvest', requiresInput: false, handler: 'harvest', tooltip: 'Harvest debate findings into the taxonomy' },
        ],
      },
    },
  },
  {
    id: 'socratic',
    label: 'Socratic Dialogue',
    description: 'User asks questions, one AI debater responds at a time. Moderator probes for contradictions and deeper reasoning. Best for exploring a single POV.',
    defaultRounds: 5,
    phases: {
      clarification: {
        id: 'clarification',
        label: 'Topic Setup',
        actions: [],
      },
      opening: {
        id: 'opening',
        label: 'Opening Position',
        actions: [],
      },
      debate: {
        id: 'debate',
        label: 'Dialogue',
        actions: [
          { id: 'ask', label: 'Ask', requiresInput: true, handler: 'askQuestion', tooltip: 'Ask a question — the selected debater responds' },
          { id: 'probe', label: 'Probe', requiresInput: false, handler: 'requestProbingQuestions', tooltip: 'Moderator suggests questions that test the reasoning' },
          { id: 'synthesize', label: 'Summarize', requiresInput: false, handler: 'requestSynthesis', tooltip: 'Summarize what has been established so far' },
          { id: 'harvest', label: 'Harvest', requiresInput: false, handler: 'harvest', tooltip: 'Harvest findings into the taxonomy' },
        ],
      },
    },
  },
  {
    id: 'deliberation',
    label: 'Deliberation',
    description: 'All participants seek consensus. Moderator identifies convergence points and pushes for agreement. Synthesis focuses on areas of agreement.',
    defaultRounds: 4,
    phases: {
      clarification: {
        id: 'clarification',
        label: 'Framing',
        actions: [],
      },
      opening: {
        id: 'opening',
        label: 'Initial Positions',
        actions: [],
      },
      debate: {
        id: 'debate',
        label: 'Deliberation',
        actions: [
          { id: 'ask', label: 'Propose', requiresInput: true, handler: 'askQuestion', tooltip: 'Propose a point for the group to consider' },
          { id: 'cross_respond', label: 'Respond', requiresInput: false, handler: 'crossRespond', tooltip: 'Moderator selects who responds to find common ground' },
          { id: 'synthesize', label: 'Consensus Check', requiresInput: false, handler: 'requestSynthesis', tooltip: 'Check what the group agrees on so far' },
          { id: 'harvest', label: 'Harvest', requiresInput: false, handler: 'harvest', tooltip: 'Harvest findings into the taxonomy' },
        ],
      },
    },
  },
];

export function getProtocol(id: string): DebateProtocol {
  return DEBATE_PROTOCOLS.find(p => p.id === id) || DEBATE_PROTOCOLS[0];
}

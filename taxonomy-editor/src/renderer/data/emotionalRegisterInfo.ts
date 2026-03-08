// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Descriptions of emotional registers used in taxonomy graph attributes.
// Source: docs/emotional-registers.md

import type { AttributeInfo } from './epistemicTypeInfo';

export const EMOTIONAL_REGISTERS: Record<string, AttributeInfo> = {
  pragmatic: {
    label: 'Pragmatic',
    summary:
      'Level-headed and solution-focused. The position presents itself as practical, grounded, and unswayed by hype or alarm. It channels the energy of "let\'s just figure out what works" and avoids both enthusiasm and dread.',
    example:
      'Positions that weigh trade-offs, propose incremental changes, or focus on engineering constraints rather than grand narratives.',
    frequency:
      'Most common register (34 nodes). Evenly spread across safetyist (11), accelerationist (10), and skeptic (9) \u2014 pragmatism is a universal rhetorical posture.',
  },
  cautionary: {
    label: 'Cautionary',
    summary:
      'Careful and warning-oriented. The position raises concerns without panic. It signals that something deserves attention and vigilance, using measured language to convey risk. The tone is "we should be careful" rather than "we\'re doomed."',
    example:
      'Positions that highlight potential failure modes, unintended consequences, or gaps in current safeguards, while maintaining composure.',
    frequency:
      '29 nodes. Heavily safetyist (15) and cross-cutting (11), reflecting these POVs\' orientation toward identifying risks without alarmism.',
  },
  urgent: {
    label: 'Urgent',
    summary:
      'Time-pressured and action-demanding. The position conveys that the window for action is closing, that delay is dangerous, or that the stakes demand immediate response. It creates a sense of "we must act now."',
    example:
      'Positions that invoke timelines, tipping points, competitive pressures, or irreversible consequences to motivate swift action.',
    frequency:
      '25 nodes. Most common in safetyist (9) and accelerationist (7) \u2014 both sides invoke urgency, just for different reasons.',
  },
  optimistic: {
    label: 'Optimistic',
    summary:
      'Confident and forward-looking. The position radiates belief that things will turn out well, that progress is real, and that challenges are solvable. It energizes rather than warns.',
    example:
      'Positions that celebrate AI capabilities, envision positive futures, or express confidence in human ingenuity to manage risks.',
    frequency:
      '19 nodes. Overwhelmingly accelerationist (15 of 19), making optimism the defining emotional signature of that POV.',
  },
  alarmed: {
    label: 'Alarmed',
    summary:
      'Distressed and warning of danger. The position conveys fear, concern, or distress about imminent or catastrophic risks. Stronger than cautionary \u2014 it says "this is genuinely dangerous" rather than "we should be careful."',
    example:
      'Positions that describe existential risks, catastrophic failure scenarios, or irreversible harms with emotional force.',
    frequency:
      '18 nodes. Concentrated in safetyist (11) and cross-cutting (4), where the stakes of failure are emphasized most strongly.',
  },
  aspirational: {
    label: 'Aspirational',
    summary:
      'Visionary and goal-oriented. The position paints a picture of what could be achieved, appealing to shared hopes and ideals. It pulls the audience toward a desired future rather than pushing them away from a feared one.',
    example:
      'Positions that envision AI-powered abundance, cured diseases, democratized knowledge, or expanded human potential.',
    frequency:
      '13 nodes. Most common in accelerationist (6) and cross-cutting (3) contexts, where grand visions of AI\'s potential are central.',
  },
  measured: {
    label: 'Measured',
    summary:
      'Balanced and deliberate. The position maintains neutrality, presenting multiple sides without strong emotional coloring. It prioritizes analytical distance over persuasion. The tone is "here are the considerations" rather than advocating for any particular reaction.',
    example:
      'Positions that survey the landscape, compare perspectives, or present evidence without pushing toward a specific emotional response.',
    frequency:
      '13 nodes. Most common in cross-cutting (5) contexts, which by nature straddle multiple viewpoints and resist emotional commitment to any one.',
  },
  defiant: {
    label: 'Defiant',
    summary:
      'Combative and resistant. The position pushes back against perceived opponents, orthodoxies, or institutional pressures. It carries the energy of "we refuse to accept this" and positions itself against a dominant narrative or power structure.',
    example:
      'Positions that reject regulatory overreach, challenge safety orthodoxy, or resist calls to slow down, with a confrontational edge.',
    frequency:
      '9 nodes. Concentrated in accelerationist (7), where defiance against regulation and caution is a recurring posture. Skeptics contribute 2 nodes.',
  },
  dismissive: {
    label: 'Dismissive',
    summary:
      'Minimizing and unimpressed. The position treats opposing views as unworthy of serious engagement. It conveys "this isn\'t worth worrying about" or "these concerns are overblown." Weaker engagement than defiance \u2014 it ignores rather than fights.',
    example:
      'Positions that characterize safety concerns as sci-fi fantasies, or dismiss accelerationist claims as uninformed hype.',
    frequency:
      'Rare (3 nodes). Appears in accelerationist (2) and skeptic (1) contexts.',
  },
};

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression test for socratic per-turn stepping (t/2516). In a socratic + step-mode run,
// one user question must produce exactly ONE AI response (then pause for the next question),
// instead of every respondingPover auto-running in a single askQuestion call.
// Import the harness FIRST so its hoisted mocks register before the store graph is imported.
import { describe, it, expect } from 'vitest';
import { mockApi, makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

describe('askQuestion — socratic step mode (t/2516)', () => {
  const povResponse = JSON.stringify({
    statement: 'A short response from the speaker for testing.',
    taxonomy_refs: [], policy_refs: [], my_claims: [],
  });

  function setup(overrides: Record<string, unknown>) {
    const session = makeSession({
      phase: 'debate',
      active_povers: ['accelerationist', 'safetyist', 'skeptic'],
      ...overrides,
    });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
    });
    mockApi.generateText.mockResolvedValue({ text: povResponse });
  }

  function statementCount(): number {
    return (useDebateStore.getState().activeDebate?.transcript ?? []).filter((e) => e.type === 'statement').length;
  }

  it('produces exactly one AI response per question in socratic + step_mode', async () => {
    setup({ protocol_id: 'socratic', adaptive_staging: { enabled: true, step_mode: true } });
    await useDebateStore.getState().askQuestion('What about X?');
    // No @-mention → all three AI povers would respond without the break; step mode stops at one.
    expect(statementCount()).toBe(1);
  });

  it('produces all responders when step_mode is off (control — proves the guard is the cause)', async () => {
    setup({ protocol_id: 'socratic', adaptive_staging: { enabled: true, step_mode: false } });
    await useDebateStore.getState().askQuestion('What about X?');
    expect(statementCount()).toBe(3);
  });

  it('produces all responders for a non-socratic protocol even with step_mode on', async () => {
    setup({ protocol_id: 'structured', adaptive_staging: { enabled: true, step_mode: true } });
    await useDebateStore.getState().askQuestion('What about X?');
    expect(statementCount()).toBe(3);
  });
});

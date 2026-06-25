// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { POVER_INFO } from '../../types/debate';

export function OpeningActions() {
  const { activeDebate, debateGenerating, debateError, submitUserOpening, runOpeningStatements, setError } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError, submitUserOpening: s.submitUserOpening, runOpeningStatements: s.runOpeningStatements, setError: s.setError }))
  );
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const userIsPover = activeDebate.user_is_pover;
  const hasUserOpening = activeDebate.transcript.some(
    (e) => e.type === 'opening' && e.speaker === 'user',
  );

  if (isGenerating) {
    return (
      <div className="debate-action-bar">
        {debateError && (
          <div className="debate-error">
            <span className="debate-error-text">{debateError}</span>
            <button className="debate-error-dismiss" onClick={() => setError(null)} title="Dismiss">&times;</button>
          </div>
        )}
        <div className="debate-action-hint">Delivering opening statements...</div>
      </div>
    );
  }

  if (userIsPover && !hasUserOpening) {
    const handleSubmit = async () => {
      if (!statement.trim() || submitting) return;
      setSubmitting(true);
      await submitUserOpening(statement.trim());
      setStatement('');
      setSubmitting(false);
    };

    return (
      <div className="debate-action-bar">
        {debateError && (
          <div className="debate-error">
            <span className="debate-error-text">{debateError}</span>
            <button className="debate-error-retry" onClick={() => { setError(null); void runOpeningStatements(); }}>Retry</button>
            <button className="debate-error-dismiss" onClick={() => setError(null)} title="Dismiss">&times;</button>
          </div>
        )}
        <div className="debate-action-hint">It's your turn. Deliver your opening statement.</div>
        <div className="debate-clarification-input">
          <textarea
            className="debate-answer-textarea"
            placeholder="Your opening statement..."
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={4}
            autoFocus
          />
          <div className="debate-clarification-buttons">
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!statement.trim() || submitting}
            >
              {submitting ? 'Submitting...' : 'Deliver Opening Statement'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const aiPoversExpected = (activeDebate.active_povers ?? []).filter(p => p !== 'user');
  const aiPoversWithOpening = activeDebate.transcript
    .filter(e => e.type === 'opening' && e.speaker !== 'user')
    .map(e => e.speaker);
  const missingPovers = aiPoversExpected.filter(p => !aiPoversWithOpening.includes(p));

  if (missingPovers.length > 0) {
    return (
      <div className="debate-action-bar">
        {debateError && (
          <div className="debate-error">
            <span className="debate-error-text">{debateError}</span>
            <button className="debate-error-retry" onClick={() => { setError(null); void runOpeningStatements(); }}>Retry</button>
            <button className="debate-error-dismiss" onClick={() => setError(null)} title="Dismiss">&times;</button>
          </div>
        )}
        <div className="debate-action-hint">
          {missingPovers.length === 1
            ? `${POVER_INFO[missingPovers[0] as keyof typeof POVER_INFO]?.label ?? missingPovers[0]} still needs to deliver an opening statement.`
            : `${missingPovers.length} debaters still need to deliver opening statements.`}
        </div>
        <div className="debate-action-bar-inner">
          <button className="btn btn-primary" onClick={() => void runOpeningStatements()}>
            Resume Opening Statements
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="debate-action-bar">
      <div className="debate-action-hint">Opening statements complete.</div>
    </div>
  );
}

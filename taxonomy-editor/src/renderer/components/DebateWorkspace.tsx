// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId, TranscriptEntry } from '../types/debate';

const PHASE_TITLES: Record<string, string> = {
  setup: 'Setting up...',
  clarification: 'Topic Refinement',
  opening: 'Opening Statements',
  debate: 'Debate',
  closed: 'Debate Closed',
};

function speakerLabel(speaker: PoverId | 'system'): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'user') return 'You';
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info ? info.label : speaker;
}

function speakerColor(speaker: PoverId | 'system'): string | undefined {
  if (speaker === 'system' || speaker === 'user') return undefined;
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info?.color;
}

/** Shows LLM activity, model, and retry info during generation */
function ProgressIndicator() {
  const { debateActivity, debateProgress } = useDebateStore();

  if (!debateActivity) return null;

  return (
    <div className="debate-progress-indicator">
      <span className="debate-progress-activity">{debateActivity}</span>
      {debateProgress && debateProgress.attempt > 1 && (
        <span className="debate-progress-retry">
          Retry {debateProgress.attempt}/{debateProgress.maxRetries}
          {debateProgress.backoffSeconds ? ` (waiting ${debateProgress.backoffSeconds}s)` : ''}
        </span>
      )}
      {debateProgress?.limitMessage && (
        <span className="debate-progress-limit">{debateProgress.limitMessage}</span>
      )}
    </div>
  );
}

function StatementCard({ entry }: { entry: TranscriptEntry }) {
  const color = speakerColor(entry.speaker);
  return (
    <div className={`debate-statement debate-speaker-${entry.speaker} debate-type-${entry.type}`}>
      <div className="debate-statement-header">
        <span className="debate-statement-speaker" style={color ? { color } : undefined}>
          {speakerLabel(entry.speaker)}
        </span>
        <span className="debate-statement-type">{entry.type}</span>
      </div>
      <div className="debate-statement-content">{entry.content}</div>
      {entry.taxonomy_refs.length > 0 && (
        <div className="debate-taxonomy-refs">
          {entry.taxonomy_refs.map((ref) => (
            <span key={ref.node_id} className="debate-taxonomy-pill" title={ref.relevance}>
              {ref.node_id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Clarification phase action bar */
function ClarificationActions() {
  const {
    activeDebate, debateGenerating, debateError,
    submitAnswersAndSynthesize, runClarification, beginDebate,
  } = useDebateStore();
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const hasClarifications = activeDebate.transcript.some((e) => e.type === 'clarification');
  const hasAnswers = activeDebate.transcript.some((e) => e.type === 'answer');
  const hasRefinedTopic = activeDebate.topic.refined !== null;

  const handleSubmitAnswers = async () => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    await submitAnswersAndSynthesize(answer.trim());
    setAnswer('');
    setSubmitting(false);
  };

  const handleAnotherRound = async () => {
    setSubmitting(true);
    await runClarification();
    setSubmitting(false);
  };

  const handleBeginDebate = async () => {
    await beginDebate();
  };

  const isGenerating = !!debateGenerating;

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}

      {!hasClarifications && isGenerating && (
        <div className="debate-action-hint">Generating clarifying questions...</div>
      )}

      {hasClarifications && !hasAnswers && !hasRefinedTopic && (
        <>
          <div className="debate-action-hint">Answer their questions to sharpen the topic, or skip ahead.</div>
          <div className="debate-clarification-input">
            <textarea
              className="debate-answer-textarea"
              placeholder="Your answers..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              disabled={isGenerating || submitting}
            />
            <div className="debate-clarification-buttons">
              <button
                className="btn btn-primary"
                onClick={handleSubmitAnswers}
                disabled={!answer.trim() || isGenerating || submitting}
              >
                {submitting ? 'Synthesizing...' : 'Submit Answers'}
              </button>
              <button
                className="btn"
                onClick={handleBeginDebate}
                disabled={isGenerating || submitting}
              >
                Skip — Start Debating
              </button>
            </div>
          </div>
        </>
      )}

      {hasRefinedTopic && activeDebate.phase === 'clarification' && (
        <div className="debate-clarification-buttons">
          <button
            className="btn btn-primary debate-begin-btn"
            onClick={handleBeginDebate}
            disabled={isGenerating || submitting}
          >
            Let the Debate Begin
          </button>
          <button
            className="btn"
            onClick={handleAnotherRound}
            disabled={isGenerating || submitting}
          >
            Another Round of Questions
          </button>
        </div>
      )}

      {hasClarifications && hasAnswers && !hasRefinedTopic && (
        <div className="debate-action-hint">Synthesizing refined topic...</div>
      )}
    </div>
  );
}

/** Opening phase action bar — shows user opening input if user is a POVer */
function OpeningActions() {
  const { activeDebate, debateGenerating, debateError, submitUserOpening } = useDebateStore();
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const userIsPover = activeDebate.user_is_pover;
  const hasUserOpening = activeDebate.transcript.some(
    (e) => e.type === 'opening' && e.speaker === 'user',
  );

  // AI POVers still generating
  if (isGenerating) {
    return (
      <div className="debate-action-bar">
        {debateError && <div className="debate-error">{debateError}</div>}
        <div className="debate-action-hint">Delivering opening statements...</div>
      </div>
    );
  }

  // User needs to deliver their opening statement
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
        {debateError && <div className="debate-error">{debateError}</div>}
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

  // Opening phase complete but phase not yet transitioned (shouldn't happen normally)
  return (
    <div className="debate-action-bar">
      <div className="debate-action-hint">Opening statements complete.</div>
    </div>
  );
}

/** Main debate phase action bar */
function DebateActions() {
  const { activeDebate, debateGenerating, debateError, askQuestion, crossRespond } = useDebateStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const disabled = isGenerating || sending || activeDebate.phase === 'closed';

  const handleSend = async () => {
    if (!input.trim() || disabled) return;
    const text = input;
    setInput('');
    setSending(true);
    await askQuestion(text);
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCrossRespond = async () => {
    if (disabled) return;
    setSending(true);
    await crossRespond();
    setSending(false);
  };

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}
      <div className="debate-action-bar-inner">
        <input
          ref={inputRef}
          className="debate-input"
          type="text"
          placeholder="Ask a question (@Sentinel to target)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          className="btn btn-primary debate-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || disabled}
        >
          Send
        </button>
        <button
          className="btn debate-cross-btn"
          onClick={handleCrossRespond}
          disabled={disabled}
          title="Have the debaters respond to each other"
        >
          Cross-Respond
        </button>
      </div>
      {isGenerating && (
        <div className="debate-action-hint">
          {speakerLabel(debateGenerating)} is responding...
        </div>
      )}
    </div>
  );
}

/** Editable refined topic display */
function RefinedTopicEditor() {
  const { activeDebate, updateTopic, saveDebate } = useDebateStore();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  if (!activeDebate?.topic.refined) return null;

  const handleStartEdit = () => {
    setEditText(activeDebate.topic.final);
    setEditing(true);
  };

  const handleSave = async () => {
    updateTopic({ final: editText.trim() });
    setEditing(false);
    await saveDebate();
  };

  const handleCancel = () => {
    setEditing(false);
  };

  return (
    <div className="debate-refined-topic">
      <div className="debate-refined-topic-label">Refined Topic</div>
      {editing ? (
        <div className="debate-refined-topic-edit">
          <textarea
            className="debate-answer-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="debate-clarification-buttons">
            <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
            <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="debate-refined-topic-text" onClick={handleStartEdit} title="Click to edit">
          {activeDebate.topic.final}
        </div>
      )}
    </div>
  );
}

export function DebateWorkspace() {
  const {
    activeDebate, debateLoading, debateError, debateGenerating,
    runClarification, runOpeningStatements,
  } = useDebateStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasTriggeredClarification = useRef(false);
  const hasTriggeredOpening = useRef(false);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDebate?.transcript.length]);

  // Auto-trigger clarification when entering clarification phase with no transcript
  useEffect(() => {
    if (
      activeDebate?.phase === 'clarification' &&
      activeDebate.transcript.length === 0 &&
      !hasTriggeredClarification.current
    ) {
      hasTriggeredClarification.current = true;
      runClarification();
    }
  }, [activeDebate?.phase, activeDebate?.transcript.length, runClarification]);

  // Auto-trigger opening statements when entering opening phase
  useEffect(() => {
    if (
      activeDebate?.phase === 'opening' &&
      !activeDebate.transcript.some((e) => e.type === 'opening') &&
      !hasTriggeredOpening.current
    ) {
      hasTriggeredOpening.current = true;
      runOpeningStatements();
    }
  }, [activeDebate?.phase, activeDebate?.transcript, runOpeningStatements]);

  // Reset trigger flags when debate changes
  useEffect(() => {
    hasTriggeredClarification.current = false;
    hasTriggeredOpening.current = false;
  }, [activeDebate?.id]);

  if (debateLoading) {
    return <div className="debate-workspace-loading">Loading debate...</div>;
  }

  if (!activeDebate) {
    return <div className="debate-workspace-loading">No debate selected</div>;
  }

  const isClarificationPhase = activeDebate.phase === 'clarification' || activeDebate.phase === 'setup';
  const isOpeningPhase = activeDebate.phase === 'opening';
  const isDebatePhase = activeDebate.phase === 'debate';

  return (
    <div className="debate-workspace">
      {/* Topic bar */}
      <div className="debate-topic-bar">
        <span className="debate-phase-indicator">
          {PHASE_TITLES[activeDebate.phase] || activeDebate.phase}
        </span>
        <span className="debate-topic-text">{activeDebate.topic.final}</span>
      </div>

      {/* Refined topic editor (shown after synthesis, only during clarification) */}
      {activeDebate.topic.refined && activeDebate.phase === 'clarification' && (
        <RefinedTopicEditor />
      )}

      {/* Transcript */}
      <div className="debate-transcript">
        {activeDebate.transcript.length === 0 && !debateGenerating && (
          <div className="debate-transcript-empty">
            The debate is ready to begin. Clarification questions will appear here.
          </div>
        )}
        {activeDebate.transcript.map((entry) => (
          <StatementCard key={entry.id} entry={entry} />
        ))}
        {debateGenerating && (
          <div className="debate-statement debate-generating">
            <div className="debate-statement-header">
              <span className="debate-statement-speaker" style={{ color: speakerColor(debateGenerating) || undefined }}>
                {speakerLabel(debateGenerating)}
              </span>
              <span className="debate-statement-type">thinking...</span>
            </div>
            <ProgressIndicator />
            <div className="debate-generating-dots">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Phase-aware action bar */}
      {isClarificationPhase && <ClarificationActions />}
      {isOpeningPhase && <OpeningActions />}

      {isDebatePhase && <DebateActions />}
    </div>
  );
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId, TranscriptEntry, DocumentINode } from '../../types/debate';
import type { TopicCritique } from '@lib/debate/topicCritique';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { lineageMarkdownComponents } from '../../utils/lineageMatcher';
import { speakerLabel, fixMarkdownLinks } from './utils';
import { TopicCritiqueCard, DIMENSION_LABELS, RATING_COLORS } from './TopicCritique';

export function ClarificationCard({ entry }: { entry: TranscriptEntry }) {
  const meta = entry.metadata as Record<string, unknown> | undefined;
  const questions = meta?.questions as { question: string; options?: string[] }[] | undefined;

  if (questions && Array.isArray(questions) && questions.length > 0 && typeof questions[0] === 'object') {
    return (
      <div className="debate-statement debate-speaker-system debate-type-clarification" data-entry-id={entry.id}>
        <div className="debate-statement-header">
          <span className="debate-statement-speaker">{speakerLabel(entry.speaker)}</span>
          <span className="debate-statement-type">{entry.type}</span>
        </div>
        <div className="debate-statement-content markdown-body">
          <ol>
            {questions.map((q, i) => (
              <li key={i}>{typeof q === 'string' ? q : q.question}</li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="debate-statement debate-speaker-system debate-type-clarification" data-entry-id={entry.id}>
      <div className="debate-statement-header">
        <span className="debate-statement-speaker">{speakerLabel(entry.speaker)}</span>
        <span className="debate-statement-type">{entry.type}</span>
      </div>
      <div className="debate-statement-content markdown-body">
        <Markdown remarkPlugins={[remarkGfm]} components={lineageMarkdownComponents}>{fixMarkdownLinks(entry.content)}</Markdown>
      </div>
    </div>
  );
}

export function ClaimsEditor() {
  const { activeDebate, updateClaim, deleteClaim, proceedToOpening } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, updateClaim: s.updateClaim, deleteClaim: s.deleteClaim, proceedToOpening: s.proceedToOpening }))
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (!activeDebate?.document_analysis) return null;

  const claims = activeDebate.document_analysis.i_nodes;
  const tensions = activeDebate.document_analysis.tension_points;

  const startEdit = (claim: DocumentINode) => {
    setEditingId(claim.id);
    setEditText(claim.text);
  };

  const saveEdit = () => {
    if (editingId && editText.trim()) {
      updateClaim(editingId, editText.trim());
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const typeColors: Record<string, string> = {
    empirical: '#4a9eff',
    normative: '#e67e22',
    definitional: '#9b59b6',
    assumption: '#95a5a6',
    evidence: '#27ae60',
  };

  return (
    <div className="debate-claims-editor">
      <div className="claims-editor-header">
        <h3>Review Extracted Claims</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
          {claims.length} claim{claims.length !== 1 ? 's' : ''} extracted from the source document.
          Edit or remove claims to focus the debate. Deleted claims won't be used in opening statements or moderator analysis.
        </p>
      </div>

      <div className="claims-editor-list">
        {claims.map((claim, i) => (
          <div key={claim.id} className="claims-editor-item">
            <div className="claims-editor-item-header">
              <span className="claims-editor-number">{i + 1}</span>
              <span
                className="claims-editor-type"
                style={{ background: typeColors[claim.type] ?? '#666', color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: '0.7rem', textTransform: 'uppercase' }}
              >
                {claim.type}
              </span>
              <span className="claims-editor-id" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>
                {claim.id}
              </span>
            </div>

            {editingId === claim.id ? (
              <div className="claims-editor-edit">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.85rem' }}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="claims-editor-text" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                {claim.text}
              </div>
            )}

            {editingId !== claim.id && (
              <div className="claims-editor-actions">
                <button className="btn btn-sm" onClick={() => startEdit(claim)} title="Edit this claim">
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => deleteClaim(claim.id)}
                  title="Remove this claim from the debate"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {claims.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            All claims have been removed. The debate will proceed without document-grounded claims.
          </div>
        )}
      </div>

      {tensions.length > 0 && (
        <div className="claims-editor-tensions">
          <h4 style={{ fontSize: '0.85rem', margin: '12px 0 6px' }}>Tension Points</h4>
          {tensions.map((t, i) => (
            <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              {t.description}
              <span style={{ marginLeft: 8, fontSize: '0.7rem' }}>
                ({t.i_node_ids.filter(id => claims.some(c => c.id === id)).length}/{t.i_node_ids.length} claims active)
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="claims-editor-footer">
        <button
          className="btn btn-primary"
          onClick={proceedToOpening}
        >
          Proceed to Opening Statements ({claims.length} claim{claims.length !== 1 ? 's' : ''})
        </button>
      </div>
    </div>
  );
}

interface StructuredQuestion {
  question: string;
  options: string[];
}

export function ClarificationActions() {
  const {
    activeDebate, debateGenerating, debateError,
    runClarification, submitAnswersAndSynthesize, beginDebate, runOpeningStatements,
    initialCrossRespondRounds, setInitialCrossRespondRounds,
    openingOrder, setOpeningOrder,
    runTopicCritique, reEvaluateSuggestedTopic, topicCritiqueLoading, updateTopic,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError,
      runClarification: s.runClarification, submitAnswersAndSynthesize: s.submitAnswersAndSynthesize, beginDebate: s.beginDebate, runOpeningStatements: s.runOpeningStatements,
      initialCrossRespondRounds: s.initialCrossRespondRounds, setInitialCrossRespondRounds: s.setInitialCrossRespondRounds,
      openingOrder: s.openingOrder, setOpeningOrder: s.setOpeningOrder,
      runTopicCritique: s.runTopicCritique, reEvaluateSuggestedTopic: s.reEvaluateSuggestedTopic, topicCritiqueLoading: s.topicCritiqueLoading, updateTopic: s.updateTopic,
    }))
  );

  const critiqueTriggered = useRef(false);
  useEffect(() => {
    if (activeDebate?.source_type === 'topic' && !activeDebate.topic.critique && !critiqueTriggered.current && !topicCritiqueLoading) {
      critiqueTriggered.current = true;
      void runTopicCritique();
    }
  }, [activeDebate?.id]); // intentionally limited deps — only re-run on debate change
  const [answer, setAnswer] = useState('');
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const hasClarifications = activeDebate.transcript.some((e) => e.type === 'clarification');
  const hasAnswers = activeDebate.transcript.some((e) => e.type === 'answer');
  const hasRefinedTopic = activeDebate.topic.refined !== null;

  const clarificationEntry = activeDebate.transcript.find(e => e.type === 'clarification');
  const rawQuestions = (clarificationEntry?.metadata as Record<string, unknown>)?.questions;
  const structuredQuestions: StructuredQuestion[] | null =
    Array.isArray(rawQuestions) && rawQuestions.length > 0 && typeof rawQuestions[0] === 'object' && rawQuestions[0] !== null && 'options' in (rawQuestions[0] as Record<string, unknown>)
      ? (rawQuestions as StructuredQuestion[]).filter(q => q.options && q.options.length > 0)
      : null;

  const anyAnswered = structuredQuestions
    ? structuredQuestions.some((_, i) => {
        const sel = selections[i];
        return sel === '__other__' ? (otherTexts[i] ?? '').trim().length > 0 : !!sel;
      })
    : answer.trim().length > 0;

  const handlePillSelect = (qIdx: number, option: string) => {
    setSelections(prev => ({ ...prev, [qIdx]: prev[qIdx] === option ? '' : option }));
  };

  const handleSubmitAnswers = async () => {
    if (submitting) return;
    setSubmitting(true);
    if (structuredQuestions) {
      const qaText = structuredQuestions
        .map((q, i) => {
          const sel = selections[i];
          if (!sel) return null;
          const answerText = sel === '__other__' ? (otherTexts[i] ?? '').trim() : sel;
          return answerText ? `Q: ${q.question}\nA: ${answerText}` : null;
        })
        .filter(Boolean)
        .join('\n\n');
      await submitAnswersAndSynthesize(qaText);
    } else {
      await submitAnswersAndSynthesize(answer.trim());
    }
    setAnswer('');
    setSelections({});
    setOtherTexts({});
    setSubmitting(false);
  };

  const handleBeginDebate = async () => {
    await beginDebate();
    await runOpeningStatements();
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const next = [...openingOrder];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setOpeningOrder(next);
  };

  const moveDown = (index: number) => {
    if (index >= openingOrder.length - 1) return;
    const next = [...openingOrder];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setOpeningOrder(next);
  };

  const isGenerating = !!debateGenerating;

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}

      {topicCritiqueLoading && (
        <div className="debate-action-hint" style={{ fontStyle: 'italic' }}>Evaluating topic quality...</div>
      )}
      {activeDebate.topic.critique && (
        <TopicCritiqueCard
          critique={activeDebate.topic.critique as TopicCritique}
          suggestedCritique={activeDebate.topic.suggested_critique as TopicCritique | undefined}
          currentTopicText={activeDebate.topic.final}
          isLoading={topicCritiqueLoading}
          onUseSuggested={(suggested) => {
            updateTopic({ final: suggested });
            updateTopic({ critique: undefined } as any);
            critiqueTriggered.current = false;
            void runTopicCritique();
          }}
          onReEvaluateSuggested={(editedTopic) => {
            void reEvaluateSuggestedTopic(editedTopic);
          }}
        />
      )}

      {!hasClarifications && !isGenerating && (
        <div className="debate-clarification-choice">
          <div className="debate-action-hint">
            Configure the debate, then refine the topic or begin.
          </div>
          {openingOrder.length > 0 && (
            <div className="debate-opening-order">
              <span className="debate-opening-order-label">Speaking order:</span>
              <ol className="debate-opening-order-list">
                {openingOrder.map((poverId, idx) => {
                  const info = POVER_INFO[poverId];
                  return (
                    <li key={poverId} className="debate-opening-order-item">
                      <span className="debate-opening-order-name" style={{ color: info.color }}>{info.label}</span>
                      <span className="debate-opening-order-btns">
                        <button
                          className="debate-opening-order-btn"
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          title="Move left"
                        >&#9664;</button>
                        <button
                          className="debate-opening-order-btn"
                          onClick={() => moveDown(idx)}
                          disabled={idx === openingOrder.length - 1}
                          title="Move right"
                        >&#9654;</button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="debate-initial-rounds">
            {activeDebate.adaptive_staging?.enabled ? (
              <span className="debate-initial-rounds-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ background: '#f59e0b', color: '#000', padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: '0.75rem' }}>
                  Adaptive
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Signal-driven phase transitions ({activeDebate.adaptive_staging.pacing} pacing)
                </span>
              </span>
            ) : (
              <label className="debate-initial-rounds-label">
                Cross-respond rounds after openings:
                <select
                  className="debate-turns-select"
                  value={initialCrossRespondRounds}
                  onChange={(e) => setInitialCrossRespondRounds(parseInt(e.target.value, 10))}
                  title="Number of cross-respond rounds to run automatically after opening statements"
                >
                  {[1, 2, 3, 6, 9, 12, 15, 18, 21].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="debate-clarification-buttons">
            <button
              className="btn"
              onClick={() => void runClarification()}
            >
              Refine Topic
            </button>
            <button
              className="btn btn-primary"
              onClick={handleBeginDebate}
            >
              Begin Debate
            </button>
          </div>
        </div>
      )}

      {!hasClarifications && isGenerating && (
        <div className="debate-action-hint">Generating clarifying questions...</div>
      )}

      {hasClarifications && !hasAnswers && !hasRefinedTopic && (
        <>
          <div className="debate-action-hint">Answer their questions to sharpen the topic, or skip ahead.</div>
          {structuredQuestions ? (
            <div className="cq-questions">
              {structuredQuestions.map((q, qIdx) => (
                <div key={qIdx} className="cq-question-card">
                  <div className="cq-question-text">{q.question}</div>
                  <div className="cq-options">
                    {q.options.map((opt, oIdx) => (
                      <button
                        key={oIdx}
                        className={`cq-option-pill ${selections[qIdx] === opt ? 'selected' : ''}`}
                        onClick={() => handlePillSelect(qIdx, opt)}
                        disabled={isGenerating || submitting}
                      >
                        {selections[qIdx] === opt && <span className="cq-check">{'✓'} </span>}
                        {opt}
                      </button>
                    ))}
                    <button
                      className={`cq-option-pill cq-option-pill-other ${selections[qIdx] === '__other__' ? 'selected' : ''}`}
                      onClick={() => handlePillSelect(qIdx, '__other__')}
                      disabled={isGenerating || submitting}
                    >
                      Other...
                    </button>
                  </div>
                  {selections[qIdx] === '__other__' && (
                    <input
                      className="cq-option-other-input"
                      type="text"
                      placeholder="Type your answer..."
                      value={otherTexts[qIdx] ?? ''}
                      onChange={e => setOtherTexts(prev => ({ ...prev, [qIdx]: e.target.value }))}
                      disabled={isGenerating || submitting}
                      autoFocus
                    />
                  )}
                </div>
              ))}
              <div className="debate-clarification-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleSubmitAnswers}
                  disabled={!anyAnswered || isGenerating || submitting}
                >
                  {submitting ? 'Synthesizing...' : 'Continue'}
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
          ) : (
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
          )}
        </>
      )}

      {hasClarifications && hasAnswers && activeDebate.phase === 'clarification' && (
        <div className="debate-action-hint">
          {isGenerating ? 'Synthesizing topic and starting debate...' : 'Starting debate...'}
        </div>
      )}
    </div>
  );
}

export function RefinedTopicEditor() {
  const { activeDebate, updateTopic, saveDebate } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, updateTopic: s.updateTopic, saveDebate: s.saveDebate }))
  );
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

export function TopicScoreComparison() {
  const activeDebate = useDebateStore(s => s.activeDebate);
  const [showDetails, setShowDetails] = useState(false);

  if (!activeDebate?.topic.critique || !activeDebate.topic.refined_critique) return null;

  const old = activeDebate.topic.critique as TopicCritique;
  const neu = activeDebate.topic.refined_critique as TopicCritique;
  const delta = neu.composite_score - old.composite_score;
  const deltaColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : 'var(--text-muted)';

  const structuralKeys = ['crux_density', 'evidence_coverage', 'bdi_heterogeneity', 'abstraction_level', 'situation_activation'] as const;
  const frameKeys = ['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const;

  const scoreCell = (val: number, max: number) => (
    <span style={{ color: val === 0 ? '#dc2626' : val === max ? '#16a34a' : '#d97706', fontWeight: 600 }}>{val}/{max}</span>
  );

  const deltaCell = (oldVal: number, newVal: number) => {
    const d = newVal - oldVal;
    if (d === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return <span style={{ color: d > 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{d > 0 ? '+' : ''}{d}</span>;
  };

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      padding: '10px 14px',
      marginBottom: 12,
      background: 'var(--bg-secondary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Topic Score</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
            background: `${RATING_COLORS[old.rating]}18`, color: RATING_COLORS[old.rating],
          }}>
            Original: {old.composite_score}/20
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>→</span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
            background: `${RATING_COLORS[neu.rating]}18`, color: RATING_COLORS[neu.rating],
          }}>
            Refined: {neu.composite_score}/20
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: deltaColor }}>
            ({delta > 0 ? '+' : ''}{delta})
          </span>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => setShowDetails(d => !d)}
          style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '2px 8px' }}
        >
          {showDetails ? 'Hide' : 'Compare'}
        </button>
      </div>

      {showDetails && (
        <div style={{ marginTop: 10 }}>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Dimension</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Original</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Refined</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td colSpan={4} style={{ padding: '6px 8px 2px', fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Structural (taxonomy alignment)
                </td>
              </tr>
              {structuralKeys.map(key => (
                <tr key={key}>
                  <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{DIMENSION_LABELS[key]}</td>
                  <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(old.structural_score[key] as number, 2)}</td>
                  <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(neu.structural_score[key] as number, 2)}</td>
                  <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.structural_score[key] as number, neu.structural_score[key] as number)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                <td style={{ padding: '2px 8px' }}>Subtotal</td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{old.structural_score.total}/10</td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{neu.structural_score.total}/10</td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.structural_score.total, neu.structural_score.total)}</td>
              </tr>

              {old.frame_score && neu.frame_score && (
                <>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td colSpan={4} style={{ padding: '8px 8px 2px', fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      Frame (linguistic quality)
                    </td>
                  </tr>
                  {frameKeys.map(key => (
                    <tr key={key}>
                      <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{DIMENSION_LABELS[key]}</td>
                      <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(old.frame_score![key] as number, 2)}</td>
                      <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(neu.frame_score![key] as number, 2)}</td>
                      <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.frame_score![key] as number, neu.frame_score![key] as number)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                    <td style={{ padding: '2px 8px' }}>Subtotal</td>
                    <td style={{ textAlign: 'center', padding: '2px 8px' }}>{old.frame_score.total}/10</td>
                    <td style={{ textAlign: 'center', padding: '2px 8px' }}>{neu.frame_score.total}/10</td>
                    <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.frame_score.total, neu.frame_score.total)}</td>
                  </tr>
                  {old.frame_score.actor_specificity != null && neu.frame_score.actor_specificity != null && (
                    <>
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={4} style={{ padding: '8px 8px 2px', fontWeight: 700, fontSize: '0.7rem', color: '#ef4444' }}>
                          Political Operationality
                        </td>
                      </tr>
                      {(['actor_specificity', 'decision_proximity', 'constituency_impact'] as const).map(key => {
                        const ov = old.frame_score![key] as number | undefined;
                        const nv = neu.frame_score![key] as number | undefined;
                        if (ov == null || nv == null) return null;
                        return (
                          <tr key={key}>
                            <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{DIMENSION_LABELS[key]}</td>
                            <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(ov, 2)}</td>
                            <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(nv, 2)}</td>
                            <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(ov, nv)}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </>
              )}

              <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
                <td style={{ padding: '4px 8px' }}>Composite</td>
                <td style={{ textAlign: 'center', padding: '4px 8px' }}>{old.composite_score}/20</td>
                <td style={{ textAlign: 'center', padding: '4px 8px' }}>{neu.composite_score}/20</td>
                <td style={{ textAlign: 'center', padding: '4px 8px', color: deltaColor }}>{delta > 0 ? '+' : ''}{delta}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

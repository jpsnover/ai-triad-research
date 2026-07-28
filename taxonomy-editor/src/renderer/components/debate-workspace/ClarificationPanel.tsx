// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useMemo, useCallback, type RefObject } from 'react';
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
import { MODELS_BY_BACKEND } from '../../hooks/useTaxonomyStore';
import { EXPLORATION_PRESET } from '@lib/debate/explorationPresetConfig';
import './ClarificationPanel.css';

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
        <p className="cp-claims-editor-desc">
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
                className="claims-editor-type cp-claims-editor-type"
                // eslint-disable-next-line local/no-inline-style -- dynamic background keyed on claim.type
                style={{ background: typeColors[claim.type] ?? '#666' }}
              >
                {claim.type}
              </span>
              <span className="claims-editor-id cp-claims-editor-id">
                {claim.id}
              </span>
            </div>

            {editingId === claim.id ? (
              <div className="claims-editor-edit">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={3}
                  className="cp-claims-editor-textarea"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <div className="cp-claims-edit-buttons">
                  <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="claims-editor-text cp-claims-editor-text">
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
          <div className="cp-claims-empty">
            All claims have been removed. The debate will proceed without document-grounded claims.
          </div>
        )}
      </div>

      {tensions.length > 0 && (
        <div className="claims-editor-tensions">
          <h4 className="cp-tensions-heading">Tension Points</h4>
          {tensions.map((t, i) => (
            <div key={i} className="cp-tension-item">
              {t.description}
              <span className="cp-tension-count">
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
    toggleStepMode,
    explorationModel, setExplorationModel,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError,
      runClarification: s.runClarification, submitAnswersAndSynthesize: s.submitAnswersAndSynthesize, beginDebate: s.beginDebate, runOpeningStatements: s.runOpeningStatements,
      initialCrossRespondRounds: s.initialCrossRespondRounds, setInitialCrossRespondRounds: s.setInitialCrossRespondRounds,
      openingOrder: s.openingOrder, setOpeningOrder: s.setOpeningOrder,
      runTopicCritique: s.runTopicCritique, reEvaluateSuggestedTopic: s.reEvaluateSuggestedTopic, topicCritiqueLoading: s.topicCritiqueLoading, updateTopic: s.updateTopic,
      toggleStepMode: s.toggleStepMode,
      explorationModel: s.explorationModel, setExplorationModel: s.setExplorationModel,
    }))
  );

  const cheapModels = useMemo(() => {
    const all = Object.entries(MODELS_BY_BACKEND).flatMap(([backend, models]) =>
      models.map(m => ({ ...m, label: `${m.label} (${backend})` })),
    );
    const cheap = all.filter(m => /flash|haiku|llama/i.test(m.label));
    return cheap.length > 0 ? cheap : all.slice(0, 3);
  }, []);

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

  const handleExploreFirst = async () => {
    if (!activeDebate) return;
    const model = explorationModel || cheapModels[0]?.value || '';
    const store = useDebateStore.getState();
    const topic = activeDebate.topic.final || activeDebate.topic.original;
    const povers = activeDebate.active_povers;
    const userIsPover = activeDebate.user_is_pover;

    const id = await store.createDebate(
      topic,
      povers,
      userIsPover,
      activeDebate.source_type,
      activeDebate.source_ref,
      activeDebate.source_content,
      model,
      'exploration',
      EXPLORATION_PRESET.temperature,
      activeDebate.audience,
      {
        pacing: EXPLORATION_PRESET.pacing,
        useAdaptiveStaging: false,
        background: activeDebate.topic.background,
      },
    );
    await store.loadDebate(id);
    store.updatePhase('clarification');
    await store.saveDebate('explore-first-setup');
    await beginDebate();
    await runOpeningStatements();
  };

  const [showExploreModel, setShowExploreModel] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showOptions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowOptions(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showOptions]);

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

  // Overflow menu for narrow widths — collapses lower-priority buttons into ⋯
  const footerRef = useRef<HTMLDivElement>(null);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const naturalWidthsRef = useRef<number[] | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (naturalWidthsRef.current) return;
    const footer = footerRef.current;
    if (!footer) return;
    const buttons = footer.querySelectorAll<HTMLElement>('.debate-setup-action-btn');
    if (buttons.length === 0) return;
    naturalWidthsRef.current = Array.from(buttons).map(b => b.offsetWidth);
  }, []);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    let debounceTimer: ReturnType<typeof setTimeout>;
    const GAP = 8;
    const OVERFLOW_BTN_W = 36;
    const OPTIONS_MIN_W = 180;

    const observer = new ResizeObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const widths = naturalWidthsRef.current;
        if (!widths || widths.length < 3) return;
        const available = footer.clientWidth - OPTIONS_MIN_W - GAP;
        const total = widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * GAP;
        if (available >= total) { setCollapsedCount(0); return; }
        const without1 = total - widths[0] - GAP + OVERFLOW_BTN_W + GAP;
        if (available >= without1) { setCollapsedCount(1); return; }
        setCollapsedCount(2);
      }, 50);
    });
    observer.observe(footer);
    return () => { observer.disconnect(); clearTimeout(debounceTimer); };
  }, []);

  useEffect(() => {
    if (!overflowOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node) &&
          overflowTriggerRef.current && !overflowTriggerRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
        overflowTriggerRef.current?.focus();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOverflowOpen(false); overflowTriggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleEscape); };
  }, [overflowOpen]);

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}

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
          {activeDebate.topic.critique && (activeDebate.topic.critique as TopicCritique).composite_score < 14 && (
            <div className="debate-action-hint debate-refine-nudge">
              Topic scored <strong>{(activeDebate.topic.critique as TopicCritique).composite_score}/20</strong> — refining can sharpen the debate.
            </div>
          )}
          <div className="debate-setup-footer" ref={footerRef}>
            <div className="debate-options-anchor" ref={optionsRef}>
              <button
                className="debate-options-trigger"
                onClick={() => setShowOptions(v => !v)}
                aria-expanded={showOptions}
                aria-haspopup="true"
              >
                <span className="options-icon">{'⚙'}</span>
                <span>Debate options</span>
                <span className="options-summary">
                  {activeDebate.adaptive_staging?.enabled
                    ? `Adaptive${activeDebate.adaptive_staging.step_mode ? ' · Step' : ` · ${activeDebate.adaptive_staging.pacing}`}`
                    : `${initialCrossRespondRounds} rounds`}
                  {explorationModel ? ` · ${cheapModels.find(m => m.value === explorationModel)?.label?.split(' (')[0] || ''}` : ''}
                </span>
              </button>
              {showOptions && (
                <div className="debate-options-popover" role="dialog" aria-label="Debate options">
                  <div className="debate-options-section">
                    <span className="debate-options-section-label">Pacing</span>
                    {activeDebate.adaptive_staging?.enabled ? (
                      <>
                        <span className="pacing-description">
                          {activeDebate.adaptive_staging.step_mode
                            ? 'Step-by-step — 1 round at a time, manual stage control'
                            : `Signal-driven phase transitions (${activeDebate.adaptive_staging.pacing} pacing)`}
                        </span>
                        <div className="step-toggle-row">
                          <button
                            className={`btn btn-sm cp-step-toggle-btn${activeDebate.adaptive_staging.step_mode ? ' active' : ''}`}
                            onClick={() => void toggleStepMode()}
                          >
                            {activeDebate.adaptive_staging.step_mode ? 'Step Mode' : 'Auto Mode'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <label className="cp-cross-respond-label">
                        Cross-respond rounds:
                        <select
                          value={initialCrossRespondRounds}
                          onChange={(e) => setInitialCrossRespondRounds(parseInt(e.target.value, 10))}
                          title="Number of cross-respond rounds after openings"
                        >
                          {[1, 2, 3, 6, 9, 12, 15, 18, 21].map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {openingOrder.length > 0 && (
                    <div className="debate-options-section">
                      <span className="debate-options-section-label">Speaking order</span>
                      <div className="debate-opening-order">
                        <ol className="debate-opening-order-list">
                          {openingOrder.map((poverId, idx) => {
                            const info = POVER_INFO[poverId];
                            return (
                              <li key={poverId} className="debate-opening-order-item">
                                {/* eslint-disable-next-line local/no-inline-style -- dynamic per-pover color */}
                                <span className="debate-opening-order-name" style={{ color: info.color }}>{info.label}</span>
                                <span className="debate-opening-order-btns">
                                  <button className="debate-opening-order-btn" onClick={() => moveUp(idx)} disabled={idx === 0} title="Move left">&#9664;</button>
                                  <button className="debate-opening-order-btn" onClick={() => moveDown(idx)} disabled={idx === openingOrder.length - 1} title="Move right">&#9654;</button>
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </div>
                  )}
                  <div className="debate-options-section">
                    <span className="debate-options-section-label">Exploration model</span>
                    <select
                      value={explorationModel || cheapModels[0]?.value || ''}
                      onChange={e => setExplorationModel(e.target.value)}
                    >
                      {cheapModels.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
            <div className="debate-setup-status-zone">
              {topicCritiqueLoading && (
                <span className="debate-setup-status">
                  <span className="debate-setup-spinner" aria-hidden="true" />
                  Evaluating topic quality…
                </span>
              )}
            </div>
            <div className="debate-setup-actions">
              {collapsedCount > 0 && (
                <div className="debate-overflow-anchor">
                  <button
                    ref={overflowTriggerRef}
                    className="btn btn-ghost debate-overflow-trigger"
                    onClick={() => {
                      const opening = !overflowOpen;
                      setOverflowOpen(opening);
                      if (opening) setTimeout(() => overflowMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
                    }}
                    aria-haspopup="true"
                    aria-expanded={overflowOpen}
                    aria-label="More actions"
                    title="More actions"
                  >
                    ⋯
                  </button>
                  {overflowOpen && (
                    <div className="debate-overflow-menu" ref={overflowMenuRef} role="menu">
                      {collapsedCount >= 1 && (
                        <button
                          className="debate-overflow-item"
                          role="menuitem"
                          onClick={() => { setOverflowOpen(false); void handleExploreFirst(); }}
                          disabled={isGenerating || submitting}
                        >
                          Explore First
                        </button>
                      )}
                      {collapsedCount >= 2 && (
                        <button
                          className="debate-overflow-item"
                          role="menuitem"
                          onClick={() => { setOverflowOpen(false); void runClarification(); }}
                        >
                          Refine Topic
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {collapsedCount < 1 && (
                <button
                  className="btn btn-ghost debate-setup-action-btn"
                  onClick={() => void handleExploreFirst()}
                  disabled={isGenerating || submitting}
                  title="Run a quick exploration debate with a cheap model, then review findings before starting a full debate"
                >
                  Explore First
                </button>
              )}
              {collapsedCount < 2 && (
                <button
                  className="btn debate-setup-action-btn"
                  onClick={() => void runClarification()}
                >
                  Refine Topic
                </button>
              )}
              <button
                className="btn btn-primary debate-setup-action-btn"
                onClick={handleBeginDebate}
                disabled={isGenerating || submitting}
              >
                Begin Debate
              </button>
            </div>
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
  const { activeDebate, updateTopic, saveDebate, runClarification, debateGenerating } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, updateTopic: s.updateTopic, saveDebate: s.saveDebate, runClarification: s.runClarification, debateGenerating: s.debateGenerating }))
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

  const handleRevert = () => {
    updateTopic({ refined: null, final: activeDebate.topic.original });
  };

  const isGenerating = !!debateGenerating;
  const isChanged = activeDebate.topic.final !== activeDebate.topic.original;

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
      {!editing && (
        <div className="debate-refined-topic-actions">
          <button className="btn btn-sm" onClick={handleStartEdit} disabled={isGenerating} title="Manually edit the topic text">
            Edit
          </button>
          <button className="btn btn-sm btn-refine" onClick={() => void runClarification()} disabled={isGenerating} title="Run refinement again on the current topic">
            Re-refine
          </button>
          {isChanged && (
            <button className="btn btn-sm" onClick={handleRevert} disabled={isGenerating} title="Revert to the original topic">
              Revert to Original
            </button>
          )}
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
    // eslint-disable-next-line local/no-inline-style -- dynamic color keyed on score value
    <span className="cp-score-cell" style={{ color: val === 0 ? '#dc2626' : val === max ? '#16a34a' : '#d97706' }}>{val}/{max}</span>
  );

  const deltaCell = (oldVal: number, newVal: number) => {
    const d = newVal - oldVal;
    if (d === 0) return <span className="cp-delta-neutral">—</span>;
    // eslint-disable-next-line local/no-inline-style -- dynamic color keyed on delta sign
    return <span className="cp-score-cell" style={{ color: d > 0 ? '#16a34a' : '#dc2626' }}>{d > 0 ? '+' : ''}{d}</span>;
  };

  return (
    <div className="cp-score-comparison">
      <div className="cp-score-summary-row">
        <span className="cp-score-label">Topic Score</span>
        <div className="cp-score-badges">
          {/* eslint-disable-next-line local/no-inline-style -- dynamic rating-derived background/color */}
          <span className="cp-score-badge" style={{
            background: `${RATING_COLORS[old.rating]}18`, color: RATING_COLORS[old.rating],
          }}>
            Original: {old.composite_score}/20
          </span>
          <span className="cp-score-arrow">→</span>
          {/* eslint-disable-next-line local/no-inline-style -- dynamic rating-derived background/color */}
          <span className="cp-score-badge" style={{
            background: `${RATING_COLORS[neu.rating]}18`, color: RATING_COLORS[neu.rating],
          }}>
            Refined: {neu.composite_score}/20
          </span>
          {/* eslint-disable-next-line local/no-inline-style -- dynamic delta color */}
          <span className="cp-score-delta" style={{ color: deltaColor }}>
            ({delta > 0 ? '+' : ''}{delta})
          </span>
        </div>
        <button
          className="btn btn-sm cp-score-compare-btn"
          onClick={() => setShowDetails(d => !d)}
        >
          {showDetails ? 'Hide' : 'Compare'}
        </button>
      </div>

      {showDetails && (
        <div className="cp-score-details">
          <table className="cp-score-table">
            <thead>
              <tr className="cp-row-border-bottom">
                <th className="cp-th-left">Dimension</th>
                <th className="cp-th-center">Original</th>
                <th className="cp-th-center">Refined</th>
                <th className="cp-th-center">Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr className="cp-row-border-bottom">
                <td colSpan={4} className="cp-section-header">
                  Structural (taxonomy alignment)
                </td>
              </tr>
              {structuralKeys.map(key => (
                <tr key={key}>
                  <td className="cp-td-label">{DIMENSION_LABELS[key]}</td>
                  <td className="cp-td-center">{scoreCell(old.structural_score[key] as number, 2)}</td>
                  <td className="cp-td-center">{scoreCell(neu.structural_score[key] as number, 2)}</td>
                  <td className="cp-td-center">{deltaCell(old.structural_score[key] as number, neu.structural_score[key] as number)}</td>
                </tr>
              ))}
              <tr className="cp-subtotal-row">
                <td className="cp-td-subtotal">Subtotal</td>
                <td className="cp-td-center">{old.structural_score.total}/10</td>
                <td className="cp-td-center">{neu.structural_score.total}/10</td>
                <td className="cp-td-center">{deltaCell(old.structural_score.total, neu.structural_score.total)}</td>
              </tr>

              {old.frame_score && neu.frame_score && (
                <>
                  <tr className="cp-row-border-bottom">
                    <td colSpan={4} className="cp-section-header-lg">
                      Frame (linguistic quality)
                    </td>
                  </tr>
                  {frameKeys.map(key => (
                    <tr key={key}>
                      <td className="cp-td-label">{DIMENSION_LABELS[key]}</td>
                      <td className="cp-td-center">{scoreCell(old.frame_score![key] as number, 2)}</td>
                      <td className="cp-td-center">{scoreCell(neu.frame_score![key] as number, 2)}</td>
                      <td className="cp-td-center">{deltaCell(old.frame_score![key] as number, neu.frame_score![key] as number)}</td>
                    </tr>
                  ))}
                  <tr className="cp-subtotal-row">
                    <td className="cp-td-subtotal">Subtotal</td>
                    <td className="cp-td-center">{old.frame_score.total}/10</td>
                    <td className="cp-td-center">{neu.frame_score.total}/10</td>
                    <td className="cp-td-center">{deltaCell(old.frame_score.total, neu.frame_score.total)}</td>
                  </tr>
                  {old.frame_score.actor_specificity != null && neu.frame_score.actor_specificity != null && (
                    <>
                      <tr className="cp-row-border-bottom">
                        <td colSpan={4} className="cp-section-header-danger">
                          Political Operationality
                        </td>
                      </tr>
                      {(['actor_specificity', 'decision_proximity', 'constituency_impact'] as const).map(key => {
                        const ov = old.frame_score![key] as number | undefined;
                        const nv = neu.frame_score![key] as number | undefined;
                        if (ov == null || nv == null) return null;
                        return (
                          <tr key={key}>
                            <td className="cp-td-label">{DIMENSION_LABELS[key]}</td>
                            <td className="cp-td-center">{scoreCell(ov, 2)}</td>
                            <td className="cp-td-center">{scoreCell(nv, 2)}</td>
                            <td className="cp-td-center">{deltaCell(ov, nv)}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </>
              )}

              <tr className="cp-composite-row">
                <td className="cp-td-composite-label">Composite</td>
                <td className="cp-td-composite-center">{old.composite_score}/20</td>
                <td className="cp-td-composite-center">{neu.composite_score}/20</td>
                {/* eslint-disable-next-line local/no-inline-style -- dynamic delta color */}
                <td className="cp-td-composite-center" style={{ color: deltaColor }}>{delta > 0 ? '+' : ''}{delta}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

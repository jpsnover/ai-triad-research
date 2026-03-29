// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { POVER_INFO } from '../types/debate';
import type { PoverId, TranscriptEntry, TaxonomyRef } from '../types/debate';
import type { TabId } from '../types/taxonomy';
import { DebateSourceViewer } from './DebateSourceViewer';
import Markdown from 'react-markdown';

// ── Phase 7: Context menu state ──────────────────────────
interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  entryId: string;
  isPoverStatement: boolean;
}

const PHASE_TITLES: Record<string, string> = {
  setup: 'Setting up...',
  clarification: 'Topic Refinement',
  opening: 'Opening Statements',
  debate: 'Debate',
  closed: 'Debate Closed',
};

function speakerLabel(speaker: PoverId | 'system'): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info ? info.label : speaker;
}

function speakerColor(speaker: PoverId | 'system'): string | undefined {
  if (speaker === 'system' || speaker === 'user') return undefined;
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info?.color;
}

// ── Phase 6: Taxonomy cross-navigation helpers ──────────

/** Map node_id prefix to the taxonomy tab and CSS color */
function nodeIdToTab(nodeId: string): { tab: TabId; colorVar: string } {
  if (nodeId.startsWith('acc-')) return { tab: 'accelerationist', colorVar: 'var(--color-acc)' };
  if (nodeId.startsWith('saf-')) return { tab: 'safetyist', colorVar: 'var(--color-saf)' };
  if (nodeId.startsWith('skp-')) return { tab: 'skeptic', colorVar: 'var(--color-skp)' };
  if (nodeId.startsWith('cc-')) return { tab: 'cross-cutting', colorVar: 'var(--color-cc)' };
  return { tab: 'cross-cutting', colorVar: 'var(--text-muted)' };
}

/** Resolve a node_id to its label from the taxonomy store */
function getNodeLabel(nodeId: string): string {
  const state = useTaxonomyStore.getState();
  const { tab } = nodeIdToTab(nodeId);

  if (tab === 'cross-cutting') {
    const node = state.crossCutting?.nodes?.find((n: { id: string }) => n.id === nodeId);
    if (node) return node.label;
  } else {
    const povFile = state[tab as 'accelerationist' | 'safetyist' | 'skeptic'];
    const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
    if (node) return node.label;
  }
  return nodeId;
}

/** Clickable taxonomy pill that opens the node in pane 3 */
function TaxonomyPill({ taxRef }: { taxRef: TaxonomyRef }) {
  const { colorVar } = nodeIdToTab(taxRef.node_id);
  const label = getNodeLabel(taxRef.node_id);
  const inspectNode = useDebateStore((s) => s.inspectNode);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    inspectNode(taxRef.node_id);
  };

  return (
    <span
      className="debate-taxonomy-pill debate-taxonomy-pill-clickable"
      style={{ borderColor: colorVar, color: colorVar }}
      title={`${label}\n${taxRef.relevance}`}
      onClick={handleClick}
    >
      {taxRef.node_id}
    </span>
  );
}

/** Taxonomy refs with "Show reasoning" toggle */
function TaxonomyRefsSection({ refs }: { refs: TaxonomyRef[] }) {
  const [expanded, setExpanded] = useState(false);
  const inspectNode = useDebateStore((s) => s.inspectNode);

  if (refs.length === 0) return null;

  return (
    <div className="debate-taxonomy-refs-section">
      <div className="debate-taxonomy-refs">
        {refs.map((taxRef) => (
          <TaxonomyPill key={taxRef.node_id} taxRef={taxRef} />
        ))}
        <button
          className="debate-reasoning-toggle"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'Hide reasoning' : 'Show reasoning'}
        </button>
      </div>
      {expanded && (
        <div className="debate-reasoning-list">
          {refs.map((taxRef) => {
            const label = getNodeLabel(taxRef.node_id);
            const { colorVar } = nodeIdToTab(taxRef.node_id);
            return (
              <div key={taxRef.node_id} className="debate-reasoning-item">
                <button
                  className="debate-reasoning-node"
                  style={{ color: colorVar }}
                  onClick={() => inspectNode(taxRef.node_id)}
                >
                  {taxRef.node_id}
                </button>
                <span className="debate-reasoning-label">{label}</span>
                <span className="debate-reasoning-text">{taxRef.relevance}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

// ── Similar POVs panel ───────────────────────────────────

function DebateSimilarPovPanel({ query, onClose }: { query: string; onClose: () => void }) {
  const { semanticResults, getLabelForId } = useTaxonomyStore();
  const inspectNode = useDebateStore((s) => s.inspectNode);
  const [searching, setSearching] = useState(true);
  const isFirstRender = useRef(true);

  // Don't mark done on the initial mount (semanticResults may be stale from a previous search);
  // only react to genuine updates that arrive after this component mounts.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setSearching(false);
  }, [semanticResults]);

  const rows = semanticResults.filter(r => r.score >= 0.4).slice(0, 20);
  const truncatedQuery = query.length > 70 ? query.slice(0, 67) + '…' : query;

  return (
    <div className="debate-similar-pov-panel">
      <div className="debate-similar-pov-header">
        <span className="debate-similar-pov-title">Similar POVs</span>
        <span className="debate-similar-pov-query" title={query}>&ldquo;{truncatedQuery}&rdquo;</span>
        <button className="debate-find-close" onClick={onClose} title="Close">×</button>
      </div>
      {searching ? (
        <div className="debate-similar-pov-status">Searching…</div>
      ) : rows.length === 0 ? (
        <div className="debate-similar-pov-status">No similar POVs found.</div>
      ) : (
        <div className="debate-similar-pov-rows">
          {rows.map(r => {
            const label = getLabelForId(r.id);
            const { colorVar } = nodeIdToTab(r.id);
            return (
              <button
                key={r.id}
                className="debate-similar-pov-row"
                onClick={() => inspectNode(r.id)}
                title={label}
              >
                <span className="debate-similar-pov-score">{Math.round(r.score * 100)}%</span>
                <span className="debate-similar-pov-id" style={{ color: colorVar }}>{r.id}</span>
                <span className="debate-similar-pov-label">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Find-in-debate helpers ────────────────────────────────

function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let count = 0, pos = 0;
  while ((pos = lower.indexOf(q, pos)) !== -1) { count++; pos += q.length; }
  return count;
}

function HighlightedText({ text, query, matchOffset, currentIndex }: {
  text: string; query: string; matchOffset: number; currentIndex: number;
}) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0, n = 0;
  while (pos <= text.length) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) { if (pos < text.length) parts.push(text.slice(pos)); break; }
    if (idx > pos) parts.push(text.slice(pos, idx));
    const gi = matchOffset + n;
    parts.push(
      <mark
        key={gi}
        className={`debate-find-match${gi === currentIndex ? ' debate-find-match-current' : ''}`}
        data-find-index={gi}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    n++; pos = idx + query.length;
  }
  return <>{parts}</>;
}

function FindBar({ query, onQueryChange, current, total, onPrev, onNext, onClose }: {
  query: string; onQueryChange: (q: string) => void;
  current: number; total: number;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="debate-find-bar">
      <input
        ref={inputRef}
        className="debate-find-input"
        type="text"
        placeholder="Find in debate…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
        }}
      />
      <span className="debate-find-count">
        {total === 0 ? (query ? 'No results' : '') : `${current + 1} / ${total}`}
      </span>
      <button className="debate-find-nav" onClick={onPrev} disabled={total === 0} title="Previous (Shift+Enter)">▲</button>
      <button className="debate-find-nav" onClick={onNext} disabled={total === 0} title="Next (Enter)">▼</button>
      <button className="debate-find-close" onClick={onClose} title="Close (Esc)">×</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────

/** Wrapper that adds delete controls to any transcript entry */
function EntryDeleteControls({ entry, totalEntries, entryIndex }: {
  entry: TranscriptEntry; totalEntries: number; entryIndex: number;
}) {
  const { deleteTranscriptEntries, activeDebate } = useDebateStore();
  const [confirmMode, setConfirmMode] = useState<'single' | 'after' | null>(null);

  const handleDeleteSingle = async () => {
    await deleteTranscriptEntries([entry.id]);
    setConfirmMode(null);
  };

  const handleDeleteThisAndAfter = async () => {
    if (!activeDebate) return;
    const idx = activeDebate.transcript.findIndex(e => e.id === entry.id);
    if (idx < 0) return;
    const idsToRemove = activeDebate.transcript.slice(idx).map(e => e.id);
    await deleteTranscriptEntries(idsToRemove);
    setConfirmMode(null);
  };

  if (confirmMode) {
    return (
      <div className="debate-entry-delete-confirm">
        <span>{confirmMode === 'single' ? 'Delete this entry?' : `Delete this and ${totalEntries - entryIndex - 1} entries after it?`}</span>
        <button className="btn btn-sm btn-danger" onClick={confirmMode === 'single' ? handleDeleteSingle : handleDeleteThisAndAfter}>Yes</button>
        <button className="btn btn-sm" onClick={() => setConfirmMode(null)}>No</button>
      </div>
    );
  }

  return (
    <div className="debate-entry-delete-actions">
      <button
        className="debate-entry-delete-btn"
        onClick={() => setConfirmMode('single')}
        title="Delete this entry"
      >
        &times;
      </button>
      {entryIndex < totalEntries - 1 && (
        <button
          className="debate-entry-delete-btn debate-entry-delete-after"
          onClick={() => setConfirmMode('after')}
          title="Delete this and all entries after it"
        >
          &times;&darr;
        </button>
      )}
    </div>
  );
}

function StatementCard({ entry, findQuery = '', matchOffset = 0, findCurrentIndex = -1 }: {
  entry: TranscriptEntry; findQuery?: string; matchOffset?: number; findCurrentIndex?: number;
}) {
  const color = speakerColor(entry.speaker);
  const isPover = entry.speaker !== 'system' && entry.speaker !== 'user';
  return (
    <div
      className={`debate-statement debate-speaker-${entry.speaker} debate-type-${entry.type}`}
      data-entry-id={entry.id}
      data-is-pover={isPover ? 'true' : 'false'}
    >
      <div className="debate-statement-header">
        <span className="debate-statement-speaker" style={color ? { color } : undefined}>
          {speakerLabel(entry.speaker)}
        </span>
        <span className="debate-statement-type">{entry.type}</span>
      </div>
      <div className="debate-statement-content markdown-body">
        {findQuery
          ? <HighlightedText text={entry.content} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />
          : <Markdown>{entry.content}</Markdown>}
      </div>
      <TaxonomyRefsSection refs={entry.taxonomy_refs} />
      {entry.policy_refs && entry.policy_refs.length > 0 && (
        <div className="debate-policy-refs-section">
          {entry.policy_refs.map((polId) => (
            <span key={polId} className="debate-policy-pill" title={polId}>
              {polId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Probing questions card — clicking a question inserts it as the user's next question */
function ProbingCard({ entry }: { entry: TranscriptEntry }) {
  const { askQuestion, debateGenerating } = useDebateStore();
  const questions = (entry.metadata?.probing_questions as { text: string; targets: string[] }[]) || [];

  const handleAsk = async (text: string) => {
    if (debateGenerating) return;
    await askQuestion(text);
  };

  return (
    <div className="debate-statement debate-type-probing debate-speaker-system">
      <div className="debate-statement-header">
        <span className="debate-statement-speaker">Facilitator</span>
        <span className="debate-statement-type">probing questions</span>
      </div>
      <div className="debate-probing-questions">
        {questions.map((q, i) => (
          <button
            key={i}
            className="debate-probing-question-btn"
            onClick={() => handleAsk(q.text)}
            disabled={!!debateGenerating}
            title={q.targets?.length > 0 ? `Targets: ${q.targets.map((t) => POVER_INFO[t as Exclude<PoverId, 'user'>]?.label || t).join(', ')}` : 'Ask this question'}
          >
            {q.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Custom context menu for debate text selection */
function DebateContextMenu({
  menu,
  onClose,
  onSimilarPovSearch,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onSimilarPovSearch: (query: string) => void;
}) {
  const { factCheckSelection, debateGenerating } = useDebateStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(menu.selectedText);
    onClose();
  };

  const handleSearchGoogle = () => {
    const query = encodeURIComponent(menu.selectedText.slice(0, 200));
    window.electronAPI.openExternal(`https://www.google.com/search?q=${query}`);
    onClose();
  };

  const handleSimilarPovs = () => {
    onSimilarPovSearch(menu.selectedText);
    onClose();
  };

  const handleFactCheck = async () => {
    onClose();
    await factCheckSelection(menu.selectedText, menu.entryId);
  };

  const truncatedText = menu.selectedText.length > 40
    ? menu.selectedText.slice(0, 37) + '...'
    : menu.selectedText;

  return (
    <div
      ref={menuRef}
      className="debate-context-menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <button className="debate-context-menu-item" onClick={handleCopy}>
        Copy
      </button>
      <button className="debate-context-menu-item" onClick={handleSearchGoogle}>
        Search Google for &lsquo;{truncatedText}&rsquo;
      </button>
      <button className="debate-context-menu-item" onClick={handleSimilarPovs}>
        Similar POVs for &lsquo;{truncatedText}&rsquo;
      </button>
      {menu.isPoverStatement && (
        <button
          className="debate-context-menu-item debate-context-menu-fact-check"
          onClick={handleFactCheck}
          disabled={!!debateGenerating}
        >
          Fact check
        </button>
      )}
    </div>
  );
}

/** Fact-check result card */
function FactCheckCard({ entry, findQuery = '', matchOffset = 0, findCurrentIndex = -1 }: {
  entry: TranscriptEntry; findQuery?: string; matchOffset?: number; findCurrentIndex?: number;
}) {
  const factCheck = entry.metadata?.fact_check as {
    verdict: string;
    explanation: string;
    checked_text: string;
  } | undefined;

  const verdictClass = factCheck?.verdict
    ? `debate-fact-check-${factCheck.verdict}`
    : '';

  return (
    <div className={`debate-statement debate-type-fact-check debate-speaker-system ${verdictClass}`}>
      <div className="debate-statement-header">
        <span className="debate-statement-speaker">Fact Check</span>
        <span className={`debate-fact-check-verdict ${verdictClass}`}>
          {factCheck?.verdict || 'unknown'}
        </span>
      </div>
      <div className="debate-statement-content markdown-body">
        {findQuery
          ? <HighlightedText text={entry.content} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />
          : <Markdown>{entry.content}</Markdown>}
      </div>
      <TaxonomyRefsSection refs={entry.taxonomy_refs} />
      {entry.policy_refs && entry.policy_refs.length > 0 && (
        <div className="debate-policy-refs-section">
          {entry.policy_refs.map((polId) => (
            <span key={polId} className="debate-policy-pill" title={polId}>
              {polId}
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
  const { activeDebate, debateGenerating, debateError, submitUserOpening, runOpeningStatements, responseLength, setResponseLength, openingOrder, setOpeningOrder } = useDebateStore();
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const userIsPover = activeDebate.user_is_pover;
  const hasAnyOpening = activeDebate.transcript.some((e) => e.type === 'opening');
  const hasUserOpening = activeDebate.transcript.some(
    (e) => e.type === 'opening' && e.speaker === 'user',
  );

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

  // Before any openings have started — let user pick length, order, and start
  if (!hasAnyOpening && !isGenerating) {
    return (
      <div className="debate-action-bar">
        {debateError && <div className="debate-error">{debateError}</div>}
        <div className="debate-action-hint">Set order and depth for opening statements, then begin.</div>
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
                        title="Move up"
                      >&#9650;</button>
                      <button
                        className="debate-opening-order-btn"
                        onClick={() => moveDown(idx)}
                        disabled={idx === openingOrder.length - 1}
                        title="Move down"
                      >&#9660;</button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <div className="debate-action-bar-inner">
          <select
            className="debate-length-select"
            value={responseLength}
            onChange={(e) => setResponseLength(e.target.value as 'brief' | 'medium' | 'detailed')}
            title="Opening statement depth"
          >
            <option value="brief">Brief</option>
            <option value="medium">Medium</option>
            <option value="detailed">Detailed</option>
          </select>
          <button className="btn btn-primary" onClick={() => runOpeningStatements()}>
            Begin Opening Statements
          </button>
        </div>
      </div>
    );
  }

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
const AI_MENTION_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'prometheus', label: 'Prometheus', color: POVER_INFO.prometheus.color },
  { id: 'sentinel', label: 'Sentinel', color: POVER_INFO.sentinel.color },
  { id: 'cassandra', label: 'Cassandra', color: POVER_INFO.cassandra.color },
];

function DebateActions() {
  const { activeDebate, debateGenerating, debateError, askQuestion, crossRespond, requestSynthesis, requestProbingQuestions, responseLength, setResponseLength } = useDebateStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const disabled = isGenerating || sending || activeDebate.phase === 'closed';

  // Filter mention options to active AI povers
  const mentionOptions = AI_MENTION_OPTIONS.filter(o => activeDebate.active_povers.includes(o.id as PoverId));

  const insertMention = (label: string) => {
    // Find the last @ in the input and replace from there
    const atIdx = input.lastIndexOf('@');
    const before = atIdx >= 0 ? input.slice(0, atIdx) : input;
    setInput(`${before}@${label} `);
    setMentionOpen(false);
    setMentionIndex(0);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    // Show mention popup when @ is typed at end or after a space
    const atIdx = val.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
      const afterAt = val.slice(atIdx + 1).toLowerCase();
      // Only show if there's no space after @  (still typing the name)
      if (!afterAt.includes(' ')) {
        setMentionOpen(true);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
  };

  const handleSend = async () => {
    if (!input.trim() || disabled) return;
    const text = input;
    setInput('');
    setMentionOpen(false);
    setSending(true);
    await askQuestion(text);
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => Math.min(i + 1, mentionOptions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionOptions[mentionIndex].label);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
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
        <div className="debate-input-wrapper">
          <input
            ref={inputRef}
            className="debate-input"
            type="text"
            placeholder="Ask a question (@Sentinel to target)..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            disabled={disabled}
          />
          {mentionOpen && mentionOptions.length > 0 && (
            <div className="debate-mention-dropdown">
              {mentionOptions.map((opt, i) => (
                <div
                  key={opt.id}
                  className={`debate-mention-item${i === mentionIndex ? ' selected' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(opt.label); }}
                >
                  <span style={{ color: opt.color, fontWeight: 600 }}>{opt.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <select
          className="debate-length-select"
          value={responseLength}
          onChange={(e) => setResponseLength(e.target.value as 'brief' | 'medium' | 'detailed')}
          title="Response depth"
        >
          <option value="brief">Brief</option>
          <option value="medium">Medium</option>
          <option value="detailed">Detailed</option>
        </select>
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
        <button
          className="btn debate-synthesis-btn"
          onClick={() => requestSynthesis()}
          disabled={disabled}
          title="Generate a synthesis of agreements, disagreements, and open questions"
        >
          Synthesize
        </button>
        <button
          className="btn debate-probe-btn"
          onClick={() => requestProbingQuestions()}
          disabled={disabled}
          title="Get AI-suggested probing questions to deepen the debate"
        >
          Probe
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
    runClarification, runOpeningStatements, saveDebate, compressOldTranscript,
  } = useDebateStore();
  const { runSemanticSearch, setFindQuery: setStoreFindQuery, setFindMode: setStoreFindMode, setToolbarPanel } = useTaxonomyStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasTriggeredClarification = useRef(false);
  const hasTriggeredOpening = useRef(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showCCDetails, setShowCCDetails] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSimilarPovSearch = useCallback((query: string) => {
    setStoreFindQuery(query);
    setStoreFindMode('semantic');
    setToolbarPanel('search');
    runSemanticSearch(query, new Set(), new Set());
  }, [runSemanticSearch, setStoreFindQuery, setStoreFindMode, setToolbarPanel]);

  // ── Find state ────────────────────────────────────────
  const [findVisible, setFindVisible] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCurrentIndex, setFindCurrentIndex] = useState(0);

  const { findTotal, findOffsets } = useMemo(() => {
    if (!findQuery || !activeDebate) return { findTotal: 0, findOffsets: new Map<string, number>() };
    const offsets = new Map<string, number>();
    let total = 0;
    for (const entry of activeDebate.transcript) {
      const count = countOccurrences(entry.content, findQuery);
      if (count > 0) { offsets.set(entry.id, total); total += count; }
    }
    return { findTotal: total, findOffsets: offsets };
  }, [findQuery, activeDebate?.transcript]);

  useEffect(() => { setFindCurrentIndex(0); }, [findQuery, findTotal]);

  useEffect(() => {
    if (!findVisible || findTotal === 0) return;
    document.querySelector(`[data-find-index="${findCurrentIndex}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [findCurrentIndex, findVisible, findQuery, findTotal]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFindVisible(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const findNext = useCallback(() => {
    if (findTotal === 0) return;
    setFindCurrentIndex(i => (i + 1) % findTotal);
  }, [findTotal]);

  const findPrev = useCallback(() => {
    if (findTotal === 0) return;
    setFindCurrentIndex(i => (i - 1 + findTotal) % findTotal);
  }, [findTotal]);

  const closeFind = useCallback(() => {
    setFindVisible(false);
    setFindQuery('');
  }, []);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDebate?.transcript.length]);

  // Phase 8: Auto-save debounced (2s after last change)
  useEffect(() => {
    if (!activeDebate) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveDebate();
    }, 2000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [activeDebate?.transcript.length, activeDebate?.updated_at, saveDebate]);

  // Phase 8: Auto-compress context when transcript grows large
  useEffect(() => {
    if (!activeDebate || debateGenerating) return;
    if (activeDebate.transcript.length >= 16) {
      const lastSummaryIdx = activeDebate.context_summaries.length > 0
        ? activeDebate.transcript.findIndex(
            (e) => e.id === activeDebate.context_summaries[activeDebate.context_summaries.length - 1].up_to_entry_id,
          )
        : -1;
      const uncompressed = activeDebate.transcript.length - (lastSummaryIdx + 1) - 8;
      if (uncompressed >= 8) {
        compressOldTranscript();
      }
    }
  }, [activeDebate?.transcript.length, debateGenerating]);

  // Phase 7: Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    if (!selectedText) return; // No selection → use default browser menu

    e.preventDefault();

    // Walk up from the selection's anchor to find the statement card
    let node = selection?.anchorNode as HTMLElement | null;
    let entryId = '';
    let isPoverStatement = false;
    while (node && node !== e.currentTarget) {
      if (node.dataset?.entryId) {
        entryId = node.dataset.entryId;
        isPoverStatement = node.dataset.isPover === 'true';
        break;
      }
      node = node.parentElement;
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      selectedText,
      entryId,
      isPoverStatement,
    });
  }, []);

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

  // Opening statements are now manually triggered via the OpeningActions button
  // (no auto-trigger — user picks depth first)

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
  const isCrossCutting = activeDebate.source_type === 'cross-cutting';

  return (
    <div className="debate-workspace">
      {/* Topic bar */}
      <div className="debate-topic-bar">
        <span className="debate-phase-indicator">
          {PHASE_TITLES[activeDebate.phase] || activeDebate.phase}
        </span>
        <span className="debate-topic-text">{activeDebate.topic.final}</span>
        {isCrossCutting && (
          <button
            className="btn btn-sm debate-cc-details-btn"
            onClick={() => setShowCCDetails(true)}
            title="View cross-cutting context used for this debate"
          >
            Details
          </button>
        )}
      </div>

      {/* Cross-cutting context dialog */}
      {showCCDetails && activeDebate.source_content && (
        <div className="dialog-overlay" onClick={() => setShowCCDetails(false)}>
          <div className="dialog debate-cc-details-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="debate-cc-details-header">
              <h3>Cross-Cutting Context</h3>
              {activeDebate.source_ref && (
                <span className="debate-source-ref">{activeDebate.source_ref}</span>
              )}
              <button className="debate-inspect-close" onClick={() => setShowCCDetails(false)} title="Close">×</button>
            </div>
            <div className="debate-cc-details-body">
              <DebateSourceViewer
                content={activeDebate.source_content}
                sourceType="document"
                sourceRef={activeDebate.source_ref}
              />
            </div>
          </div>
        </div>
      )}

      {/* Refined topic editor (shown after synthesis, only during clarification) */}
      {activeDebate.topic.refined && activeDebate.phase === 'clarification' && (
        <RefinedTopicEditor />
      )}

      {/* Find bar */}
      {findVisible && (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          current={findCurrentIndex}
          total={findTotal}
          onPrev={findPrev}
          onNext={findNext}
          onClose={closeFind}
        />
      )}

      {/* Transcript */}
      <div className="debate-transcript" onContextMenu={handleContextMenu}>
        {activeDebate.transcript.length === 0 && !debateGenerating && (
          <div className="debate-transcript-empty">
            The debate is ready to begin. Clarification questions will appear here.
          </div>
        )}
        {activeDebate.transcript.map((entry, idx) => {
          const matchOffset = findOffsets.get(entry.id) ?? 0;
          const card = entry.type === 'probing'
            ? <ProbingCard key={entry.id} entry={entry} />
            : entry.type === 'fact-check'
            ? <FactCheckCard key={entry.id} entry={entry} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />
            : <StatementCard key={entry.id} entry={entry} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />;
          return (
            <div key={entry.id} className="debate-entry-wrapper">
              {card}
              <EntryDeleteControls entry={entry} totalEntries={activeDebate.transcript.length} entryIndex={idx} />
            </div>
          );
        })}
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

      {/* Phase 7: Context menu */}
      {contextMenu && (
        <DebateContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onSimilarPovSearch={handleSimilarPovSearch}
        />
      )}
    </div>
  );
}

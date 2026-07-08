// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { POVER_INFO, DEBATE_AUDIENCES } from '../../types/debate';
import type { SpeakerId, DebateAudience } from '../../types/debate';
import { AI_POVERS } from '@lib/debate/types';
import { speakerLabel } from './utils';
import type { AdaptivePhase } from './utils';
import { ADAPTIVE_PHASES, ADAPTIVE_PHASE_LABELS, ADAPTIVE_PHASE_COLORS } from './utils';
import { HarvestDialog } from '../shared/HarvestDialog';
import { ReflectionsPanel } from '../shared/ReflectionsPanel';
import { NewsReportModal } from '../shared/NewsReportModal';
import { useTierInfo } from '../../hooks/useTierInfo';
import { isElectronMode } from '@bridge';
import { useFlag } from '../../hooks/useFeatureFlags';
import { triggerManualDump } from '../../lib/flightRecorderInit';

export function ProgressIndicator() {
  const { debateActivity, debateProgress } = useDebateStore(
    useShallow(s => ({ debateActivity: s.debateActivity, debateProgress: s.debateProgress }))
  );

  if (!debateActivity) return null;

  return (
    <div className="debate-progress-indicator">
      <span className="debate-progress-activity">{debateActivity}</span>
      {debateProgress && (debateProgress.attempt > 1 || debateProgress.phase === 'retry') && (
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

const BUDGET_WARN_THRESHOLD = 0.8;
const BUDGET_URGENT_THRESHOLD = 0.95;

function formatResetTime(resetsAt: string): string {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return 'resets soon';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `resets in ${hours}h ${mins}m`;
  return `resets in ${mins}m`;
}

export function TokenBudgetIndicator() {
  const { usage } = useTierInfo();
  if (!usage) return null;
  const { tokensToday, resetsAt } = usage.usage;
  const { tokensPerDay } = usage.limits;
  if (!tokensPerDay || tokensPerDay <= 0) return null;
  const pct = tokensToday / tokensPerDay;
  if (pct < 0.01) return null;
  const remaining = Math.max(0, tokensPerDay - tokensToday);
  const remainingK = remaining >= 1000 ? `${Math.round(remaining / 1000)}k` : String(remaining);
  const isUrgent = pct >= BUDGET_URGENT_THRESHOLD;
  const isWarning = pct >= BUDGET_WARN_THRESHOLD;
  const resetLabel = resetsAt ? formatResetTime(resetsAt) : '';
  const levelClass = isUrgent ? ' urgent' : isWarning ? ' warning' : '';
  return (
    <div className={`token-budget-indicator${levelClass}`}>
      {isUrgent ? (
        <span className="token-budget-banner">Almost out of today&#39;s AI budget — this debate may be interrupted. {resetLabel && <span className="token-budget-reset">({resetLabel})</span>}</span>
      ) : isWarning ? (
        <span className="token-budget-banner">You&#39;ve used {Math.round(pct * 100)}% of today&#39;s AI budget. {resetLabel && <span className="token-budget-reset">({resetLabel})</span>}</span>
      ) : null}
      <div className="token-budget-bar"
        title={`${tokensToday.toLocaleString()} / ${tokensPerDay.toLocaleString()} tokens used today${resetLabel ? ` — ${resetLabel}` : ''}`}>
        <div className="token-budget-fill" style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <span className="token-budget-label">{remainingK} left</span>
    </div>
  );
}

export function PhaseProgressBar({ currentPhase, phaseProgress, roundsInPhase, approachingTransition, rationale }: {
  currentPhase: AdaptivePhase;
  phaseProgress: number;
  roundsInPhase: number;
  approachingTransition: boolean;
  rationale?: string;
}) {
  const currentIdx = ADAPTIVE_PHASES.indexOf(currentPhase);

  return (
    <div className="adaptive-phase-bar" title={rationale || `${ADAPTIVE_PHASE_LABELS[currentPhase]} phase, round ${roundsInPhase}`}>
      <div className="adaptive-phase-segments">
        {ADAPTIVE_PHASES.map((phase, idx) => {
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;
          const color = ADAPTIVE_PHASE_COLORS[phase];
          const fillPct = isCompleted ? 100 : isActive ? Math.min(100, phaseProgress * 100) : 0;

          return (
            <div
              key={phase}
              className={`adaptive-phase-segment${isActive ? ' active' : ''}${isCompleted ? ' completed' : ''}`}
              title={`${ADAPTIVE_PHASE_LABELS[phase]}${isActive ? ` — ${Math.round(phaseProgress * 100)}% (round ${roundsInPhase})` : ''}`}
            >
              <div
                className="adaptive-phase-fill"
                style={{ width: `${fillPct}%`, background: color }}
              />
              <span className="adaptive-phase-label">
                {ADAPTIVE_PHASE_LABELS[phase]}
              </span>
            </div>
          );
        })}
      </div>
      {approachingTransition && (
        <span className="adaptive-phase-transition-hint">
          Approaching transition
        </span>
      )}
      {rationale && (
        <span className="adaptive-phase-rationale" title={rationale}>
          {rationale.length > 80 ? rationale.slice(0, 77) + '...' : rationale}
        </span>
      )}
    </div>
  );
}

const SESSION_STEPS = [
  { key: 'clarification', label: 'Refine' },
  { key: 'opening', label: 'Opening' },
  { key: 'debate', label: 'Debate' },
  { key: 'closed', label: 'Complete' },
] as const;

export function SessionPhaseStepper({ phase, roundCount }: { phase: string; roundCount: number }) {
  const stepIdx = SESSION_STEPS.findIndex(s => s.key === phase);
  const activeIdx = stepIdx >= 0 ? stepIdx : (phase === 'setup' || phase === 'edit-claims' ? 0 : -1);

  return (
    <div className="session-stepper">
      {SESSION_STEPS.map((step, idx) => {
        const completed = idx < activeIdx || phase === 'closed';
        const active = idx === activeIdx && phase !== 'closed';
        return (
          <div key={step.key} className={`session-step${completed ? ' completed' : ''}${active ? ' active' : ''}`}>
            <div className="session-step-dot">{completed ? '✓' : idx + 1}</div>
            <span className="session-step-label">
              {step.label}
              {active && step.key === 'debate' && roundCount > 0 ? ` (${roundCount})` : ''}
            </span>
            {idx < SESSION_STEPS.length - 1 && <div className={`session-step-line${completed ? ' completed' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function DebaterToggles() {
  const { activeDebate, togglePover, debateGenerating } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, togglePover: s.togglePover, debateGenerating: s.debateGenerating }))
  );
  if (!activeDebate) return null;

  const allPovers = AI_POVERS;
  const isActive = (p: SpeakerId) => activeDebate.active_povers.includes(p);
  const disabled = !!debateGenerating;

  return (
    <div className="debate-debater-toggles">
      <span className="debate-debater-toggles-label">Debaters:</span>
      {allPovers.map(p => {
        const info = POVER_INFO[p];
        const active = isActive(p);
        const turnCount = activeDebate.transcript.filter(e => e.speaker === p && (e.type === 'statement' || e.type === 'opening')).length;
        return (
          <button
            key={p}
            className={`debate-debater-pill ${active ? 'debate-debater-pill-active' : 'debate-debater-pill-inactive'}`}
            style={active ? { borderColor: info.color, color: info.color } : undefined}
            onClick={() => togglePover(p)}
            disabled={disabled}
            title={active ? `Remove ${info.label} from debate` : `Add ${info.label} to debate`}
          >
            {info.label}{turnCount > 0 ? ` (${turnCount})` : ''}
          </button>
        );
      })}
    </div>
  );
}

const AI_MENTION_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'accelerationist', label: POVER_INFO.accelerationist.label, color: POVER_INFO.accelerationist.color },
  { id: 'safetyist', label: POVER_INFO.safetyist.label, color: POVER_INFO.safetyist.color },
  { id: 'skeptic', label: POVER_INFO.skeptic.label, color: POVER_INFO.skeptic.color },
];

export function DebateActions({ showParamHistory, setShowParamHistory, showEvaluation, setShowEvaluation }: { showParamHistory: boolean; setShowParamHistory: (v: boolean) => void; showEvaluation: boolean; setShowEvaluation: (v: boolean) => void }) {
  const { activeDebate, debateGenerating, debateError, debateRetryAction, dailyLimitPaused, askQuestion, crossRespond, requestSynthesis, requestProbingQuestions, requestReflections, audience, setAudience, toggleStepMode, setDebatePhase, setError } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError, debateRetryAction: s.debateRetryAction, dailyLimitPaused: s.dailyLimitPaused, askQuestion: s.askQuestion, crossRespond: s.crossRespond, requestSynthesis: s.requestSynthesis, requestProbingQuestions: s.requestProbingQuestions, requestReflections: s.requestReflections, audience: s.audience, setAudience: s.setAudience, toggleStepMode: s.toggleStepMode, setDebatePhase: s.setDebatePhase, setError: s.setError }))
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showHarvest, setShowHarvest] = useState(false);
  const [showReflections, setShowReflections] = useState(false);
  const [showNewsReport, setShowNewsReport] = useState(false);
  const [crossRespondTurns, setCrossRespondTurns] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const showAdminControls = isElectronMode() || useFlag('permission-admin-features');
  const hasSynthesis = activeDebate?.transcript.some(e => e.type === 'concluding') || false;
  const isAdaptive = (activeDebate as any)?.adaptive_staging?.enabled ?? false;
  const isStepMode = (activeDebate as any)?.adaptive_staging?.step_mode ?? false;
  const currentAdaptivePhase = (activeDebate as any)?.adaptive_staging?.current_phase as AdaptivePhase | undefined;

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const isClosed = activeDebate.phase === 'closed';
  const disabled = isGenerating || sending || isClosed;
  const disableAnalysis = isGenerating || sending;
  const isSocratic = (activeDebate.active_povers ?? []).filter(p => p !== 'user').length < 2;

  const mentionOptions = AI_MENTION_OPTIONS.filter(o => activeDebate.active_povers.includes(o.id as SpeakerId));

  const insertMention = (label: string) => {
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
    const atIdx = val.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
      const afterAt = val.slice(atIdx + 1).toLowerCase();
      if (!afterAt.includes(' ')) {
        setMentionOpen(true);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
  };

  const handleSend = async () => {
    if (!input.trim() || disableAnalysis) return;
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
      void handleSend();
    }
  };

  const handleCrossRespond = async () => {
    if (disableAnalysis) return;
    setSending(true);
    if (isAdaptive && isStepMode) {
      await crossRespond();
    } else if (isAdaptive) {
      const maxSafetyRounds = 50;
      const alreadyTerminated = (activeDebate as any)?.adaptive_staging?.phase_state?.current_phase === 'terminated'
        || activeDebate.phase === 'closed';
      if (alreadyTerminated) {
        await crossRespond();
      } else {
        let consecutiveNoStatement = 0;
        for (let i = 0; i < maxSafetyRounds; i++) {
          const d = useDebateStore.getState().activeDebate;
          if (!d) break;
          if ((d as any).adaptive_staging?.phase_state?.current_phase === 'terminated') break;
          const preLen = d.transcript.length;
          await crossRespond();
          const post = useDebateStore.getState().activeDebate;
          if (!post) break;
          const hasStatement = post.transcript.slice(preLen).some((e: any) => e.type === 'statement');
          if (hasStatement) {
            consecutiveNoStatement = 0;
          } else {
            consecutiveNoStatement++;
            if (consecutiveNoStatement >= 3) break;
          }
        }
        const final = useDebateStore.getState().activeDebate;
        const finalStatements = final?.transcript.filter((e: any) => e.type === 'statement').length ?? 0;
        if (finalStatements >= 3) {
          await requestSynthesis();
        }
      }
    } else {
      for (let i = 0; i < crossRespondTurns; i++) {
        await crossRespond();
        if (!useDebateStore.getState().activeDebate) break;
      }
    }
    setSending(false);
  };

  return (
    <div className="debate-action-bar">
      {debateError && (
        <div className={dailyLimitPaused ? 'debate-daily-limit' : 'debate-error'}>
          <span className={dailyLimitPaused ? 'debate-daily-limit-text' : 'debate-error-text'}>{debateError}</span>
          {!dailyLimitPaused && (
            <button className="debate-error-retry" onClick={() => {
              const action = debateRetryAction;
              setError(null);
              if (action === 'synthesis') void requestSynthesis();
              else if (action === 'probing') void requestProbingQuestions();
              else if (action === 'reflections') void requestReflections();
              else void handleCrossRespond();
            }} disabled={disableAnalysis}>Retry</button>
          )}
          <button className={dailyLimitPaused ? 'debate-daily-limit-dismiss' : 'debate-error-dismiss'} onClick={() => setError(null)} title="Dismiss" aria-label="Dismiss">&times;</button>
        </div>
      )}
      <TokenBudgetIndicator />
      <div className="debate-action-bar-inner">
        <div className="debate-input-wrapper">
          <input
            ref={inputRef}
            className="debate-input"
            type="text"
            placeholder="Ask a question (@Safetyist to target)..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            disabled={disableAnalysis}
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
        <button
          className="btn btn-primary debate-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || disableAnalysis}
        >
          Send
        </button>
        {!isSocratic && (isAdaptive ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn debate-continue-btn"
              onClick={handleCrossRespond}
              disabled={disableAnalysis}
              title={isStepMode ? 'Run one debate round' : 'Let the debate engine select the next speaker and run to completion'}
            >
              {isStepMode ? 'Step' : 'Continue'}
            </button>
            <button
              className={`btn btn-sm debate-step-toggle${isStepMode ? ' active' : ''}`}
              onClick={() => void toggleStepMode()}
              disabled={disableAnalysis}
              title={isStepMode ? 'Switch to auto mode (run all stages)' : 'Switch to step mode (1 round at a time, manual phase control)'}
              style={{ fontSize: '0.65rem', padding: '2px 6px' }}
            >
              {isStepMode ? 'Step' : 'Auto'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <button
              className="btn debate-cross-btn"
              onClick={handleCrossRespond}
              disabled={disableAnalysis}
              title={`Run ${crossRespondTurns} cross-respond round${crossRespondTurns > 1 ? 's' : ''}`}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
              Cross-Respond
            </button>
            <select
              className="debate-turns-select"
              value={crossRespondTurns}
              onChange={(e) => setCrossRespondTurns(parseInt(e.target.value, 10))}
              disabled={disableAnalysis}
              title="Number of cross-respond rounds"
            >
              {[1, 2, 3, 6, 9, 12, 15, 18, 21].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {isStepMode && (
        <div className="debate-step-phase-selector">
          <span className="debate-step-phase-label">Stage:</span>
          {ADAPTIVE_PHASES.map(phase => (
            <button
              key={phase}
              className={`debate-step-phase-pill${currentAdaptivePhase === phase ? ' active' : ''}`}
              style={currentAdaptivePhase === phase ? { borderColor: ADAPTIVE_PHASE_COLORS[phase], color: ADAPTIVE_PHASE_COLORS[phase] } : undefined}
              onClick={() => void setDebatePhase(phase)}
              disabled={disableAnalysis || currentAdaptivePhase === phase}
              title={`Set debate stage to ${ADAPTIVE_PHASE_LABELS[phase]}`}
            >
              {ADAPTIVE_PHASE_LABELS[phase]}
            </button>
          ))}
        </div>
      )}
      <div className="debate-action-bar-secondary">
        <button
          className="btn debate-synthesis-btn"
          onClick={() => void requestSynthesis()}
          disabled={disableAnalysis || hasSynthesis}
          title={hasSynthesis ? 'Synthesis already generated' : 'Generate a synthesis of agreements, disagreements, and open questions'}
        >
          Synthesize
        </button>
        <button
          className="btn debate-probe-btn"
          onClick={() => void requestProbingQuestions()}
          disabled={disableAnalysis || isClosed}
          title="Get AI-suggested probing questions to deepen the debate"
        >
          Probe
        </button>
        {showAdminControls && (
          <button
            className="btn debate-harvest-btn"
            onClick={() => setShowHarvest(true)}
            disabled={disableAnalysis || !hasSynthesis}
            title="Harvest debate findings into the taxonomy"
          >
            Harvest
          </button>
        )}
        <button
          className="btn debate-reflections-btn"
          onClick={() => { setShowReflections(true); void requestReflections(); }}
          disabled={disableAnalysis}
          title="Each debater reflects on the debate and proposes taxonomy edits"
        >
          Reflections
        </button>
        <button
          className="btn"
          onClick={() => setShowNewsReport(true)}
          disabled={disableAnalysis || !hasSynthesis}
          title={hasSynthesis ? 'Generate a news-style article from this debate' : 'Synthesis required before generating news report'}
        >
          News Report
        </button>
        <button
          className={`btn${showEvaluation ? ' active' : ''}`}
          onClick={() => setShowEvaluation(!showEvaluation)}
          disabled={!activeDebate?.neutral_evaluations?.length}
          title="Show/hide independent evaluation of claims and cruxes"
        >
          Evaluation
        </button>
        {showAdminControls && (
          <button
            className="btn"
            onClick={() => setShowParamHistory(!showParamHistory)}
            title="View calibration parameter history and current values"
            style={{ fontSize: '0.65rem' }}
          >
            Calibration
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="debate-dump-inline"
          onClick={triggerManualDump}
          title="Export flight recorder (Ctrl+Alt+D)"
          aria-label="Export flight recorder"
        >
          ↓
        </button>
        <select
          className="debate-audience-select"
          value={audience}
          onChange={(e) => setAudience(e.target.value as DebateAudience)}
          disabled={disabled}
          title="Target audience for debate responses"
        >
          {DEBATE_AUDIENCES.map(a => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>
      {isGenerating && (
        <div className="debate-action-hint">
          {speakerLabel(debateGenerating)} is responding...
        </div>
      )}
      {showHarvest && <HarvestDialog onClose={() => setShowHarvest(false)} />}
      {showReflections && <ReflectionsPanel onClose={() => setShowReflections(false)} />}
      {showNewsReport && <NewsReportModal onClose={() => setShowNewsReport(false)} />}
    </div>
  );
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import type { TextareaHTMLAttributes, CSSProperties, Dispatch, SetStateAction } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore, MODELS_BY_BACKEND, AI_BACKENDS, DEBATE_TIERS, FALLBACK_CHAINS, initAIModels, backendForModel } from '../../hooks/useTaxonomyStore';
import type { AIBackend } from '../../hooks/useTaxonomyStore';
import { POVER_INFO, DEBATE_AUDIENCES } from '../../types/debate';
import type { SpeakerId, DebateSourceType, DebateAudience } from '../../types/debate';
import { DEBATE_PROTOCOLS } from '../../data/debateProtocols';
import { AI_POVERS } from '@lib/debate/types';
import { CampGlyph, povToCamp } from '../shared/CampGlyph';
import './NewDebateDialog.css';
import { generateDebateTitlePrompt } from '../../prompts/newDebateDialog';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { loadProvisionalWeights } from '@lib/debate/phaseTransitions';
import { resolveMultiProviderModels } from '@lib/ai-client/modelRouter';
import { useTierInfo, isFreeTier, type TierInfo } from '../../hooks/useTierInfo';
import { useGeminiOnboarding } from '../../hooks/useGeminiOnboarding';
import { GeminiOnboardingModal } from '../settings/GeminiOnboardingModal';
import { buildDebateOptions } from './newDebateOptions';

// Ollama (local quantized models) cannot reliably produce structured JSON for debate pipelines.
const DEBATE_EXCLUDED_BACKENDS = new Set(['ollama']);

export type DialecticalStyle = 'adversarial' | 'deliberative' | 'integrative';

const STYLE_PRESETS: { id: DialecticalStyle; label: string; desc: string }[] = [
  { id: 'adversarial', label: 'Adversarial', desc: 'Direct challenge. Western academic debate norms.' },
  { id: 'deliberative', label: 'Deliberative', desc: 'Consensus-oriented. Longer exploration, faster synthesis.' },
  { id: 'integrative', label: 'Integrative', desc: 'Harmony-seeking. Reframing over rebuttal.' },
];

interface NewDebateDialogProps {
  onClose: () => void;
}

const SOURCE_ICONS: Record<DebateSourceType, string> = {
  topic: '✏️',     // pencil
  document: '📄',  // page
  url: '🌐',       // globe
  situations: '📋', // clipboard (unused but typed)
  other: '📦',     // package
};

const FORMAT_ICONS: Record<string, string> = {
  structured: '⚖️',    // scales
  socratic: '🧐',      // thinking face
  deliberation: '🤝',  // handshake
};

const DEBATER_ICONS: Record<string, string> = {
  accelerationist: '⚡',   // lightning
  safetyist: '🛡️',  // shield
  skeptic: '🔮',  // crystal ball
  user: '👤',       // silhouette
};

/**
 * Textarea that grows to fit its content (t/909). Expands as the user types or
 * pastes, collapses when text is removed, and starts scrolling once it reaches
 * `maxHeight`. `rows` still sets the minimum height. Drop-in for <textarea>.
 */
function AutoGrowTextarea({
  value,
  maxHeight = 320,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { maxHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, maxHeight]);
  return <textarea ref={ref} value={value} {...props} />;
}

// Help copy for audiences (DEBATE_AUDIENCES carries only id+label) — used by the
// config info modal (t/911). Display text, not an AI prompt.
const AUDIENCE_DESCRIPTIONS: Record<string, string> = {
  policymakers: 'Frames arguments around policy levers, governance, and real-world decisions and tradeoffs.',
  technical_researchers: 'Emphasizes mechanisms, evidence, and technical precision over rhetoric.',
  industry_leaders: 'Focuses on strategy, deployment, incentives, and commercial/operational impact.',
  academic_community: 'Prioritizes rigor, citations, and engagement with the scholarly literature.',
  general_public: 'Uses plain language and accessible framing, minimizing jargon.',
};

/**
 * Explainer modal for the New Debate configuration options (t/911). Covers
 * Format, Dialectical Style, Target Audience, and Debaters with descriptions
 * sourced from the same data the selectors use, so copy stays in sync.
 */
function ConfigInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-overlay ndd-info-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        className="ndd-info-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ndd-info-modal-header">
          <h2 className="ndd-info-title">Debate configuration guide</h2>
          <button type="button" className="btn ndd-info-close" onClick={onClose} aria-label="Close guide">×</button>
        </div>
        <p className="ndd-info-subtitle">
          What each setup option controls and what to expect.
        </p>

        <section className="ndd-info-section">
          <h3 className="ndd-info-section-title">Format</h3>
          <p className="ndd-info-intro">How the debate is structured and how speakers take turns.</p>
          {DEBATE_PROTOCOLS.map(p => (
            <div key={p.id} className="ndd-info-item">
              <div className="ndd-info-item-name">{p.label}</div>
              <div className="ndd-info-item-desc">{p.description}</div>
            </div>
          ))}
        </section>

        <section className="ndd-info-section">
          <h3 className="ndd-info-section-title">Dialectical Style</h3>
          <p className="ndd-info-intro">The tone debaters take toward each other's arguments.</p>
          {STYLE_PRESETS.map(s => (
            <div key={s.id} className="ndd-info-item">
              <div className="ndd-info-item-name">{s.label}</div>
              <div className="ndd-info-item-desc">{s.desc}</div>
            </div>
          ))}
        </section>

        <section className="ndd-info-section">
          <h3 className="ndd-info-section-title">Target Audience</h3>
          <p className="ndd-info-intro">Who the debate is written for — shapes framing, depth, and vocabulary.</p>
          {DEBATE_AUDIENCES.map(a => (
            <div key={a.id} className="ndd-info-item">
              <div className="ndd-info-item-name">{a.label}</div>
              <div className="ndd-info-item-desc">{AUDIENCE_DESCRIPTIONS[a.id] ?? ''}</div>
            </div>
          ))}
        </section>

        <section className="ndd-info-section">
          <h3 className="ndd-info-section-title">Debaters</h3>
          <p className="ndd-info-intro">The three perspectives that argue the topic (pick any combination).</p>
          {AI_POVERS.map((id) => {
            const info = POVER_INFO[id];
            return (
              <div key={id} className="ndd-info-item">
                <div className="ndd-info-item-name">{DEBATER_ICONS[id]} {info.label}</div>
                <div className="ndd-info-item-desc">{info.personality}</div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

// Module-level helpers extracted from handleStart / render for complexity (ADR-007, t/1915);
// logic + JSX moved verbatim. Sentinel below signals multi-provider resolution failure so
// handleStart can early-abort (preserving the original `setCreating(false); return;`).
const RESOLVE_FAILED = Symbol('resolve-failed');

// Resolve per-speaker models for multi-provider mode; RESOLVE_FAILED on failure (records ADR-003).
function resolveDebateSpeakerModels(
  modelTier: 'basic' | 'advanced',
  activeBackends: string[],
  povers: SpeakerId[],
): Record<string, string> | undefined | typeof RESOLVE_FAILED {
  try {
    const aiSpeakers = povers.filter(p => p !== 'user');
    const registry = { backends: AI_BACKENDS.map(b => ({ id: b.value, label: b.label })), models: [], debateTiers: DEBATE_TIERS };
    return resolveMultiProviderModels(modelTier, activeBackends, aiSpeakers, registry);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'new-debate-dialog',
      level: 'error',
      message: 'Failed to resolve multi-provider models',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return RESOLVE_FAILED;
  }
}

function buildCreationWeights(confrontationRounds: number, argumentationRounds: number, concludingRounds: number) {
  try { const w = loadProvisionalWeights(); const p = w.pacing_presets?.moderate; return { pacing: 'moderate', maxTotalRounds: p?.maxTotalRounds, argumentationExit: p?.argumentationExit, concludingExit: p?.concludingExit, phase_bounds: w.phase_bounds, overrides: { confrontation: confrontationRounds, argumentation: argumentationRounds, concluding: concludingRounds } }; } catch { /* telemetry — silent by design: weights unavailable is non-fatal */ return null; }
}

function buildDebateSourceArgs(sourceType: DebateSourceType, sourceRef: string, finalContent: string): { sourceTypeArg: DebateSourceType; sourceRefArg: string; contentArg: string } {
  return {
    sourceTypeArg: sourceType === 'other' ? 'topic' : sourceType,
    sourceRefArg: sourceType === 'topic' || sourceType === 'other' ? '' : sourceRef.trim(),
    contentArg: sourceType === 'topic' || sourceType === 'other' ? '' : finalContent,
  };
}

function computeDebateModelOverride(multiProvider: boolean, useCustomModel: boolean, customModel: string): string | undefined {
  return multiProvider ? undefined : (useCustomModel ? customModel : undefined);
}

function buildDebateCreatedData(p: {
  id: string;
  sourceType: DebateSourceType;
  povers: SpeakerId[];
  userIsPover: boolean;
  effectiveModel: string;
  protocolId: string;
  temperature: number;
  audience: DebateAudience;
  stepMode: boolean;
  multiProvider: boolean;
  modelTier: 'basic' | 'advanced';
  speakerModels: Record<string, string> | undefined;
  stageModels: { brief: string; plan: string; cite: string };
  creationWeights: ReturnType<typeof buildCreationWeights>;
}): Record<string, unknown> {
  return { debate_id: p.id, source_type: p.sourceType, povers: p.povers, user_is_pover: p.userIsPover, model: p.effectiveModel, protocol: p.protocolId, temperature: p.temperature, audience: p.audience || null, adaptive_staging: true, step_mode: p.stepMode || undefined, multi_provider: p.multiProvider || undefined, model_tier: p.multiProvider ? p.modelTier : undefined, speaker_models: p.speakerModels || undefined, stage_models: (p.stageModels.brief || p.stageModels.plan || p.stageModels.cite) ? p.stageModels : undefined, ...p.creationWeights && { adaptive_config: p.creationWeights } };
}

function computeActiveModel(freeTier: boolean, tierInfo: TierInfo | null, useCustomModel: boolean, customModel: string, globalModel: string): string {
  return freeTier && tierInfo?.pinnedModel ? tierInfo.pinnedModel : (useCustomModel ? customModel : globalModel);
}

function computeActiveModelHasKey(activeModelExcluded: boolean, hasApiKey: Record<string, boolean>, activeModelBackend: string, freeTier: boolean, tierInfo: TierInfo | null): boolean {
  return !activeModelExcluded && (hasApiKey[activeModelBackend] !== false || (freeTier && tierInfo!.allowedBackends.includes(activeModelBackend)));
}

function temperatureLabelFor(temperature: number): string {
  return temperature <= 0.3 ? 'Focused' : temperature <= 0.7 ? 'Balanced' : temperature <= 1.0 ? 'Creative' : 'Wild';
}

// State-driven inline style for a multi-provider backend chip (kept inline per design).
function backendChipStyle(isExcluded: boolean, hasModel: unknown, isLastActive: boolean): CSSProperties {
  return {
    padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem',
    cursor: (!isExcluded && isLastActive) ? 'not-allowed' : 'pointer',
    opacity: isExcluded ? 0.4 : 1,
    background: isExcluded ? 'var(--bg-tertiary)' : hasModel ? 'var(--accent-bg, rgba(59,130,246,0.15))' : 'var(--bg-tertiary)',
    color: isExcluded ? 'var(--text-muted)' : hasModel ? 'var(--accent, #3b82f6)' : 'var(--text-muted)',
    border: `1px solid ${isExcluded ? 'var(--border)' : hasModel ? 'var(--accent, #3b82f6)' : 'var(--border)'}`,
    textDecoration: isExcluded ? 'line-through' : 'none',
  };
}

// Presentational sub-components (props in → JSX out; no hooks).
interface MultiProviderBackendChipProps {
  b: string; modelTier: 'basic' | 'advanced'; excludedBackends: Set<string>;
  activeBackendsLength: number; setExcludedBackends: Dispatch<SetStateAction<Set<string>>>;
}
function MultiProviderBackendChip({ b, modelTier, excludedBackends, activeBackendsLength, setExcludedBackends }: MultiProviderBackendChipProps) {
  const tierModels = DEBATE_TIERS[modelTier];
  const hasModel = tierModels && tierModels[b];
  const isExcluded = excludedBackends.has(b);
  const isLastActive = !isExcluded && activeBackendsLength <= 2;
  return (
    <button
      type="button"
      disabled={!isExcluded && isLastActive}
      title={isExcluded ? `Click to include ${b}` : isLastActive ? 'At least 2 backends required' : `Click to exclude ${b}`}
      onClick={() => {
        setExcludedBackends(prev => {
          const next = new Set(prev);
          if (next.has(b)) next.delete(b); else next.add(b);
          return next;
        });
      }}
      // eslint-disable-next-line local/no-inline-style -- dynamic: state-driven-chip
      style={backendChipStyle(isExcluded, hasModel, isLastActive)}
    >
      {b} {isExcluded ? '✗' : hasModel ? '✓' : '—'}
    </button>
  );
}


interface ActiveModelMessagesProps {
  activeModelExcluded: boolean; activeModelBackend: string; activeModelHasKey: boolean;
  freeTier: boolean; tierInfo: TierInfo | null; hasApiKey: Record<string, boolean>; fallbackWarnings: string[];
}
function ActiveModelMessages({ activeModelExcluded, activeModelBackend, activeModelHasKey, freeTier, tierInfo, hasApiKey, fallbackWarnings }: ActiveModelMessagesProps) {
  return (
    <>
      {activeModelExcluded && (
        <div className="ndd-error-text">
          {activeModelBackend} models are not supported for debates. Choose a different model.
        </div>
      )}
      {!activeModelExcluded && !activeModelHasKey && (
        <div className="ndd-error-text">
          No API key configured for {activeModelBackend}.{' '}
          {activeModelBackend === 'gemini' && (
            <>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="ndd-link-inherit">aistudio.google.com/apikey</a>. </>
          )}
          Configure in Settings or choose a different model.
        </div>
      )}
      {freeTier && activeModelHasKey && !hasApiKey[activeModelBackend] && (
        <div className="ndd-info-text">
          Free tier &mdash; {tierInfo!.pinnedModel} &middot; {tierInfo!.limits.requestsPerMinute} req/min &middot; {Math.round(tierInfo!.limits.tokensPerDay / 1000)}K tokens/day
        </div>
      )}
      {activeModelHasKey && fallbackWarnings.length > 0 && (
        <div className="ndd-warning-text">
          Fallback model{fallbackWarnings.length > 1 ? 's' : ''} unavailable (no key): {fallbackWarnings.join(', ')}
        </div>
      )}
    </>
  );
}

interface AiModelSectionProps {
  availableModels: { value: string; label: string }[]; activeModel: string; useCustomModel: boolean;
  freeTier: boolean; tierInfo: TierInfo | null; openModelModal: () => void;
  activeModelExcluded: boolean; activeModelBackend: string; activeModelHasKey: boolean;
  hasApiKey: Record<string, boolean>; fallbackWarnings: string[];
}
function AiModelSection({ availableModels, activeModel, useCustomModel, freeTier, tierInfo, openModelModal, activeModelExcluded, activeModelBackend, activeModelHasKey, hasApiKey, fallbackWarnings }: AiModelSectionProps) {
  return (
    <div className="ndd-model-section">
      <div className="ndd-model-display">
        <span className="ndd-model-badge" title={activeModel}>
          {(() => {
            const entry = availableModels.find(m => m.value === activeModel);
            return entry ? entry.label : activeModel;
          })()}
        </span>
        {useCustomModel && !freeTier && <span className="ndd-model-override-tag">override</span>}
        {freeTier && <span className="ndd-model-override-tag ndd-model-tag-free">free</span>}
        <button
          className="btn btn-sm ndd-models-btn"
          onClick={openModelModal}
          type="button"
          disabled={freeTier}
          title={freeTier ? 'Model is pinned on the free tier' : undefined}
        >
          Models
        </button>
      </div>
      <ActiveModelMessages
        activeModelExcluded={activeModelExcluded}
        activeModelBackend={activeModelBackend}
        activeModelHasKey={activeModelHasKey}
        freeTier={freeTier}
        tierInfo={tierInfo}
        hasApiKey={hasApiKey}
        fallbackWarnings={fallbackWarnings}
      />
    </div>
  );
}

interface DebateConfigColumnProps {
  showConfigInfo: boolean; setShowConfigInfo: (v: boolean) => void;
  protocolId: string; setProtocolId: (v: string) => void;
  multiProvider: boolean; setMultiProvider: (v: boolean) => void;
  availableModels: { value: string; label: string }[];
  activeModel: string; activeModelExcluded: boolean; activeModelBackend: string; activeModelHasKey: boolean;
  useCustomModel: boolean; freeTier: boolean; tierInfo: TierInfo | null;
  hasApiKey: Record<string, boolean>; fallbackWarnings: string[]; openModelModal: () => void;
  backendsWithKeys: string[];
  modelTier: 'basic' | 'advanced'; setModelTier: (v: 'basic' | 'advanced') => void;
  excludedBackends: Set<string>; setExcludedBackends: Dispatch<SetStateAction<Set<string>>>;
  activeBackends: string[];
  dialecticalStyle: DialecticalStyle; setDialecticalStyle: (v: DialecticalStyle) => void;
  confrontationRounds: number; setConfrontationRounds: (v: number) => void;
  argumentationRounds: number; setArgumentationRounds: (v: number) => void;
  concludingRounds: number; setConcludingRounds: (v: number) => void;
  stepMode: boolean; setStepMode: (v: boolean) => void;
  excludeGreatestHits: boolean; setExcludeGreatestHits: (v: boolean) => void;
  showAdvanced: boolean; setShowAdvanced: (v: boolean) => void;
  temperature: number; setTemperature: (v: number) => void; temperatureLabel: string;
  evaluatorModel: string; setEvaluatorModel: (v: string) => void;
  stageModelPreset: 'same' | 'cost-optimized' | 'custom'; setStageModelPreset: (v: 'same' | 'cost-optimized' | 'custom') => void;
  stageModels: { brief: string; plan: string; cite: string }; setStageModels: Dispatch<SetStateAction<{ brief: string; plan: string; cite: string }>>;
  audience: DebateAudience; setAudience: (v: DebateAudience) => void;
  selected: Set<SpeakerId>; toggle: (id: SpeakerId) => void;
  userIsPover: boolean; setUserIsPover: (v: boolean) => void;
}

// Right Column: Configuration.
function DebateConfigColumn({
  showConfigInfo, setShowConfigInfo, protocolId, setProtocolId, multiProvider, setMultiProvider,
  availableModels, activeModel, activeModelExcluded, activeModelBackend, activeModelHasKey,
  useCustomModel, freeTier, tierInfo, hasApiKey, fallbackWarnings, openModelModal,
  backendsWithKeys, modelTier, setModelTier, excludedBackends, setExcludedBackends, activeBackends,
  dialecticalStyle, setDialecticalStyle, confrontationRounds, setConfrontationRounds,
  argumentationRounds, setArgumentationRounds, concludingRounds, setConcludingRounds,
  stepMode, setStepMode, excludeGreatestHits, setExcludeGreatestHits, showAdvanced, setShowAdvanced, temperature, setTemperature, temperatureLabel,
  evaluatorModel, setEvaluatorModel, stageModelPreset, setStageModelPreset, stageModels, setStageModels,
  audience, setAudience, selected, toggle, userIsPover, setUserIsPover,
}: DebateConfigColumnProps) {
  return (
    <div className="ndd-col-right">
      <div className="ndd-config-heading-row">
        <h3 className="ndd-section-heading ndd-config-heading">Configuration</h3>
        <button
          type="button"
          className="btn ndd-learn-btn"
          onClick={() => setShowConfigInfo(true)}
          title="Learn what each configuration option does"
        >
          ⓘ Learn more
        </button>
      </div>
      {showConfigInfo && <ConfigInfoModal onClose={() => setShowConfigInfo(false)} />}

      {/* Format — card view, matching Dialectical Style (t/912) */}
      <label className="ndd-field-label">Format</label>
      <div className="ndd-style-cards">
        {DEBATE_PROTOCOLS.map(p => (
          <label key={p.id} className={`ndd-style-card${protocolId === p.id ? ' active' : ''}`}>
            <input type="radio" name="format" value={p.id} checked={protocolId === p.id} onChange={() => setProtocolId(p.id)} />
            <div className="ndd-style-text">
              <span className="ndd-style-name">{p.label}</span>
              <span className="ndd-style-desc">{p.description}</span>
            </div>
          </label>
        ))}
      </div>

      {/* AI Model */}
      <label className="ndd-field-label">AI Model</label>
      {!multiProvider && (
        <AiModelSection
          availableModels={availableModels}
          activeModel={activeModel}
          useCustomModel={useCustomModel}
          freeTier={freeTier}
          tierInfo={tierInfo}
          openModelModal={openModelModal}
          activeModelExcluded={activeModelExcluded}
          activeModelBackend={activeModelBackend}
          activeModelHasKey={activeModelHasKey}
          hasApiKey={hasApiKey}
          fallbackWarnings={fallbackWarnings}
        />
      )}

      {/* Multi-provider toggle */}
      {/* eslint-disable-next-line local/no-inline-style -- dynamic: conditional-margin */}
      <label className="ndd-model-toggle" style={{ marginTop: multiProvider ? 0 : 6 }}>
        <input
          type="checkbox"
          checked={multiProvider}
          onChange={() => setMultiProvider(!multiProvider)}
          disabled={backendsWithKeys.length < 2}
        />
        Multi-Provider Mode
        {backendsWithKeys.length < 2 && (
          <span className="ndd-toggle-hint">
            (need 2+ backends with keys)
          </span>
        )}
      </label>

      {multiProvider && (
        <div className="ndd-multi-provider-section">
          <div className="ndd-tier-row">
            <label className="ndd-tier-label">Tier:</label>
            <select
              className="ndd-model-select ndd-flex-1"
              value={modelTier}
              onChange={(e) => setModelTier(e.target.value as 'basic' | 'advanced')}
            >
              <option value="basic">Basic (fast / cheap)</option>
              <option value="advanced">Advanced (frontier)</option>
            </select>
          </div>
          <div className="ndd-mp-hint">
            Each speaker gets a different backend. Click to toggle:
          </div>
          <div className="ndd-backend-chips">
            {backendsWithKeys.map(b => (
              <MultiProviderBackendChip
                key={b}
                b={b}
                modelTier={modelTier}
                excludedBackends={excludedBackends}
                activeBackendsLength={activeBackends.length}
                setExcludedBackends={setExcludedBackends}
              />
            ))}
          </div>
        </div>
      )}

      {/* Dialectical Style */}
      <label className="ndd-field-label">Dialectical Style</label>
      <div className="ndd-style-cards">
        {STYLE_PRESETS.map(s => (
          <label key={s.id} className={`ndd-style-card${dialecticalStyle === s.id ? ' active' : ''}`}>
            <input type="radio" name="dialecticalStyle" value={s.id} checked={dialecticalStyle === s.id} onChange={() => setDialecticalStyle(s.id)} />
            <div className="ndd-style-text">
              <span className="ndd-style-name">{s.label}</span>
              <span className="ndd-style-desc">{s.desc}</span>
            </div>
          </label>
        ))}
      </div>

      {/* Phase rounds */}
      <div className="ndd-phase-rounds">
        <span className="ndd-phase-rounds-label">Max rounds per phase</span>
        <div className="ndd-phase-rounds-row">
          <label className="ndd-phase-round-input">
            <span>Confrontation</span>
            <input type="number" min={1} max={6} value={confrontationRounds}
              onChange={(e) => setConfrontationRounds(Math.max(1, Math.min(6, parseInt(e.target.value) || 1)))} />
          </label>
          <label className="ndd-phase-round-input">
            <span>Argumentation</span>
            <input type="number" min={1} max={12} value={argumentationRounds}
              onChange={(e) => setArgumentationRounds(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))} />
          </label>
          <label className="ndd-phase-round-input">
            <span>Concluding</span>
            <input type="number" min={1} max={6} value={concludingRounds}
              onChange={(e) => setConcludingRounds(Math.max(1, Math.min(6, parseInt(e.target.value) || 1)))} />
          </label>
        </div>
      </div>

      {/* Step Mode (visible control) */}
      <label className="ndd-model-toggle ndd-toggle-mt-10">
        <input
          type="checkbox"
          checked={stepMode}
          onChange={() => setStepMode(!stepMode)}
        />
        Step-by-Step Mode
      </label>
      <div className="ndd-step-help">
        Pause after each phase for manual review before advancing. You can also toggle this during a debate.
      </div>

      {/* Greatest-hits exclusion (t/1979) — hard exclusion of the hand-curated greatest-hits node list */}
      <label className="ndd-model-toggle ndd-toggle-mt-10">
        <input
          type="checkbox"
          checked={excludeGreatestHits}
          onChange={() => setExcludeGreatestHits(!excludeGreatestHits)}
        />
        Exclude greatest-hits nodes
      </label>
      <div className="ndd-step-help">
        When on, node selection skips the greatest-hits list (the hand-curated set of the taxonomy&apos;s most frequently used nodes), steering the debate toward less-covered arguments. Skipped nodes are left out entirely, not just ranked lower.
      </div>

      {/* Advanced toggle */}
      <button className="ndd-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? 'Hide advanced' : 'Advanced options'} {showAdvanced ? '▲' : '▼'}
      </button>

      {showAdvanced && (
        <div className="ndd-advanced-section">
          {/* Temperature */}
          <label className="ndd-field-label">Temperature</label>
          <div className="ndd-temperature-row">
            <span className="ndd-temperature-value">{temperature.toFixed(1)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="ndd-temperature-slider"
            />
            <span className="ndd-temperature-label">{temperatureLabel}</span>
          </div>

          {/* Evaluator Model (cross-vendor split) */}
          <label className="ndd-field-label ndd-evaluator-label">Evaluator Model</label>
          <div className="ndd-advanced-help">
            Separate model for claim extraction. Cross-vendor split reduces self-preference bias.
          </div>
          <select
            className="ndd-model-select"
            value={evaluatorModel}
            onChange={(e) => setEvaluatorModel(e.target.value)}
          >
            <option value="">Same as debate model</option>
            {availableModels.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          {/* Stage Models (per-stage model overrides) */}
          <label className="ndd-field-label ndd-stage-label">Stage Models</label>
          <div className="ndd-advanced-help">
            Use cheaper models for Brief/Plan/Cite stages. Draft always uses the main debate model.
          </div>
          <select
            className="ndd-model-select ndd-stage-preset-select"
            value={stageModelPreset}
            onChange={(e) => {
              const preset = e.target.value as 'same' | 'cost-optimized' | 'custom';
              setStageModelPreset(preset);
              if (preset === 'same') {
                setStageModels({ brief: '', plan: '', cite: '' });
              } else if (preset === 'cost-optimized') {
                const cheapModels = availableModels.filter(m => /flash|haiku|llama/i.test(m.label));
                const cheapModel = cheapModels[0]?.value ?? '';
                setStageModels({ brief: cheapModel, plan: '', cite: cheapModel });
              }
            }}
          >
            <option value="same">All same model</option>
            <option value="cost-optimized">Cost-optimized (Brief+Cite on cheap)</option>
            <option value="custom">Custom</option>
          </select>
          {stageModelPreset !== 'same' && (
            <div className="ndd-stage-models-grid">
              {(['brief', 'plan', 'cite'] as const).map(stage => (
                <div key={stage}>
                  <label className="ndd-stage-label-sm">{stage}</label>
                  <select
                    className="ndd-model-select ndd-stage-select"
                    value={stageModels[stage]}
                    onChange={(e) => setStageModels(prev => ({ ...prev, [stage]: e.target.value }))}
                    disabled={stageModelPreset !== 'custom'}
                  >
                    <option value="">Same as debate model</option>
                    {availableModels.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audience */}
      <label className="ndd-field-label">Target Audience</label>
      <div className="ndd-audience-cards">
        {DEBATE_AUDIENCES.map(a => (
          <label key={a.id} className={`ndd-audience-card${audience === a.id ? ' active' : ''}`}>
            <input type="radio" name="audience" value={a.id} checked={audience === a.id} onChange={() => setAudience(a.id)} />
            <span className="ndd-audience-name">{a.label}</span>
          </label>
        ))}
      </div>

      {/* Debaters */}
      <label className="ndd-field-label">Debaters</label>
      <div className="ndd-debaters">
        {AI_POVERS.map((id) => {
          const info = POVER_INFO[id];
          return (
            <label key={id} className={`ndd-debater-row${selected.has(id) ? ' checked' : ''}`}>
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => toggle(id)}
              />
              <span className="ndd-debater-badge" data-camp={povToCamp(id)}>
                <span className="ndd-debater-icon"><CampGlyph camp={povToCamp(id)!} size={14} /></span>
                {info.label}
              </span>
              <span className="ndd-debater-desc">{info.personality}</span>
            </label>
          );
        })}
        <label className={`ndd-debater-row${userIsPover ? ' checked' : ''}`}>
          <input
            type="checkbox"
            checked={userIsPover}
            onChange={() => setUserIsPover(!userIsPover)}
          />
          <span className="ndd-debater-badge ndd-debater-badge-user">
            <span className="ndd-debater-icon">{DEBATER_ICONS.user}</span>
            You
          </span>
          <span className="ndd-debater-desc">Argue a position yourself</span>
        </label>
      </div>

      {selected.size < 1 && (
        <div className="ndd-hint-error">Select at least 1 perspective</div>
      )}
    </div>
  );
}

interface ModelConfigModalProps {
  useCustomModel: boolean; setUseCustomModel: (v: boolean) => void;
  customModel: string; setCustomModel: (v: string) => void; globalModel: string;
  modalBackend: AIBackend; setModalBackend: (v: AIBackend) => void; hasApiKey: Record<string, boolean>;
  handleRefreshModels: () => void | Promise<void>; refreshingModels: boolean; onClose: () => void;
}
function ModelConfigModal({ useCustomModel, setUseCustomModel, customModel, setCustomModel, globalModel, modalBackend, setModalBackend, hasApiKey, handleRefreshModels, refreshingModels, onClose }: ModelConfigModalProps) {
  return (
    <div className="ndd-model-overlay" onClick={onClose}>
      <div className="ndd-model-dialog" onClick={e => e.stopPropagation()}>
        <div className="ndd-model-dialog-header">
          <h3>Model Configuration</h3>
          <button className="ndd-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="ndd-model-dialog-body">
          <label className="ndd-model-toggle">
            <input
              type="checkbox"
              checked={!useCustomModel}
              onChange={() => {
                if (!useCustomModel) {
                  setUseCustomModel(true);
                  setCustomModel(globalModel);
                } else {
                  setUseCustomModel(false);
                }
              }}
            />
            Use global default
          </label>
          {!useCustomModel && (
            <span className="ndd-model-current">Global: {globalModel}</span>
          )}

          {useCustomModel && (
            <>
              <div className="ndd-model-row">
                <label className="ndd-model-row-label">Backend</label>
                <select
                  className="ndd-model-select"
                  value={modalBackend}
                  onChange={(e) => {
                    const backend = e.target.value as AIBackend;
                    setModalBackend(backend);
                    const models = MODELS_BY_BACKEND[backend];
                    if (models?.length) setCustomModel(models[0].value);
                  }}
                >
                  {AI_BACKENDS.filter(b => !DEBATE_EXCLUDED_BACKENDS.has(b.value)).map(b => (
                    <option key={b.value} value={b.value}>
                      {b.label}{hasApiKey[b.value] === false ? ' (no key)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ndd-model-row">
                <label className="ndd-model-row-label">Model</label>
                <select
                  className="ndd-model-select"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  disabled={hasApiKey[modalBackend] === false}
                  title={hasApiKey[modalBackend] === false ? `No API key configured for ${modalBackend}` : undefined}
                >
                  {(MODELS_BY_BACKEND[modalBackend] || []).map(m => (
                    <option key={m.value} value={m.value} disabled={hasApiKey[modalBackend] === false}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {hasApiKey[modalBackend] === false && (
                  <div className="ndd-error-text">
                    No API key for {AI_BACKENDS.find(b => b.value === modalBackend)?.label ?? modalBackend}.{' '}
                    {modalBackend === 'gemini' && (
                      <>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="ndd-link-inherit">aistudio.google.com/apikey</a>. </>
                    )}
                    Configure in Settings to use these models.
                  </div>
                )}
              </div>
            </>
          )}

          <div className="ndd-model-actions">
            <button
              className="btn btn-sm"
              onClick={handleRefreshModels}
              disabled={refreshingModels}
            >
              {refreshingModels ? 'Refreshing...' : 'Refresh Models'}
            </button>
          </div>
        </div>

        <div className="ndd-model-dialog-footer">
          <button
            className="btn btn-primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Screen A: preset system (t/2199) ─────────────────────────────────────────
// Stub values — replaced by debatePresets.ts in t/2202 once PM confirms Q1/Q3.

type BuiltInPresetId = 'quick' | 'deep' | 'socratic';
type PresetId = BuiltInPresetId | 'custom';

const PRESET_DEFAULTS: Record<BuiltInPresetId, {
  protocolId: string;
  dialecticalStyle: DialecticalStyle;
  confrontationRounds: number;
  argumentationRounds: number;
  concludingRounds: number;
  stepMode: boolean;
  modelTier: 'basic' | 'advanced';
}> = {
  quick:    { protocolId: 'structured',   dialecticalStyle: 'adversarial',  confrontationRounds: 2, argumentationRounds: 3, concludingRounds: 1, stepMode: false, modelTier: 'basic'    },
  deep:     { protocolId: 'deliberation', dialecticalStyle: 'deliberative', confrontationRounds: 3, argumentationRounds: 6, concludingRounds: 2, stepMode: false, modelTier: 'advanced' },
  socratic: { protocolId: 'socratic',     dialecticalStyle: 'integrative',  confrontationRounds: 2, argumentationRounds: 4, concludingRounds: 2, stepMode: true,  modelTier: 'basic'    },
};

// Summary/time TBD pending PM answer on Q2.
const SCREEN_A_PRESETS: { id: BuiltInPresetId; label: string; summary: string; estimatedMinutes?: number }[] = [
  { id: 'quick',    label: 'Quick take', summary: '2+3 rounds · basic model',               estimatedMinutes: 8  },
  { id: 'deep',     label: 'Deep dive',  summary: '3+6 rounds · frontier model',             estimatedMinutes: 25 },
  { id: 'socratic', label: 'Socratic',   summary: '2+4 rounds · step-by-step · basic model', estimatedMinutes: 20 },
];

function countSettingsDiff(
  preset: BuiltInPresetId,
  protocolId: string,
  dialecticalStyle: DialecticalStyle,
  confrontationRounds: number,
  argumentationRounds: number,
  concludingRounds: number,
  stepMode: boolean,
  modelTier: 'basic' | 'advanced',
): number {
  const p = PRESET_DEFAULTS[preset];
  let diff = 0;
  if (protocolId !== p.protocolId) diff++;
  if (dialecticalStyle !== p.dialecticalStyle) diff++;
  if (confrontationRounds !== p.confrontationRounds) diff++;
  if (argumentationRounds !== p.argumentationRounds) diff++;
  if (concludingRounds !== p.concludingRounds) diff++;
  if (stepMode !== p.stepMode) diff++;
  if (modelTier !== p.modelTier) diff++;
  return diff;
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const getFocusable = () => Array.from(
      el.querySelectorAll<HTMLElement>(
        'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    );
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [active, ref]);
}

interface PresetCardsProps {
  basePreset: BuiltInPresetId;
  isCustom: boolean;
  onSelect: (id: BuiltInPresetId) => void;
}

function PresetCards({ basePreset, isCustom, onSelect }: PresetCardsProps) {
  const activeId: PresetId = isCustom ? 'custom' : basePreset;

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onSelect(SCREEN_A_PRESETS[(idx + 1) % SCREEN_A_PRESETS.length].id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onSelect(SCREEN_A_PRESETS[(idx - 1 + SCREEN_A_PRESETS.length) % SCREEN_A_PRESETS.length].id);
    }
  };

  return (
    <div className="ndd-preset-group" role="radiogroup" aria-label="Debate preset">
      {SCREEN_A_PRESETS.map((p, idx) => {
        const isSelected = activeId === p.id;
        return (
          <div
            key={p.id}
            className={`ndd-preset-card${isSelected && !isCustom ? ' ndd-preset-card--selected' : ''}`}
            role="radio"
            aria-checked={isSelected && !isCustom}
            tabIndex={isSelected && !isCustom ? 0 : -1}
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            <div className="ndd-preset-card-header">
              {isSelected && !isCustom && <span className="ndd-preset-check" aria-hidden="true">✓</span>}
              <span className="ndd-preset-label">{p.label}</span>
            </div>
            <span className="ndd-preset-summary">{p.summary}</span>
            {p.estimatedMinutes !== undefined && (
              <span className="ndd-preset-time">~{p.estimatedMinutes} min</span>
            )}
          </div>
        );
      })}
      {isCustom && (
        <div
          className="ndd-preset-card ndd-preset-card--selected ndd-preset-card--custom"
          role="radio"
          aria-checked={true}
          tabIndex={0}
        >
          <div className="ndd-preset-card-header">
            <span className="ndd-preset-check" aria-hidden="true">✓</span>
            <span className="ndd-preset-label">Custom</span>
          </div>
          <span className="ndd-preset-summary">
            Based on {SCREEN_A_PRESETS.find(p => p.id === basePreset)?.label ?? 'Quick take'}
          </span>
        </div>
      )}
    </div>
  );
}

async function generateDebateTitle(topic: string): Promise<string> {
  const { text } = await api.generateText(generateDebateTitlePrompt(topic));
  return text.trim().slice(0, 120);
}

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate } = useDebateStore(
    useShallow(s => ({ createDebate: s.createDebate, loadDebate: s.loadDebate }))
  );

  // Screen A preset state (t/2199)
  const [basePreset, setBasePreset] = useState<BuiltInPresetId>('quick');
  const [showSettings, setShowSettings] = useState(false);
  const [showConfigInfo, setShowConfigInfo] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Core debate fields
  const [topic, setTopic] = useState('');
  const [background, setBackground] = useState(''); // Screen B (t/2201)

  // Source fixed to 'topic' for Screen A; other source types deferred to t/2200
  const sourceType: DebateSourceType = 'topic';
  const sourceRef = '';
  const sourceContent = '';

  const [selected, setSelected] = useState<Set<SpeakerId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);
  const [creating, setCreating] = useState(false);
  // Settings — initialized from preset, editable via Screen B (t/2201)
  const [protocolId, setProtocolId] = useState(PRESET_DEFAULTS.quick.protocolId);
  const [dialecticalStyle, setDialecticalStyle] = useState<DialecticalStyle>(PRESET_DEFAULTS.quick.dialecticalStyle);
  const [confrontationRounds, setConfrontationRounds] = useState(PRESET_DEFAULTS.quick.confrontationRounds);
  const [argumentationRounds, setArgumentationRounds] = useState(PRESET_DEFAULTS.quick.argumentationRounds);
  const [concludingRounds, setConcludingRounds] = useState(PRESET_DEFAULTS.quick.concludingRounds);
  const [stepMode, setStepMode] = useState(PRESET_DEFAULTS.quick.stepMode);
  const [modelTier, setModelTier] = useState<'basic' | 'advanced'>(PRESET_DEFAULTS.quick.modelTier);
  const [temperature, setTemperature] = useState(0.7);
  const [audience, setAudience] = useState<DebateAudience>('policymakers');
  const [evaluatorModel, setEvaluatorModel] = useState('');
  const [multiProvider, setMultiProvider] = useState(false);
  const [excludedBackends, setExcludedBackends] = useState<Set<string>>(new Set());
  const [excludeGreatestHits, setExcludeGreatestHits] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stageModelPreset, setStageModelPreset] = useState<'same' | 'cost-optimized' | 'custom'>('same');
  const [stageModels, setStageModels] = useState<{ brief: string; plan: string; cite: string }>({ brief: '', plan: '', cite: '' });

  // Model / backend state
  const { aiBackend, geminiModel } = useTaxonomyStore();
  const globalModel = geminiModel;
  const availableModels = Object.entries(MODELS_BY_BACKEND)
    .filter(([backend]) => !DEBATE_EXCLUDED_BACKENDS.has(backend))
    .flatMap(([backend, models]) =>
      models.map(m => ({ ...m, label: `${m.label} (${backend})` }))
    );
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const saved = localStorage.getItem('taxonomy-editor-last-debate-model');
    return saved ? saved !== globalModel : false;
  });
  const [customModel, setCustomModel] = useState(() => {
    return localStorage.getItem('taxonomy-editor-last-debate-model') || globalModel;
  });
  const [showModelModal, setShowModelModal] = useState(false);
  const [modalBackend, setModalBackend] = useState<AIBackend>(aiBackend);
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({});
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set());
  const [refreshingModels, setRefreshingModels] = useState(false);
  const { tier: tierInfo } = useTierInfo();
  const freeTier = isFreeTier(tierInfo);
  const { modalProps: geminiModalProps, checkAndShow: checkGeminiOnboarding } = useGeminiOnboarding();

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !showSettings && !showModelModal);

  // Derived
  const advancedChangeCount = countSettingsDiff(
    basePreset, protocolId, dialecticalStyle,
    confrontationRounds, argumentationRounds, concludingRounds,
    stepMode, modelTier,
  );
  const isCustom = advancedChangeCount > 0;

  const backendsWithKeys = useMemo(
    () => [...availableBackends].filter(b => !DEBATE_EXCLUDED_BACKENDS.has(b)),
    [availableBackends],
  );
  const activeBackends = useMemo(
    () => backendsWithKeys.filter(b => !excludedBackends.has(b)),
    [backendsWithKeys, excludedBackends],
  );
  const activeModel = computeActiveModel(freeTier, tierInfo, useCustomModel, customModel, globalModel);
  const activeModelBackend = backendForModel(activeModel);
  const activeModelExcluded = DEBATE_EXCLUDED_BACKENDS.has(activeModelBackend);
  const activeModelHasKey = computeActiveModelHasKey(activeModelExcluded, hasApiKey, activeModelBackend, freeTier, tierInfo);
  const fallbackWarnings = useMemo(() => {
    const chain = FALLBACK_CHAINS[activeModel] ?? [];
    if (!chain.length) return [];
    return chain
      .map(m => ({ model: m, backend: backendForModel(m) }))
      .filter(({ backend }) => hasApiKey[backend] === false)
      .map(({ model, backend }) => `${model} (${backend})`);
  }, [activeModel, hasApiKey]);

  useEffect(() => {
    void Promise.all(
      AI_BACKENDS.map(async (b) => {
        const has = await api.hasApiKey(b.value);
        return [b.value, has] as [string, boolean];
      }),
    ).then(results => setHasApiKey(Object.fromEntries(results)))
      .catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'new-debate-dialog', level: 'warn', message: 'hasApiKey check failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
    void api.getAvailableBackends()
      .then(backends => setAvailableBackends(new Set(backends.filter(b => b.available).map(b => b.id))))
      .catch((err) => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'new-debate-dialog',
          level: 'error',
          message: 'Failed to load available AI backends',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      });
  }, [showModelModal]);

  const applyPreset = (id: BuiltInPresetId) => {
    const p = PRESET_DEFAULTS[id];
    setProtocolId(p.protocolId);
    setDialecticalStyle(p.dialecticalStyle);
    setConfrontationRounds(p.confrontationRounds);
    setArgumentationRounds(p.argumentationRounds);
    setConcludingRounds(p.concludingRounds);
    setStepMode(p.stepMode);
    setModelTier(p.modelTier);
  };

  const handleSelectPreset = (id: BuiltInPresetId) => {
    setBasePreset(id);
    applyPreset(id);
  };

  const openModelModal = () => {
    const model = useCustomModel ? customModel : globalModel;
    let resolved: AIBackend | null = null;
    for (const [backend, models] of Object.entries(MODELS_BY_BACKEND)) {
      if (!DEBATE_EXCLUDED_BACKENDS.has(backend) && models.some(m => m.value === model)) {
        resolved = backend as AIBackend;
        break;
      }
    }
    const fallback = AI_BACKENDS.find(b => !DEBATE_EXCLUDED_BACKENDS.has(b.value))?.value ?? 'gemini';
    setModalBackend(resolved ?? fallback as AIBackend);
    setShowModelModal(true);
  };

  const handleRefreshModels = async () => {
    setRefreshingModels(true);
    try {
      await api.refreshAIModels();
      await initAIModels();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'new-debate-dialog',
        level: 'error',
        message: 'Failed to refresh AI models',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    } finally {
      setRefreshingModels(false);
    }
  };

  const toggle = (id: SpeakerId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const canStart = topic.trim().length > 0 && !creating;

  const handleStart = async () => {
    if (!canStart) return;
    setStartError(null);
    // Free-tier/anonymous sessions use the server key — never prompt for a BYOK Gemini key (t/1479).
    await checkGeminiOnboarding({ freeTier });
    setCreating(true);
    try {
      const finalTopic = topic.trim();
      const povers = Array.from(selected);
      if (userIsPover && !povers.includes('user')) povers.push('user');
      const effectiveModel = useCustomModel ? customModel : globalModel;
      localStorage.setItem('taxonomy-editor-last-debate-model', effectiveModel);
      const debateModelOverride = computeDebateModelOverride(multiProvider, useCustomModel, customModel);

      let speakerModels: Record<string, string> | undefined;
      if (multiProvider) {
        const resolved = resolveDebateSpeakerModels(modelTier, activeBackends, povers);
        if (resolved === RESOLVE_FAILED) return;
        speakerModels = resolved;
      }

      const titleForDebate = await generateDebateTitle(finalTopic);
      const { sourceTypeArg, sourceRefArg, contentArg } = buildDebateSourceArgs(sourceType, sourceRef, sourceContent);
      const id = await createDebate(
        finalTopic,
        povers,
        userIsPover,
        sourceTypeArg,
        sourceRefArg,
        contentArg,
        debateModelOverride,
        protocolId,
        temperature,
        audience,
        buildDebateOptions({ debateTitle: titleForDebate, background, evaluatorModel, confrontationRounds, argumentationRounds, concludingRounds, speakerModels, multiProvider, modelTier, stepMode, excludeGreatestHits, stageModels }),
      );
      await loadDebate(id);
      const creationWeights = buildCreationWeights(confrontationRounds, argumentationRounds, concludingRounds);
      getGlobalRecorder()?.record({ type: 'user.action', component: 'new-debate', level: 'info', message: 'debate.created', data: buildDebateCreatedData({ id, sourceType, povers, userIsPover, effectiveModel, protocolId, temperature, audience, stepMode, multiProvider, modelTier, speakerModels, stageModels, creationWeights }) });
      const store = useDebateStore.getState();
      store.updatePhase('clarification');
      await store.saveDebate();
      api.openDebateWindow(id).catch(() => { /* fallback: stays inline */ });
      onClose();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'new-debate-dialog',
        level: 'error',
        message: 'Failed to start debate',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setStartError(err instanceof Error ? err.message : 'Failed to start debate.');
    } finally {
      setCreating(false);
    }
  };

  const temperatureLabel = temperatureLabelFor(temperature);

  return (
    <div className="dialog-overlay" role="presentation" onClick={onClose}>
      {/* Screen A */}
      <div
        ref={dialogRef}
        className="ndd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ndd-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ndd-dialog-header">
          <h2 id="ndd-dialog-title" className="ndd-dialog-title">New Debate</h2>
          <button className="ndd-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="ndd-dialog-body">
          <label className="ndd-topic-primary" htmlFor="ndd-topic">
            What should we debate?<span className="ndd-required-mark" aria-hidden="true"> *</span>
          </label>
          <AutoGrowTextarea
            id="ndd-topic"
            className="form-textarea"
            placeholder="What should we debate?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            autoFocus
          />
          <PresetCards
            basePreset={basePreset}
            isCustom={isCustom}
            onSelect={handleSelectPreset}
          />
        </div>

        <div className="ndd-dialog-footer">
          <div className="ndd-footer-actions">
            <button
              type="button"
              className="ndd-advanced-link btn-link"
              onClick={() => setShowSettings(true)}
            >
              Advanced settings
              {isCustom && (
                <span className="ndd-change-badge" aria-label={`${advancedChangeCount} settings changed`}>
                  {advancedChangeCount}
                </span>
              )}
            </button>
          </div>
          <div className="ndd-footer-right">
            {startError && (
              <span className="ndd-start-error" role="alert">
                {startError}{' '}
                <button type="button" className="ndd-retry-link btn-link" onClick={handleStart}>Retry</button>
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStart}
              disabled={!canStart}
            >
              {creating ? 'Starting…' : 'Start debate'}
            </button>
          </div>
        </div>
      </div>

      {/* Screen B stub — full settings dialog (t/2201) */}
      {showSettings && (
        <div className="ndd-settings-overlay" role="presentation" onClick={() => setShowSettings(false)}>
          <div
            className="ndd-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ndd-settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ndd-settings-header">
              <button type="button" className="btn-link ndd-back-btn" onClick={() => setShowSettings(false)} aria-label="Back to debate setup">
                ← Back
              </button>
              <h2 id="ndd-settings-title" className="ndd-settings-title">Advanced settings</h2>
              <button className="ndd-close-btn" onClick={onClose} aria-label="Close">&times;</button>
            </div>
            <div className="ndd-settings-body">
              <DebateConfigColumn
                showConfigInfo={showConfigInfo} setShowConfigInfo={setShowConfigInfo}
                protocolId={protocolId} setProtocolId={setProtocolId}
                multiProvider={multiProvider} setMultiProvider={setMultiProvider}
                availableModels={availableModels} activeModel={activeModel}
                activeModelExcluded={activeModelExcluded} activeModelBackend={activeModelBackend} activeModelHasKey={activeModelHasKey}
                useCustomModel={useCustomModel} freeTier={freeTier} tierInfo={tierInfo}
                hasApiKey={hasApiKey} fallbackWarnings={fallbackWarnings} openModelModal={openModelModal}
                backendsWithKeys={backendsWithKeys}
                modelTier={modelTier} setModelTier={setModelTier}
                excludedBackends={excludedBackends} setExcludedBackends={setExcludedBackends} activeBackends={activeBackends}
                dialecticalStyle={dialecticalStyle} setDialecticalStyle={setDialecticalStyle}
                confrontationRounds={confrontationRounds} setConfrontationRounds={setConfrontationRounds}
                argumentationRounds={argumentationRounds} setArgumentationRounds={setArgumentationRounds}
                concludingRounds={concludingRounds} setConcludingRounds={setConcludingRounds}
                stepMode={stepMode} setStepMode={setStepMode}
                excludeGreatestHits={excludeGreatestHits} setExcludeGreatestHits={setExcludeGreatestHits}
                showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
                temperature={temperature} setTemperature={setTemperature} temperatureLabel={temperatureLabel}
                evaluatorModel={evaluatorModel} setEvaluatorModel={setEvaluatorModel}
                stageModelPreset={stageModelPreset} setStageModelPreset={setStageModelPreset}
                stageModels={stageModels} setStageModels={setStageModels}
                audience={audience} setAudience={setAudience}
                selected={selected} toggle={toggle}
                userIsPover={userIsPover} setUserIsPover={setUserIsPover}
              />
            </div>
          </div>
        </div>
      )}

      {showModelModal && (
        <ModelConfigModal
          useCustomModel={useCustomModel} setUseCustomModel={setUseCustomModel}
          customModel={customModel} setCustomModel={setCustomModel} globalModel={globalModel}
          modalBackend={modalBackend} setModalBackend={setModalBackend} hasApiKey={hasApiKey}
          handleRefreshModels={handleRefreshModels} refreshingModels={refreshingModels}
          onClose={() => setShowModelModal(false)}
        />
      )}
      <GeminiOnboardingModal {...geminiModalProps} />
    </div>
  );
}

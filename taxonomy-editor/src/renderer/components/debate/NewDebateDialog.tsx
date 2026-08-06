// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import type { TextareaHTMLAttributes, RefObject } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore, AI_BACKENDS, DEBATE_TIERS, FALLBACK_CHAINS, backendForModel } from '../../hooks/useTaxonomyStore';
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

const AUDIENCE_DESCRIPTIONS: Record<string, string> = {
  policymakers: 'Frames arguments around policy levers, governance, and real-world decisions and tradeoffs.',
  technical_researchers: 'Emphasizes mechanisms, evidence, and technical precision over rhetoric.',
  industry_leaders: 'Focuses on strategy, deployment, incentives, and commercial/operational impact.',
  academic_community: 'Prioritizes rigor, citations, and engagement with the scholarly literature.',
  general_public: 'Uses plain language and accessible framing, minimizing jargon.',
};

function ConfigInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-overlay ndd-info-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="ndd-info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ndd-info-modal-header">
          <h2 className="ndd-info-title">Debate configuration guide</h2>
          <button type="button" className="btn ndd-info-close" onClick={onClose} aria-label="Close guide">×</button>
        </div>
        <p className="ndd-info-subtitle">What each setup option controls and what to expect.</p>
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
          <p className="ndd-info-intro">The tone debaters take toward each other&apos;s arguments.</p>
          {STYLE_PRESETS.map(s => (
            <div key={s.id} className="ndd-info-item">
              <div className="ndd-info-item-name">{s.label}</div>
              <div className="ndd-info-item-desc">{s.desc}</div>
            </div>
          ))}
        </section>
        <section className="ndd-info-section">
          <h3 className="ndd-info-section-title">Target Audience</h3>
          <p className="ndd-info-intro">Who the debate is written for.</p>
          {DEBATE_AUDIENCES.map(a => (
            <div key={a.id} className="ndd-info-item">
              <div className="ndd-info-item-name">{a.label}</div>
              <div className="ndd-info-item-desc">{AUDIENCE_DESCRIPTIONS[a.id] ?? ''}</div>
            </div>
          ))}
        </section>
        <section className="ndd-info-section">
          <h3 className="ndd-info-section-title">Debaters</h3>
          <p className="ndd-info-intro">The three perspectives that argue the topic.</p>
          {AI_POVERS.map((id) => {
            const info = POVER_INFO[id];
            return (
              <div key={id} className="ndd-info-item">
                <div className="ndd-info-item-name">{info.label}</div>
                <div className="ndd-info-item-desc">{info.personality}</div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

// ── Module-level helpers ──────────────────────────────────────────────────────

const RESOLVE_FAILED = Symbol('resolve-failed');

async function fetchDebateUrlContent(sourceRef: string): Promise<string> {
  try {
    const result = await api.fetchUrlContent(sourceRef.trim());
    if (result.error) return `[Failed to fetch URL content: ${result.error}]`;
    const content = result.content;
    return content.length > 100000 ? content.slice(0, 100000) + '\n\n[Content truncated at 100,000 characters]' : content;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'new-debate-dialog', level: 'error', message: 'failed to fetch URL content for debate source', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return `[Failed to fetch URL content: ${err}]`;
  }
}

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
    getGlobalRecorder()?.record({ type: 'system.error', component: 'new-debate-dialog', level: 'error', message: 'Failed to resolve multi-provider models', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return RESOLVE_FAILED;
  }
}

function buildCreationWeights(confrontationRounds: number, argumentationRounds: number, concludingRounds: number) {
  try { const w = loadProvisionalWeights(); const p = w.pacing_presets?.moderate; return { pacing: 'moderate', maxTotalRounds: p?.maxTotalRounds, argumentationExit: p?.argumentationExit, concludingExit: p?.concludingExit, phase_bounds: w.phase_bounds, overrides: { confrontation: confrontationRounds, argumentation: argumentationRounds, concluding: concludingRounds } }; } catch { /* telemetry — silent by design */ return null; }
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
  id: string; sourceType: DebateSourceType; povers: SpeakerId[]; userIsPover: boolean;
  effectiveModel: string; protocolId: string; temperature: number; audience: DebateAudience;
  stepMode: boolean; multiProvider: boolean; modelTier: 'basic' | 'advanced';
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

// ── Preset system (Screen A — t/2199) ────────────────────────────────────────

type BuiltInPresetId = 'quick' | 'deep' | 'socratic';
type PresetId = BuiltInPresetId | 'custom';

const PRESET_DEFAULTS: Record<BuiltInPresetId, {
  protocolId: string; dialecticalStyle: DialecticalStyle;
  confrontationRounds: number; argumentationRounds: number; concludingRounds: number;
  stepMode: boolean; modelTier: 'basic' | 'advanced';
}> = {
  quick:    { protocolId: 'structured',   dialecticalStyle: 'adversarial',  confrontationRounds: 2, argumentationRounds: 3, concludingRounds: 1, stepMode: false, modelTier: 'basic'    },
  deep:     { protocolId: 'deliberation', dialecticalStyle: 'deliberative', confrontationRounds: 3, argumentationRounds: 6, concludingRounds: 2, stepMode: false, modelTier: 'advanced' },
  socratic: { protocolId: 'socratic',     dialecticalStyle: 'integrative',  confrontationRounds: 2, argumentationRounds: 4, concludingRounds: 2, stepMode: true,  modelTier: 'basic'    },
};

const SCREEN_A_PRESETS: { id: BuiltInPresetId; label: string; summary: string; estimatedMinutes?: number }[] = [
  { id: 'quick',    label: 'Quick take', summary: '2+3 rounds · basic model',                 estimatedMinutes: 8  },
  { id: 'deep',     label: 'Deep dive',  summary: '3+6 rounds · frontier model',               estimatedMinutes: 25 },
  { id: 'socratic', label: 'Socratic',   summary: '2+4 rounds · step-by-step · basic model',   estimatedMinutes: 20 },
];

function countSettingsDiff(
  preset: BuiltInPresetId,
  protocolId: string, dialecticalStyle: DialecticalStyle,
  confrontationRounds: number, argumentationRounds: number, concludingRounds: number,
  stepMode: boolean, modelTier: 'basic' | 'advanced',
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

function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
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

function PresetCards({ basePreset, isCustom, onSelect }: {
  basePreset: BuiltInPresetId; isCustom: boolean; onSelect: (id: BuiltInPresetId) => void;
}) {
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

// ── Screen B — DebateSettingsDialog (t/2201) ─────────────────────────────────

type SettingsSection = 'format' | 'voices' | 'model' | 'sourcing' | 'material';

const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'format',   label: 'Format & pacing' },
  { id: 'voices',   label: 'Voices & audience' },
  { id: 'model',    label: 'Model & providers' },
  { id: 'sourcing', label: 'Argument sourcing' },
  { id: 'material', label: 'Source material' },
];

interface SettingsApply {
  selected: Set<SpeakerId>;
  userIsPover: boolean;
  audience: DebateAudience;
  protocolId: string;
  dialecticalStyle: DialecticalStyle;
  confrontationRounds: number;
  argumentationRounds: number;
  concludingRounds: number;
  stepMode: boolean;
  modelTier: 'basic' | 'advanced';
  multiProvider: boolean;
  excludedBackends: Set<string>;
  excludeGreatestHits: boolean;
  useCustomModel: boolean;
  customModel: string;
  titleOverride: string;
  background: string;
}

interface DebateSettingsProps {
  initialSection?: SettingsSection;
  basePreset: BuiltInPresetId;
  // Voices & audience
  selected: Set<SpeakerId>;
  userIsPover: boolean;
  audience: DebateAudience;
  // Format & pacing
  protocolId: string;
  dialecticalStyle: DialecticalStyle;
  confrontationRounds: number;
  argumentationRounds: number;
  concludingRounds: number;
  stepMode: boolean;
  // Model & providers
  modelTier: 'basic' | 'advanced';
  multiProvider: boolean;
  excludedBackends: Set<string>;
  useCustomModel: boolean;
  customModel: string;
  globalModel: string;
  backendsWithKeys: string[];
  hasApiKey: Record<string, boolean>;
  // Argument sourcing
  excludeGreatestHits: boolean;
  // Source material
  titleOverride: string;
  background: string;
  // Callbacks
  onApply: (changes: SettingsApply) => void;
  onClose: () => void;
  onSaveAsPreset: (name: string, settings: SettingsApply) => void;
}

function sectionHasDiff(
  section: SettingsSection,
  preset: BuiltInPresetId,
  s: {
    protocolId: string; dialecticalStyle: DialecticalStyle;
    confrontationRounds: number; argumentationRounds: number; concludingRounds: number;
    stepMode: boolean; modelTier: 'basic' | 'advanced';
    multiProvider: boolean; useCustomModel: boolean;
    selected: Set<SpeakerId>; userIsPover: boolean; audience: DebateAudience;
    excludeGreatestHits: boolean;
    titleOverride: string; background: string;
  },
): boolean {
  const p = PRESET_DEFAULTS[preset];
  switch (section) {
    case 'format':
      return s.protocolId !== p.protocolId || s.dialecticalStyle !== p.dialecticalStyle ||
        s.confrontationRounds !== p.confrontationRounds || s.argumentationRounds !== p.argumentationRounds ||
        s.concludingRounds !== p.concludingRounds || s.stepMode !== p.stepMode;
    case 'voices':
      return s.selected.size !== AI_POVERS.length ||
        AI_POVERS.some(id => !s.selected.has(id)) || s.userIsPover ||
        s.audience !== 'policymakers';
    case 'model':
      return s.modelTier !== p.modelTier || s.multiProvider || s.useCustomModel;
    case 'sourcing':
      return s.excludeGreatestHits;
    case 'material':
      return s.titleOverride !== '' || s.background !== '';
  }
}

function SaveAsPresetModal({
  onSave,
  onCancel,
}: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="ndd-save-preset-overlay" onClick={onCancel}>
      <div className="ndd-save-preset-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal aria-label="Save preset">
        <h3 className="ndd-save-preset-title">Save as preset</h3>
        <input
          className="ndd-input"
          type="text"
          placeholder="Preset name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); if (e.key === 'Escape') onCancel(); }}
          maxLength={60}
        />
        <div className="ndd-save-preset-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button>
        </div>
      </div>
    </div>
  );
}

function DebateSettingsDialog({
  initialSection = 'format',
  basePreset,
  selected: initSelected,
  userIsPover: initUserIsPover,
  audience: initAudience,
  protocolId: initProtocolId,
  dialecticalStyle: initDialecticalStyle,
  confrontationRounds: initConfrontationRounds,
  argumentationRounds: initArgumentationRounds,
  concludingRounds: initConcludingRounds,
  stepMode: initStepMode,
  modelTier: initModelTier,
  multiProvider: initMultiProvider,
  excludedBackends: initExcludedBackends,
  useCustomModel: initUseCustomModel,
  customModel: initCustomModel,
  globalModel,
  backendsWithKeys,
  hasApiKey,
  excludeGreatestHits: initExcludeGreatestHits,
  titleOverride: initTitleOverride,
  background: initBackground,
  onApply,
  onClose,
  onSaveAsPreset,
}: DebateSettingsProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  // Voices
  const [localSelected, setLocalSelected] = useState(() => new Set(initSelected));
  const [localUserIsPover, setLocalUserIsPover] = useState(initUserIsPover);
  const [localAudience, setLocalAudience] = useState(initAudience);
  // Format
  const [localProtocolId, setLocalProtocolId] = useState(initProtocolId);
  const [localStyle, setLocalStyle] = useState(initDialecticalStyle);
  const [localConfrontation, setLocalConfrontation] = useState(initConfrontationRounds);
  const [localArgumentation, setLocalArgumentation] = useState(initArgumentationRounds);
  const [localConcluding, setLocalConcluding] = useState(initConcludingRounds);
  const [localStepMode, setLocalStepMode] = useState(initStepMode);
  // Model
  const [localModelTier, setLocalModelTier] = useState(initModelTier);
  const [localMultiProvider, setLocalMultiProvider] = useState(initMultiProvider);
  const [localExcludedBackends, setLocalExcludedBackends] = useState(() => new Set(initExcludedBackends));
  const [localUseCustomModel, setLocalUseCustomModel] = useState(initUseCustomModel);
  const [localCustomModel, setLocalCustomModel] = useState(initCustomModel);
  // Sourcing
  const [localExcludeGreatestHits, setLocalExcludeGreatestHits] = useState(initExcludeGreatestHits);
  // Material
  const [localTitleOverride, setLocalTitleOverride] = useState(initTitleOverride);
  const [localBackground, setLocalBackground] = useState(initBackground);
  // Save as preset modal
  const [showSaveModal, setShowSaveModal] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  // Escape → close without applying
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentSettings = useMemo<Parameters<typeof sectionHasDiff>[2]>(() => ({
    protocolId: localProtocolId, dialecticalStyle: localStyle,
    confrontationRounds: localConfrontation, argumentationRounds: localArgumentation,
    concludingRounds: localConcluding, stepMode: localStepMode,
    modelTier: localModelTier, multiProvider: localMultiProvider,
    useCustomModel: localUseCustomModel, selected: localSelected,
    userIsPover: localUserIsPover, audience: localAudience,
    excludeGreatestHits: localExcludeGreatestHits,
    titleOverride: localTitleOverride, background: localBackground,
  }), [
    localProtocolId, localStyle, localConfrontation, localArgumentation, localConcluding,
    localStepMode, localModelTier, localMultiProvider, localUseCustomModel, localSelected,
    localUserIsPover, localAudience, localExcludeGreatestHits, localTitleOverride, localBackground,
  ]);

  const toggleDebater = (id: SpeakerId) => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleBackend = (id: string) => {
    setLocalExcludedBackends(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const buildApply = (): SettingsApply => ({
    selected: localSelected, userIsPover: localUserIsPover, audience: localAudience,
    protocolId: localProtocolId, dialecticalStyle: localStyle,
    confrontationRounds: localConfrontation, argumentationRounds: localArgumentation,
    concludingRounds: localConcluding, stepMode: localStepMode,
    modelTier: localModelTier, multiProvider: localMultiProvider,
    excludedBackends: localExcludedBackends,
    useCustomModel: localUseCustomModel, customModel: localCustomModel,
    excludeGreatestHits: localExcludeGreatestHits,
    titleOverride: localTitleOverride, background: localBackground,
  });

  const handleReset = () => {
    const p = PRESET_DEFAULTS[basePreset];
    setLocalSelected(new Set(AI_POVERS));
    setLocalUserIsPover(false);
    setLocalAudience('policymakers');
    setLocalProtocolId(p.protocolId);
    setLocalStyle(p.dialecticalStyle);
    setLocalConfrontation(p.confrontationRounds);
    setLocalArgumentation(p.argumentationRounds);
    setLocalConcluding(p.concludingRounds);
    setLocalStepMode(p.stepMode);
    setLocalModelTier(p.modelTier);
    setLocalMultiProvider(false);
    setLocalExcludedBackends(new Set());
    setLocalUseCustomModel(false);
    setLocalCustomModel(globalModel);
    setLocalExcludeGreatestHits(false);
    setLocalTitleOverride('');
    setLocalBackground('');
  };

  const handleSaveAsPreset = (name: string) => {
    onSaveAsPreset(name, buildApply());
    setShowSaveModal(false);
  };

  const canApply = localSelected.size >= 1;

  return (
    <div className="ndd-settings-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="ndd-settings-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="ndd-settings-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="ndd-settings-header">
          <h2 className="ndd-settings-title" id="ndd-settings-title">Debate settings</h2>
          <button type="button" className="ndd-close-btn" onClick={onClose} aria-label="Close settings">&times;</button>
        </div>

        <div className="ndd-settings-layout">
          <nav className="ndd-settings-nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                className={`ndd-settings-nav-item${activeSection === s.id ? ' active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
                {sectionHasDiff(s.id, basePreset, currentSettings) && (
                  <span className="ndd-nav-dot" aria-label="modified" />
                )}
              </button>
            ))}
          </nav>

          <div className="ndd-settings-body">

            {/* Format & pacing */}
            {activeSection === 'format' && (
              <>
                <h3 className="ndd-settings-section-title">Format &amp; pacing</h3>

                <div className="ndd-settings-field">
                  <label className="ndd-field-label" htmlFor="ndd-s-protocol">Protocol</label>
                  <select
                    id="ndd-s-protocol"
                    className="ndd-input"
                    value={localProtocolId}
                    onChange={e => setLocalProtocolId(e.target.value)}
                  >
                    {DEBATE_PROTOCOLS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <p className="ndd-settings-field-hint">
                    {DEBATE_PROTOCOLS.find(p => p.id === localProtocolId)?.description}
                  </p>
                </div>

                <div className="ndd-settings-field">
                  <label className="ndd-field-label">Dialectical style</label>
                  <div className="ndd-style-options">
                    {STYLE_PRESETS.map(s => (
                      <label key={s.id} className={`ndd-style-option${localStyle === s.id ? ' active' : ''}`}>
                        <input
                          type="radio"
                          name="ndd-style"
                          value={s.id}
                          checked={localStyle === s.id}
                          onChange={() => setLocalStyle(s.id)}
                          className="sr-only"
                        />
                        <span className="ndd-style-label">{s.label}</span>
                        <span className="ndd-style-desc">{s.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="ndd-settings-field">
                  <label className="ndd-field-label">Max rounds per phase</label>
                  <div className="ndd-rounds-grid">
                    {([
                      { label: 'Confrontation', value: localConfrontation, set: setLocalConfrontation, min: 1, max: 6 },
                      { label: 'Argumentation', value: localArgumentation, set: setLocalArgumentation, min: 1, max: 10 },
                      { label: 'Concluding',    value: localConcluding,    set: setLocalConcluding,    min: 1, max: 4 },
                    ] as const).map(r => (
                      <div key={r.label} className="ndd-rounds-field">
                        <label className="ndd-rounds-label">{r.label}</label>
                        <input
                          type="number"
                          className="ndd-input ndd-rounds-input"
                          min={r.min}
                          max={r.max}
                          value={r.value}
                          onChange={e => r.set(Math.min(r.max, Math.max(r.min, parseInt(e.target.value, 10) || r.min)))}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <label className="ndd-settings-toggle-row">
                  <input
                    type="checkbox"
                    checked={localStepMode}
                    onChange={e => setLocalStepMode(e.target.checked)}
                  />
                  <div>
                    <span className="ndd-toggle-name">Pause between phases</span>
                    <span className="ndd-step-help">Wait for your input before each new debate phase</span>
                  </div>
                </label>
              </>
            )}

            {/* Voices & audience */}
            {activeSection === 'voices' && (
              <>
                <h3 className="ndd-settings-section-title">Voices &amp; audience</h3>

                <label className="ndd-field-label">Debaters</label>
                <div className="ndd-settings-debaters">
                  {AI_POVERS.map(id => {
                    const info = POVER_INFO[id];
                    const camp = povToCamp(id);
                    return (
                      <label key={id} className="ndd-settings-debater-row">
                        <input type="checkbox" checked={localSelected.has(id)} onChange={() => toggleDebater(id)} />
                        <span className="ndd-debater-chip" data-camp={camp}>
                          <span className="ndd-debater-chip-icon" aria-hidden="true"><CampGlyph camp={camp!} size={12} /></span>
                          {info.label}
                        </span>
                        <span className="ndd-step-help" style={{ margin: 0 }}>{info.personality}</span>
                      </label>
                    );
                  })}
                  <label className="ndd-settings-debater-row">
                    <input type="checkbox" checked={localUserIsPover} onChange={() => setLocalUserIsPover(v => !v)} />
                    <span className="ndd-debater-chip ndd-debater-chip--user">👤 You</span>
                    <span className="ndd-step-help" style={{ margin: 0 }}>Argue a position yourself</span>
                  </label>
                </div>
                {localSelected.size < 1 && <div className="ndd-hint-error">Select at least 1 perspective</div>}

                <div className="ndd-settings-audience-select">
                  <label className="ndd-field-label" htmlFor="ndd-settings-audience">Written for</label>
                  <select
                    id="ndd-settings-audience"
                    className="ndd-input"
                    value={localAudience}
                    onChange={e => setLocalAudience(e.target.value as DebateAudience)}
                  >
                    {DEBATE_AUDIENCES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* Model & providers */}
            {activeSection === 'model' && (
              <>
                <h3 className="ndd-settings-section-title">Model &amp; providers</h3>

                <div className="ndd-settings-field">
                  <label className="ndd-field-label">Model tier</label>
                  <div className="ndd-tier-chips">
                    {(['basic', 'advanced'] as const).map(tier => (
                      <button
                        key={tier}
                        type="button"
                        className={`ndd-tier-chip${localModelTier === tier ? ' active' : ''}`}
                        onClick={() => setLocalModelTier(tier)}
                      >
                        {tier === 'basic' ? 'Basic' : 'Frontier'}
                      </button>
                    ))}
                  </div>
                  <p className="ndd-settings-field-hint">
                    {localModelTier === 'basic'
                      ? 'Faster and lower-cost. Good for quick topics.'
                      : 'Most capable model tier. Better for nuanced, complex topics.'}
                  </p>
                </div>

                <label className="ndd-settings-toggle-row">
                  <input type="checkbox" checked={localMultiProvider} onChange={e => setLocalMultiProvider(e.target.checked)} />
                  <div>
                    <span className="ndd-toggle-name">Multi-provider mode</span>
                    <span className="ndd-step-help">Assign different AI backends to each debater</span>
                  </div>
                </label>

                {localMultiProvider ? (
                  <div className="ndd-settings-field">
                    <label className="ndd-field-label">Active backends</label>
                    <div className="ndd-backend-chips">
                      {backendsWithKeys.map(id => {
                        const info = AI_BACKENDS.find(b => b.value === id);
                        const active = !localExcludedBackends.has(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            className={`ndd-backend-chip${active ? ' active' : ''}`}
                            onClick={() => toggleBackend(id)}
                          >
                            {info?.label ?? id}
                            {hasApiKey[id] === false && <span className="ndd-backend-nokey" title="No API key"> !</span>}
                          </button>
                        );
                      })}
                    </div>
                    {backendsWithKeys.length < 2 && (
                      <p className="ndd-warning-text">Multi-provider needs at least 2 backends with API keys.</p>
                    )}
                  </div>
                ) : (
                  <>
                    <label className="ndd-settings-toggle-row" style={{ marginTop: 'var(--sp-4)' }}>
                      <input
                        type="checkbox"
                        checked={localUseCustomModel}
                        onChange={e => setLocalUseCustomModel(e.target.checked)}
                      />
                      <div>
                        <span className="ndd-toggle-name">Custom model</span>
                        <span className="ndd-step-help">Override the default model for this debate</span>
                      </div>
                    </label>
                    {localUseCustomModel && (
                      <div className="ndd-settings-field" style={{ marginTop: 'var(--sp-2)' }}>
                        <input
                          className="ndd-input"
                          type="text"
                          placeholder={globalModel}
                          value={localCustomModel}
                          onChange={e => setLocalCustomModel(e.target.value)}
                        />
                      </div>
                    )}
                    {!localUseCustomModel && (
                      <p className="ndd-settings-field-hint" style={{ marginTop: 'var(--sp-2)' }}>
                        Using default model: <code>{globalModel}</code>
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {/* Argument sourcing */}
            {activeSection === 'sourcing' && (
              <>
                <h3 className="ndd-settings-section-title">Argument sourcing</h3>
                <label className="ndd-settings-toggle-row">
                  <input
                    type="checkbox"
                    checked={localExcludeGreatestHits}
                    onChange={e => setLocalExcludeGreatestHits(e.target.checked)}
                  />
                  <div>
                    <span className="ndd-toggle-name">Exclude greatest-hits nodes</span>
                    <span className="ndd-step-help">Skip the most-cited taxonomy nodes; forces debaters to draw on less-common arguments</span>
                  </div>
                </label>
              </>
            )}

            {/* Source material */}
            {activeSection === 'material' && (
              <>
                <h3 className="ndd-settings-section-title">Source material</h3>

                <div className="ndd-settings-field">
                  <label className="ndd-field-label" htmlFor="ndd-s-title-override">Title override</label>
                  <input
                    id="ndd-s-title-override"
                    className="ndd-input"
                    type="text"
                    placeholder="Leave blank to auto-generate from topic"
                    value={localTitleOverride}
                    onChange={e => setLocalTitleOverride(e.target.value)}
                    maxLength={120}
                  />
                  <p className="ndd-settings-field-hint">Overrides the generated title if set.</p>
                </div>

                <div className="ndd-settings-field">
                  <label className="ndd-field-label" htmlFor="ndd-s-background">Background context</label>
                  <AutoGrowTextarea
                    id="ndd-s-background"
                    className="ndd-adder-textarea"
                    value={localBackground}
                    onChange={e => setLocalBackground(e.target.value)}
                    rows={4}
                    placeholder="Additional context for the debaters…"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="ndd-settings-footer">
          <button type="button" className="btn ndd-reset-btn" onClick={handleReset}>Reset to preset</button>
          <button type="button" className="btn ndd-save-preset-btn" onClick={() => setShowSaveModal(true)}>Save as preset…</button>
          <div className="ndd-settings-footer-right">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canApply}
              onClick={() => onApply(buildApply())}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {showSaveModal && (
        <SaveAsPresetModal onSave={handleSaveAsPreset} onCancel={() => setShowSaveModal(false)} />
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate } = useDebateStore(
    useShallow(s => ({ createDebate: s.createDebate, loadDebate: s.loadDebate }))
  );

  // Topic / source
  const [topic, setTopic] = useState('');
  const [background, setBackground] = useState('');
  const [sourceType, setSourceType] = useState<DebateSourceType>('topic');
  const [sourceRef, setSourceRef] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [activeAdder, setActiveAdder] = useState<'none' | 'background' | 'source'>('none');

  // Debaters
  const [selected, setSelected] = useState<Set<SpeakerId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);

  // Audience — persisted to localStorage
  const [audience, setAudience] = useState<DebateAudience>(() =>
    (localStorage.getItem('taxonomy-editor-last-debate-audience') as DebateAudience | null) ?? 'policymakers'
  );

  // Preset system
  const [basePreset, setBasePreset] = useState<BuiltInPresetId>('quick');
  const [protocolId, setProtocolId] = useState(PRESET_DEFAULTS.quick.protocolId);
  const [dialecticalStyle, setDialecticalStyle] = useState<DialecticalStyle>(PRESET_DEFAULTS.quick.dialecticalStyle);
  const [confrontationRounds, setConfrontationRounds] = useState(PRESET_DEFAULTS.quick.confrontationRounds);
  const [argumentationRounds, setArgumentationRounds] = useState(PRESET_DEFAULTS.quick.argumentationRounds);
  const [concludingRounds, setConcludingRounds] = useState(PRESET_DEFAULTS.quick.concludingRounds);
  const [stepMode, setStepMode] = useState(PRESET_DEFAULTS.quick.stepMode);
  const [modelTier, setModelTier] = useState<'basic' | 'advanced'>(PRESET_DEFAULTS.quick.modelTier);

  // Settings managed via Screen B
  const [temperature] = useState(0.7);
  const [evaluatorModel] = useState('');
  const [multiProvider, setMultiProvider] = useState(false);
  const [excludedBackends, setExcludedBackends] = useState<Set<string>>(new Set());
  const [excludeGreatestHits, setExcludeGreatestHits] = useState(false);
  const [stageModels] = useState<{ brief: string; plan: string; cite: string }>({ brief: '', plan: '', cite: '' });
  const [titleOverride, setTitleOverride] = useState('');

  // Model (global default; override via Screen B)
  const { geminiModel } = useTaxonomyStore();
  const globalModel = geminiModel;
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState<string>(globalModel);

  // API key / tier (needed for canStart)
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({});
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set());
  const { tier: tierInfo } = useTierInfo();
  const freeTier = isFreeTier(tierInfo);
  const { modalProps: geminiModalProps, checkAndShow: checkGeminiOnboarding } = useGeminiOnboarding();

  // Queue (overflow menu)
  const [queuedTopics, setQueuedTopics] = useState<{ text: string; sourceType: DebateSourceType; sourceRef: string; timestamp: string }[]>(() => {
    try { const raw = localStorage.getItem('taxonomy-editor-topic-queue'); return raw ? JSON.parse(raw) : []; } catch { /* telemetry — silent by design */ return []; }
  });

  // UI state
  const [creating, setCreating] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [titleAnnouncement, setTitleAnnouncement] = useState('');
  const [showOverflow, setShowOverflow] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('voices');

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !showSettings);

  // Restore focus to triggering element on close
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => { prev?.focus(); };
  }, []);

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
      .catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'new-debate-dialog', level: 'error', message: 'Failed to load available AI backends', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
  }, []);

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

  // fallbackWarnings — computed but consumed by Screen B (t/2201); suppress lint
  const fallbackWarnings = useMemo(() => {
    const chain = FALLBACK_CHAINS[activeModel] ?? [];
    return chain.map(m => ({ model: m, backend: backendForModel(m) })).filter(({ backend }) => hasApiKey[backend] === false).map(({ model, backend }) => `${model} (${backend})`);
  }, [activeModel, hasApiKey]);
  void fallbackWarnings;

  const isCustom = countSettingsDiff(basePreset, protocolId, dialecticalStyle, confrontationRounds, argumentationRounds, concludingRounds, stepMode, modelTier) > 0;
  const diffCount = isCustom ? countSettingsDiff(basePreset, protocolId, dialecticalStyle, confrontationRounds, argumentationRounds, concludingRounds, stepMode, modelTier) : 0;

  const hasSource = useMemo(() => {
    if (activeAdder === 'source') {
      return sourceType === 'document' ? sourceContent.length > 0 : sourceRef.trim().length > 0;
    }
    return topic.trim().length > 0;
  }, [activeAdder, sourceType, sourceContent, sourceRef, topic]);

  const canStart = hasSource && selected.size >= 1 && (multiProvider ? activeBackends.length >= 2 : activeModelHasKey);

  const handlePresetSelect = (id: BuiltInPresetId) => {
    setBasePreset(id);
    const p = PRESET_DEFAULTS[id];
    setProtocolId(p.protocolId);
    setDialecticalStyle(p.dialecticalStyle);
    setConfrontationRounds(p.confrontationRounds);
    setArgumentationRounds(p.argumentationRounds);
    setConcludingRounds(p.concludingRounds);
    setStepMode(p.stepMode);
    setModelTier(p.modelTier);
  };

  const handleAudienceChange = (val: DebateAudience) => {
    setAudience(val);
    localStorage.setItem('taxonomy-editor-last-debate-audience', val);
  };

  const handlePickFile = async () => {
    const result = await api.pickDocumentFile();
    if (result.cancelled || !result.filePath || !result.content) return;
    setSourceRef(result.filePath);
    setSourceContent(result.content);
    setFileName(result.filePath.split('/').pop() || result.filePath);
    if (!topic) setTopic(`Discuss: ${result.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || ''}`);
  };

  const handleRevertToTopic = () => {
    setSourceType('topic');
    setSourceRef('');
    setSourceContent('');
    setFileName('');
    setActiveAdder('none');
  };

  const persistQueue = (next: typeof queuedTopics) => {
    setQueuedTopics(next);
    localStorage.setItem('taxonomy-editor-topic-queue', JSON.stringify(next));
  };

  const handleQueueTopic = () => {
    const text = activeAdder === 'source' ? (sourceRef.trim() || sourceContent.slice(0, 200)) : topic.trim();
    if (!text) return;
    persistQueue([...queuedTopics, { text, sourceType: activeAdder === 'source' ? sourceType : 'topic', sourceRef: activeAdder === 'source' ? sourceRef.trim() : '', timestamp: new Date().toISOString() }]);
    setShowOverflow(false);
    onClose();
  };

  const openSettings = (section: SettingsSection = 'format') => {
    setSettingsSection(section);
    setShowSettings(true);
  };

  const handleSettingsApply = (changes: SettingsApply) => {
    setSelected(changes.selected);
    setUserIsPover(changes.userIsPover);
    handleAudienceChange(changes.audience);
    setProtocolId(changes.protocolId);
    setDialecticalStyle(changes.dialecticalStyle);
    setConfrontationRounds(changes.confrontationRounds);
    setArgumentationRounds(changes.argumentationRounds);
    setConcludingRounds(changes.concludingRounds);
    setStepMode(changes.stepMode);
    setModelTier(changes.modelTier);
    setMultiProvider(changes.multiProvider);
    setExcludedBackends(changes.excludedBackends);
    setExcludeGreatestHits(changes.excludeGreatestHits);
    setUseCustomModel(changes.useCustomModel);
    setCustomModel(changes.customModel);
    setTitleOverride(changes.titleOverride);
    setBackground(changes.background);
    setShowSettings(false);
  };

  const handleSaveAsPreset = (name: string, settings: SettingsApply) => {
    try {
      const raw = localStorage.getItem('taxonomy-editor-custom-presets');
      const existing: { name: string; settings: Record<string, unknown>; basePreset: string }[] = raw ? JSON.parse(raw) : [];
      const entry = {
        name,
        basePreset,
        settings: {
          ...settings,
          selected: [...settings.selected],
          excludedBackends: [...settings.excludedBackends],
        },
      };
      const idx = existing.findIndex(p => p.name === name);
      if (idx >= 0) existing[idx] = entry; else existing.push(entry);
      localStorage.setItem('taxonomy-editor-custom-presets', JSON.stringify(existing));
    } catch { /* telemetry — silent by design */ }
    setShowSettings(false);
  };

  const handleStart = async () => {
    if (!canStart || creating) return;
    await checkGeminiOnboarding({ freeTier });
    setCreating(true);
    setStartError(null);

    try {
      let finalTopic = topic.trim();
      let finalContent = sourceContent;

      if (activeAdder === 'source' && sourceType === 'url') {
        if (!finalTopic) finalTopic = `Discuss: ${sourceRef.trim()}`;
        finalContent = await fetchDebateUrlContent(sourceRef);
      }
      if (activeAdder === 'source' && sourceType === 'document' && !finalTopic) {
        finalTopic = `Discuss: ${fileName}`;
      }

      const povers = Array.from(selected);
      if (userIsPover && !povers.includes('user')) povers.push('user');
      const effectiveModel = useCustomModel ? customModel : globalModel;
      localStorage.setItem('taxonomy-editor-last-debate-model', effectiveModel);
      const debateModelOverride = computeDebateModelOverride(multiProvider, useCustomModel, customModel);

      let speakerModels: Record<string, string> | undefined;
      if (multiProvider) {
        const resolved = resolveDebateSpeakerModels(modelTier, activeBackends, povers);
        if (resolved === RESOLVE_FAILED) { setCreating(false); return; }
        speakerModels = resolved;
      }

      const { sourceTypeArg, sourceRefArg, contentArg } = buildDebateSourceArgs(
        activeAdder === 'source' ? sourceType : 'topic', sourceRef, finalContent
      );

      const id = await createDebate(
        finalTopic, povers, userIsPover, sourceTypeArg, sourceRefArg, contentArg,
        debateModelOverride, protocolId, temperature, audience,
        buildDebateOptions({ debateTitle: titleOverride, background, evaluatorModel, confrontationRounds, argumentationRounds, concludingRounds, speakerModels, multiProvider, modelTier, stepMode, excludeGreatestHits, stageModels }),
      );
      await loadDebate(id);
      const creationWeights = buildCreationWeights(confrontationRounds, argumentationRounds, concludingRounds);
      getGlobalRecorder()?.record({ type: 'user.action', component: 'new-debate', level: 'info', message: 'debate.created', data: buildDebateCreatedData({ id, sourceType: sourceTypeArg, povers, userIsPover, effectiveModel, protocolId, temperature, audience, stepMode, multiProvider, modelTier, speakerModels, stageModels, creationWeights }) });
      const store = useDebateStore.getState();
      store.updatePhase('clarification');
      await store.saveDebate();
      api.openDebateWindow(id).catch(() => { /* fallback: stays inline */ });

      // Generate title via model call (Q5 resolved); announce for screen readers
      try {
        const generatedTitle = await generateDebateTitle(finalTopic);
        setTitleAnnouncement(`Debate titled: ${generatedTitle}`);
      } catch { /* telemetry — silent by design */ }

      onClose();
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'new-debate-dialog', level: 'error', message: 'Failed to create debate', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      setStartError(err instanceof Error ? err.message : 'Failed to start debate. Please try again.');
      setCreating(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      {/* Screen A — 560 px single-column dialog (t/2199) */}
      <div
        ref={dialogRef}
        className="ndd-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="ndd-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ndd-dialog-header">
          <h2 className="ndd-dialog-title" id="ndd-dialog-title">New debate</h2>
          <button type="button" className="ndd-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {/* Body */}
        <div className="ndd-dialog-body">

          {/* Topic field OR source picker — mutually exclusive (t/2200) */}
          {activeAdder !== 'source' ? (
            <>
              <label className="ndd-field-label" htmlFor="ndd-topic">
                Topic <span className="ndd-required-mark" aria-hidden="true">*</span>
              </label>
              <AutoGrowTextarea
                id="ndd-topic"
                className="ndd-topic-primary"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                rows={3}
                maxHeight={144}
                placeholder="What should the AI debate?"

                autoFocus
                aria-required="true"
              />
            </>
          ) : (
            <>
              <label className="ndd-field-label">Source</label>
              <div className="ndd-adder-content">
                <div className="ndd-source-type-tabs">
                  <button
                    type="button"
                    className={`ndd-source-tab${sourceType === 'document' ? ' active' : ''}`}
                    onClick={() => setSourceType('document')}
                  >
                    Document
                  </button>
                  <button
                    type="button"
                    className={`ndd-source-tab${sourceType === 'url' ? ' active' : ''}`}
                    onClick={() => setSourceType('url')}
                  >
                    URL
                  </button>
                </div>
                {sourceType === 'document' && (
                  <div className="ndd-file-pick-row">
                    <button type="button" className="btn btn-sm" onClick={handlePickFile}>Pick file…</button>
                    {fileName && <span className="ndd-file-name">{fileName}</span>}
                  </div>
                )}
                {sourceType === 'url' && (
                  <input
                    type="url"
                    className="ndd-input"
                    value={sourceRef}
                    onChange={e => {
                      setSourceRef(e.target.value);
                      if (!e.target.value) handleRevertToTopic();
                    }}
                    onBlur={() => { if (!sourceRef.trim()) handleRevertToTopic(); }}
                    placeholder="https://…"
    
                    autoFocus
                  />
                )}
                <button type="button" className="ndd-adder-collapse" onClick={handleRevertToTopic}>
                  ← Use topic instead
                </button>
              </div>
            </>
          )}

          {/* Preset cards (t/2199) */}
          <PresetCards basePreset={basePreset} isCustom={isCustom} onSelect={handlePresetSelect} />

          {/* Written for (audience select) — t/2200 */}
          <div className="ndd-field-row">
            <label className="ndd-field-label ndd-audience-label" htmlFor="ndd-audience">Written for</label>
            <select
              id="ndd-audience"
              className="ndd-input ndd-audience-select"
              value={audience}
              onChange={e => handleAudienceChange(e.target.value as DebateAudience)}
            >
              {DEBATE_AUDIENCES.map(a => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          {/* Debater chips — read-only; Change voices → Screen B (t/2200) */}
          <div className="ndd-voices-row">
            <div className="ndd-debater-chips" role="list" aria-label="Selected debaters">
              {AI_POVERS.filter(id => selected.has(id)).map(id => {
                const camp = povToCamp(id);
                return (
                  <span key={id} className="ndd-debater-chip" data-camp={camp} role="listitem">
                    <span className="ndd-debater-chip-icon" aria-hidden="true">
                      <CampGlyph camp={camp!} size={12} />
                    </span>
                    {POVER_INFO[id].label}
                  </span>
                );
              })}
              {userIsPover && (
                <span className="ndd-debater-chip ndd-debater-chip--user" role="listitem">
                  👤 You
                </span>
              )}
            </div>
            <button
              type="button"
              className="ndd-change-voices-btn"
              onClick={() => openSettings('voices')}
            >
              Change voices
            </button>
          </div>

          {/* Optional adders — t/2200 */}
          <div className="ndd-adders">
            {/* Background context */}
            {activeAdder !== 'background' ? (
              <button
                type="button"
                className="ndd-adder-btn"
                onClick={() => setActiveAdder('background')}
              >
                + Add background context
              </button>
            ) : (
              <div className="ndd-adder-content">
                <label className="ndd-field-label" htmlFor="ndd-background">Background context</label>
                <AutoGrowTextarea
                  id="ndd-background"
                  className="ndd-adder-textarea"
                  value={background}
                  onChange={e => setBackground(e.target.value)}
                  onBlur={() => { if (!background.trim()) setActiveAdder('none'); }}
                  rows={3}
                  placeholder="Additional context for the debaters…"
  
                  autoFocus
                />
                {background && (
                  <button
                    type="button"
                    className="ndd-adder-collapse"
                    onClick={() => { setBackground(''); setActiveAdder('none'); }}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            {/* Document / URL source (only when topic is active) */}
            {activeAdder !== 'source' && (
              <button
                type="button"
                className="ndd-adder-btn"
                onClick={() => { setSourceType('url'); setActiveAdder('source'); }}
              >
                + Use a document or URL
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="ndd-dialog-footer">
          {startError && (
            <div className="ndd-start-error" role="alert">
              {startError}
              <button type="button" className="ndd-retry-link" onClick={handleStart}>Retry</button>
            </div>
          )}
          <div className="ndd-footer-actions">
            <button
              type="button"
              className="ndd-advanced-link"
              onClick={() => openSettings('format')}
            >
              Advanced settings
              {diffCount > 0 && (
                <span className="ndd-change-badge" aria-label={`${diffCount} setting${diffCount > 1 ? 's' : ''} changed`}>
                  {diffCount}
                </span>
              )}
            </button>

            <div className="ndd-footer-right">
              <button type="button" className="btn ndd-cancel-btn" onClick={onClose}>Cancel</button>

              <div className="ndd-start-group">
                <button
                  type="button"
                  className="btn btn-primary ndd-start-btn"
                  onClick={handleStart}
                  disabled={!canStart || creating}
                  title={!hasSource ? 'Enter a topic to start' : !activeModelHasKey ? 'No API key configured' : undefined}
                >
                  {creating ? 'Starting…' : 'Start debate'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary ndd-start-overflow-btn"
                  aria-label="More options"
                  aria-expanded={showOverflow}
                  onClick={() => setShowOverflow(v => !v)}
                  disabled={creating}
                >
                  ▾
                </button>
                {showOverflow && (
                  <div className="ndd-overflow-menu" role="menu">
                    <button
                      type="button"
                      className="ndd-overflow-item"
                      role="menuitem"
                      onClick={handleQueueTopic}
                      disabled={!hasSource}
                    >
                      Queue topic
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Screen B — full settings dialog */}
      {showSettings && (
        <DebateSettingsDialog
          initialSection={settingsSection}
          basePreset={basePreset}
          selected={selected}
          userIsPover={userIsPover}
          audience={audience}
          protocolId={protocolId}
          dialecticalStyle={dialecticalStyle}
          confrontationRounds={confrontationRounds}
          argumentationRounds={argumentationRounds}
          concludingRounds={concludingRounds}
          stepMode={stepMode}
          modelTier={modelTier}
          multiProvider={multiProvider}
          excludedBackends={excludedBackends}
          useCustomModel={useCustomModel}
          customModel={customModel}
          globalModel={globalModel}
          backendsWithKeys={backendsWithKeys}
          hasApiKey={hasApiKey}
          excludeGreatestHits={excludeGreatestHits}
          titleOverride={titleOverride}
          background={background}
          onApply={handleSettingsApply}
          onClose={() => setShowSettings(false)}
          onSaveAsPreset={handleSaveAsPreset}
        />
      )}

      <GeminiOnboardingModal {...geminiModalProps} />

      {/* Announced for screen readers after title generation */}
      <div aria-live="polite" className="sr-only">{titleAnnouncement}</div>
    </div>
  );
}

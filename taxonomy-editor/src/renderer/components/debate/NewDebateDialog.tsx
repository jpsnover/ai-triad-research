// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import type { TextareaHTMLAttributes } from 'react';
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
import { improveDebateTopicPrompt } from '@lib/debate/prompts';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { loadProvisionalWeights } from '@lib/debate/phaseTransitions';
import { resolveMultiProviderModels } from '@lib/ai-client/modelRouter';
import { useTierInfo, isFreeTier } from '../../hooks/useTierInfo';
import { getClientConfig } from '../../lib/clientConfig';
import { useGeminiOnboarding } from '../../hooks/useGeminiOnboarding';
import { GeminiOnboardingModal } from '../settings/GeminiOnboardingModal';

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
  topic: '\u270F\uFE0F',     // pencil
  document: '\uD83D\uDCC4',  // page
  url: '\uD83C\uDF10',       // globe
  situations: '\uD83D\uDCCB', // clipboard (unused but typed)
  other: '\uD83D\uDCE6',     // package
};

const FORMAT_ICONS: Record<string, string> = {
  structured: '\u2696\uFE0F',    // scales
  socratic: '\uD83E\uDDD0',      // thinking face
  deliberation: '\uD83E\uDD1D',  // handshake
};

const DEBATER_ICONS: Record<string, string> = {
  accelerationist: '\u26A1',   // lightning
  safetyist: '\uD83D\uDEE1\uFE0F',  // shield
  skeptic: '\uD83D\uDD2E',  // crystal ball
  user: '\uD83D\uDC64',       // silhouette
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

export function NewDebateDialog({ onClose }: NewDebateDialogProps) {
  const { createDebate, loadDebate } = useDebateStore(
    useShallow(s => ({ createDebate: s.createDebate, loadDebate: s.loadDebate }))
  );
  const [debateTitle, setDebateTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [background, setBackground] = useState('');
  const [showConfigInfo, setShowConfigInfo] = useState(false);
  const [sourceType, setSourceType] = useState<DebateSourceType>('topic');
  const [sourceRef, setSourceRef] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState<Set<SpeakerId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);
  const [creating, setCreating] = useState(false);
  // "Improve with AI" inline topic refinement (t/910)
  const [improvingTopic, setImprovingTopic] = useState(false);
  const [topicSuggestion, setTopicSuggestion] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  const { aiBackend, geminiModel, situations } = useTaxonomyStore();
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
  const [protocolId, setProtocolId] = useState('structured');
  const [temperature, setTemperature] = useState(0.7);
  const [audience, setAudience] = useState<DebateAudience>('policymakers');
  const [dialecticalStyle, setDialecticalStyle] = useState<DialecticalStyle>('adversarial');
  const defaultBounds = useMemo(() => {
    try { const w = loadProvisionalWeights(); return w.phase_bounds; } catch { /* telemetry — silent by design: missing weights file is expected on first launch */ return null; }
  }, []);
  const debateConfig = getClientConfig().debate;
  const [confrontationRounds, setConfrontationRounds] = useState(defaultBounds?.max_confrontation_rounds ?? debateConfig.defaultConfrontationRounds);
  const [argumentationRounds, setArgumentationRounds] = useState(defaultBounds?.max_argumentation_rounds ?? debateConfig.defaultArgumentationRounds);
  const [concludingRounds, setConcludingRounds] = useState(defaultBounds?.max_concluding_rounds ?? debateConfig.defaultConcludingRounds);
  const [evaluatorModel, setEvaluatorModel] = useState('');
  const [multiProvider, setMultiProvider] = useState(false);
  const [modelTier, setModelTier] = useState<'basic' | 'advanced'>('basic');
  const [excludedBackends, setExcludedBackends] = useState<Set<string>>(new Set());
  const [stepMode, setStepMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stageModelPreset, setStageModelPreset] = useState<'same' | 'cost-optimized' | 'custom'>('same');
  const [stageModels, setStageModels] = useState<{ brief: string; plan: string; cite: string }>({ brief: '', plan: '', cite: '' });
  const [showModelModal, setShowModelModal] = useState(false);
  const [modalBackend, setModalBackend] = useState<AIBackend>(aiBackend);
  const [hasApiKey, setHasApiKey] = useState<Record<string, boolean>>({});
  const { tier: tierInfo } = useTierInfo();
  const freeTier = isFreeTier(tierInfo);
  const { modalProps: geminiModalProps, checkAndShow: checkGeminiOnboarding } = useGeminiOnboarding();
  // Backends usable for multi-provider debates: key present AND authorized for the
  // user's tier (t/772). Single-model flow keeps using hasApiKey (raw key presence).
  const [availableBackends, setAvailableBackends] = useState<Set<string>>(new Set());
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [otherTab, setOtherTab] = useState<'canned' | 'queued'>('canned');
  const [queuedTopics, setQueuedTopics] = useState<{ text: string; sourceType: DebateSourceType; sourceRef: string; timestamp: string }[]>(() => {
    try {
      const raw = localStorage.getItem('taxonomy-editor-topic-queue');
      return raw ? JSON.parse(raw) : [];
    } catch { /* localStorage parse — silent by design */ return []; }
  });

  const persistQueue = (next: typeof queuedTopics) => {
    setQueuedTopics(next);
    localStorage.setItem('taxonomy-editor-topic-queue', JSON.stringify(next));
  };

  const handleQueueTopic = () => {
    if (!topic.trim()) return;
    const entry = { text: topic.trim(), sourceType, sourceRef: sourceRef.trim(), timestamp: new Date().toISOString() };
    persistQueue([...queuedTopics, entry]);
    onClose();
  };

  const handleRemoveQueued = (idx: number) => {
    persistQueue(queuedTopics.filter((_, i) => i !== idx));
  };

  // t/910 — sharpen the raw topic text via AI before the debate is created.
  // Uses the configured backend/model (api.generateText default) → AC #4.
  const handleImproveTopic = async () => {
    const current = topic.trim();
    if (!current || improvingTopic) return;
    setImprovingTopic(true);
    setImproveError(null);
    setTopicSuggestion(null);
    try {
      const { text } = await api.generateText(improveDebateTopicPrompt(current));
      const improved = text.trim();
      if (improved) setTopicSuggestion(improved);
      else setImproveError('No suggestion returned — try again.');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'new-debate-dialog',
        level: 'error',
        message: 'Failed to improve topic with AI',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setImproveError(err instanceof Error ? err.message : 'Failed to improve topic.');
    } finally {
      setImprovingTopic(false);
    }
  };

  useEffect(() => {
    // Single-model flow: raw key presence per backend (unchanged — t/772 leaves this path alone).
    void Promise.all(
      AI_BACKENDS.map(async (b) => {
        const has = await api.hasApiKey(b.value);
        return [b.value, has] as [string, boolean];
      }),
    ).then(results => setHasApiKey(Object.fromEntries(results)))
      .catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'new-debate-dialog', level: 'warn', message: 'hasApiKey check failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); });
    // Multi-provider flow: real availability (key AND tier authorization). Filtering to
    // available===true means resolveMultiProviderModels never assigns a speaker to a
    // backend the server would reject with 403 at generation time (t/772).
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

  const backendsWithKeys = useMemo(
    () => [...availableBackends].filter(b => !DEBATE_EXCLUDED_BACKENDS.has(b)),
    [availableBackends],
  );

  const activeBackends = useMemo(
    () => backendsWithKeys.filter(b => !excludedBackends.has(b)),
    [backendsWithKeys, excludedBackends],
  );

  const activeModel = freeTier && tierInfo?.pinnedModel ? tierInfo.pinnedModel : (useCustomModel ? customModel : globalModel);
  const activeModelBackend = backendForModel(activeModel);
  const activeModelExcluded = DEBATE_EXCLUDED_BACKENDS.has(activeModelBackend);
  const activeModelHasKey = !activeModelExcluded && (hasApiKey[activeModelBackend] !== false || (freeTier && tierInfo!.allowedBackends.includes(activeModelBackend)));

  const fallbackWarnings = useMemo(() => {
    const chain = FALLBACK_CHAINS[activeModel] ?? [];
    if (!chain.length) return [];
    return chain
      .map(m => ({ model: m, backend: backendForModel(m) }))
      .filter(({ backend }) => hasApiKey[backend] === false)
      .map(({ model, backend }) => `${model} (${backend})`);
  }, [activeModel, hasApiKey]);

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

  // Get situation nodes for potential topics
  const situationNodes = useMemo(() => {
    if (!situations?.nodes) return [];
    return situations.nodes;
  }, [situations]);

  const toggle = (id: SpeakerId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handlePickFile = async () => {
    const result = await api.pickDocumentFile();
    if (result.cancelled || !result.filePath || !result.content) return;
    setSourceRef(result.filePath);
    setSourceContent(result.content);
    setFileName(result.filePath.split('/').pop() || result.filePath);
    if (!topic) {
      const name = result.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      setTopic(`Discuss: ${name}`);
    }
  };

  const handleTopicCardClick = (label: string, description: string) => {
    setTopic(`${label}: ${description}`);
  };

  const hasSource = sourceType === 'topic' || sourceType === 'other'
    ? topic.trim().length > 0
    : sourceType === 'document'
      ? sourceContent.length > 0
      : sourceRef.trim().length > 0;

  const canStart = hasSource && selected.size >= 1 && (multiProvider ? activeBackends.length >= 2 : activeModelHasKey);

  const handleStart = async () => {
    if (!canStart || creating) return;
    await checkGeminiOnboarding();
    setCreating(true);

    let finalTopic = topic.trim();
    let finalContent = sourceContent;

    if (sourceType === 'url') {
      if (!finalTopic) finalTopic = `Discuss: ${sourceRef.trim()}`;
      try {
        const result = await api.fetchUrlContent(sourceRef.trim());
        if (result.error) {
          finalContent = `[Failed to fetch URL content: ${result.error}]`;
        } else {
          finalContent = result.content;
          if (finalContent.length > 100000) {
            finalContent = finalContent.slice(0, 100000) + '\n\n[Content truncated at 100,000 characters]';
          }
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'new-debate-dialog',
          level: 'error',
          message: 'failed to fetch URL content for debate source',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        finalContent = `[Failed to fetch URL content: ${err}]`;
      }
    }

    if (sourceType === 'document' && !finalTopic) {
      finalTopic = `Discuss: ${fileName}`;
    }

    const povers = Array.from(selected);
    if (userIsPover && !povers.includes('user')) povers.push('user');
    const effectiveModel = useCustomModel ? customModel : globalModel;
    localStorage.setItem('taxonomy-editor-last-debate-model', effectiveModel);
    const debateModelOverride = multiProvider ? undefined : (useCustomModel ? customModel : undefined);

    let speakerModels: Record<string, string> | undefined;
    if (multiProvider) {
      try {
        const aiSpeakers = povers.filter(p => p !== 'user');
        const registry = { backends: AI_BACKENDS.map(b => ({ id: b.value, label: b.label })), models: [], debateTiers: DEBATE_TIERS };
        speakerModels = resolveMultiProviderModels(modelTier, activeBackends, aiSpeakers, registry);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'new-debate-dialog',
          level: 'error',
          message: 'Failed to resolve multi-provider models',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setCreating(false);
        return;
      }
    }

    const id = await createDebate(
      finalTopic,
      povers,
      userIsPover,
      sourceType === 'other' ? 'topic' : sourceType,
      sourceType === 'topic' || sourceType === 'other' ? '' : sourceRef.trim(),
      sourceType === 'topic' || sourceType === 'other' ? '' : finalContent,
      debateModelOverride,
      protocolId,
      temperature,
      audience,
      {
        title: debateTitle || undefined,
        background: background.trim() || undefined,
        evaluatorModel: evaluatorModel || undefined,
        useAdaptiveStaging: true,
        phaseBoundsOverride: {
          maxConfrontationRounds: confrontationRounds,
          maxArgumentationRounds: argumentationRounds,
          maxConcludingRounds: concludingRounds,
        },
        speakerModels,
        modelTier: multiProvider ? modelTier : undefined,
        stepMode: stepMode || undefined,
        stageModels: (stageModels.brief || stageModels.plan || stageModels.cite)
          ? { ...(stageModels.brief && { brief: stageModels.brief }), ...(stageModels.plan && { plan: stageModels.plan }), ...(stageModels.cite && { cite: stageModels.cite }) }
          : undefined,
      },
    );
    await loadDebate(id);
    const _creationWeights = (() => { try { const w = loadProvisionalWeights(); const p = w.pacing_presets?.moderate; return { pacing: 'moderate', maxTotalRounds: p?.maxTotalRounds, argumentationExit: p?.argumentationExit, concludingExit: p?.concludingExit, phase_bounds: w.phase_bounds, overrides: { confrontation: confrontationRounds, argumentation: argumentationRounds, concluding: concludingRounds } }; } catch { /* telemetry — silent by design: weights unavailable is non-fatal */ return null; } })();
    getGlobalRecorder()?.record({ type: 'user.action', component: 'new-debate', level: 'info', message: 'debate.created', data: { debate_id: id, source_type: sourceType, povers, user_is_pover: userIsPover, model: effectiveModel, protocol: protocolId, temperature, audience: audience || null, adaptive_staging: true, step_mode: stepMode || undefined, multi_provider: multiProvider || undefined, model_tier: multiProvider ? modelTier : undefined, speaker_models: speakerModels || undefined, stage_models: (stageModels.brief || stageModels.plan || stageModels.cite) ? stageModels : undefined, ..._creationWeights && { adaptive_config: _creationWeights } } });
    const store = useDebateStore.getState();
    store.updatePhase('clarification');
    await store.saveDebate();
    // Open debate in popout window
    api.openDebateWindow(id).catch(() => { /* fallback: stays inline */ });
    onClose();
  };

  const temperatureLabel =
    temperature <= 0.3 ? 'Focused' : temperature <= 0.7 ? 'Balanced' : temperature <= 1.0 ? 'Creative' : 'Wild';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="ndd-fullpage" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ndd-header">
          <h2 className="ndd-title">New Debate</h2>
          <button className="ndd-close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {/* Two-column body */}
        <div className="ndd-body">
          {/* ─── Left Column: Debate Details ─── */}
          <div className="ndd-col-left">
            <h3 className="ndd-section-heading">Debate Details</h3>

            {/* Title (optional) */}
            <label className="ndd-field-label">Title</label>
            <input
              className="ndd-title-input"
              type="text"
              placeholder="e.g. Strict Liability in AI Deployment"
              value={debateTitle}
              onChange={(e) => setDebateTitle(e.target.value.slice(0, 120))}
              maxLength={120}
            />

            {/* Source type radios */}
            <label className="ndd-field-label">Source</label>
            <div className="ndd-source-types">
              {(['topic', 'document', 'url', 'other'] as DebateSourceType[]).map(st => (
                <label key={st} className={`ndd-source-option${sourceType === st ? ' active' : ''}`}>
                  <input type="radio" name="sourceType" value={st} checked={sourceType === st} onChange={() => setSourceType(st)} />
                  <span className="ndd-source-icon">{SOURCE_ICONS[st]}</span>
                  <span className="ndd-source-text">{st === 'url' ? 'URL' : st.charAt(0).toUpperCase() + st.slice(1)}</span>
                </label>
              ))}
            </div>

            {/* Topic textarea (always shown for topic; conditional for doc/url) */}
            {sourceType === 'topic' && (
              <>
                <label className="ndd-field-label">Topic</label>
                <AutoGrowTextarea
                  className="ndd-topic-input"
                  placeholder="What should we debate? Type your own or pick from Potential Topics below."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </>
            )}

            {sourceType === 'document' && (
              <>
                <label className="ndd-field-label">Document</label>
                <div className="ndd-file-picker">
                  <button className="btn" onClick={handlePickFile}>
                    {fileName ? fileName : 'Choose file...'}
                  </button>
                  {sourceContent && (
                    <span className="ndd-file-info">{Math.round(sourceContent.length / 1024)}KB loaded</span>
                  )}
                </div>
                <label className="ndd-field-label">Topic (optional)</label>
                <AutoGrowTextarea
                  className="ndd-topic-input"
                  placeholder="Focus the debate on a specific aspect of this document..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={2}
                />
              </>
            )}

            {sourceType === 'url' && (
              <>
                <label className="ndd-field-label">URL</label>
                <input
                  className="ndd-url-input"
                  type="url"
                  placeholder="https://example.com/article"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  autoFocus
                />
                <label className="ndd-field-label">Topic (optional)</label>
                <AutoGrowTextarea
                  className="ndd-topic-input"
                  placeholder="Focus the debate on a specific aspect of this content..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={2}
                />
              </>
            )}

            {/* "Other" source: tabbed Canned / Queued topics */}
            {sourceType === 'other' && (
              <>
                <label className="ndd-field-label">Topic</label>
                <AutoGrowTextarea
                  className="ndd-topic-input"
                  placeholder="Type a custom topic or pick from Canned / Queued below."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className="ndd-other-tabs">
                  <button
                    className={`ndd-other-tab${otherTab === 'canned' ? ' active' : ''}`}
                    onClick={() => setOtherTab('canned')}
                  >
                    Canned Topics ({situationNodes.length})
                  </button>
                  <button
                    className={`ndd-other-tab${otherTab === 'queued' ? ' active' : ''}`}
                    onClick={() => setOtherTab('queued')}
                  >
                    Queued Topics ({queuedTopics.length})
                  </button>
                </div>
                {otherTab === 'canned' && situationNodes.length > 0 && (
                  <div className="ndd-potential-topics">
                    {situationNodes.map(node => (
                      <button
                        key={node.id}
                        className={`ndd-topic-card${topic.startsWith(node.label) ? ' selected' : ''}`}
                        onClick={() => handleTopicCardClick(node.label, node.description)}
                      >
                        <div className="ndd-topic-card-header">
                          <span className="ndd-topic-card-icon">{'\uD83D\uDCA1'}</span>
                          <span className="ndd-topic-card-title">{node.label}</span>
                        </div>
                        <p className="ndd-topic-card-desc">{node.description}</p>
                      </button>
                    ))}
                  </div>
                )}
                {otherTab === 'queued' && (
                  <div className="ndd-potential-topics">
                    {queuedTopics.length === 0 && (
                      <p className="ndd-queued-empty">
                        No queued topics yet. Use "Queue Topic" to save topics for later.
                      </p>
                    )}
                    {queuedTopics.map((qt, idx) => (
                      <button
                        key={idx}
                        className={`ndd-topic-card${topic === qt.text ? ' selected' : ''}`}
                        onClick={() => setTopic(qt.text)}
                      >
                        <div className="ndd-topic-card-header">
                          <span className="ndd-topic-card-icon">{'\uD83D\uDCCB'}</span>
                          <span className="ndd-topic-card-title ndd-flex-1">{qt.text.slice(0, 80)}{qt.text.length > 80 ? '…' : ''}</span>
                          <span
                            className="ndd-queued-remove"
                            title="Remove from queue"
                            onClick={(e) => { e.stopPropagation(); handleRemoveQueued(idx); }}
                          >
                            &times;
                          </span>
                        </div>
                        <p className="ndd-topic-card-desc ndd-topic-card-desc-queued">
                          Queued {new Date(qt.timestamp).toLocaleDateString()}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {/* Background context — supporting info kept separate from the topic question (t/917) */}
            <label className="ndd-field-label">Background (optional)</label>
            <AutoGrowTextarea
              className="ndd-topic-input"
              placeholder="Supporting context for the debate — constraints, prior decisions, domain details. Given to the AI as background, kept separate from the topic question."
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              rows={2}
            />

            {/* Improve with AI — inline topic refinement (t/910) */}
            {topic.trim() && (
              <div className="ndd-improve-section">
                <button
                  type="button"
                  className="btn ndd-btn-xs"
                  onClick={() => void handleImproveTopic()}
                  disabled={improvingTopic}
                  title="Use AI to sharpen this topic into a clearer, more debatable question"
                >
                  {improvingTopic ? 'Improving…' : '✨ Improve with AI'}
                </button>
                {improveError && (
                  <div className="ndd-error-text">{improveError}</div>
                )}
                {topicSuggestion && (
                  <div className="ndd-suggestion-box">
                    <div className="ndd-suggestion-label">Suggested topic</div>
                    <p className="ndd-suggestion-text">{topicSuggestion}</p>
                    <div className="ndd-suggestion-actions">
                      <button
                        type="button"
                        className="btn btn-primary ndd-btn-xs"
                        onClick={() => { setTopic(topicSuggestion); setTopicSuggestion(null); setImproveError(null); }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn ndd-btn-xs"
                        onClick={() => setTopicSuggestion(null)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Right Column: Configuration ─── */}
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
              </div>
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
                  {backendsWithKeys.map(b => {
                    const tierModels = DEBATE_TIERS[modelTier];
                    const hasModel = tierModels && tierModels[b];
                    const isExcluded = excludedBackends.has(b);
                    const isLastActive = !isExcluded && activeBackends.length <= 2;
                    return (
                      <button
                        key={b}
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
                        style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem',
                          cursor: (!isExcluded && isLastActive) ? 'not-allowed' : 'pointer',
                          opacity: isExcluded ? 0.4 : 1,
                          background: isExcluded ? 'var(--bg-tertiary)' : hasModel ? 'var(--accent-bg, rgba(59,130,246,0.15))' : 'var(--bg-tertiary)',
                          color: isExcluded ? 'var(--text-muted)' : hasModel ? 'var(--accent, #3b82f6)' : 'var(--text-muted)',
                          border: `1px solid ${isExcluded ? 'var(--border)' : hasModel ? 'var(--accent, #3b82f6)' : 'var(--border)'}`,
                          textDecoration: isExcluded ? 'line-through' : 'none',
                        }}
                      >
                        {b} {isExcluded ? '✗' : hasModel ? '✓' : '—'}
                      </button>
                    );
                  })}
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
        </div>

        {/* Footer */}
        <div className="ndd-footer">
          <button className="btn ndd-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="btn ndd-queue-btn"
            onClick={handleQueueTopic}
            disabled={!topic.trim() || creating}
            title="Save this topic to the queue for later"
          >
            Queue Topic
          </button>
          <button className="btn btn-primary ndd-start-btn" onClick={handleStart} disabled={!canStart || creating}>
            {creating ? 'Creating...' : 'Start Debate'}
          </button>
        </div>

        {/* Model Configuration Modal */}
        {showModelModal && (
          <div className="ndd-model-overlay" onClick={() => setShowModelModal(false)}>
            <div className="ndd-model-dialog" onClick={e => e.stopPropagation()}>
              <div className="ndd-model-dialog-header">
                <h3>Model Configuration</h3>
                <button className="ndd-close-btn" onClick={() => setShowModelModal(false)} aria-label="Close">&times;</button>
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
                  onClick={() => setShowModelModal(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
        <GeminiOnboardingModal {...geminiModalProps} />
      </div>
    </div>
  );
}

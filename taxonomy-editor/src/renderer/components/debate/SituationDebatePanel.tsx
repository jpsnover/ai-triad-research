// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './SituationDebatePanel.css';
import type { SituationNode } from '../../types/taxonomy';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../../hooks/useTaxonomyStore';
import { useShallow } from 'zustand/react/shallow';
import { POVER_INFO, DEBATE_AUDIENCES } from '../../types/debate';
import type { SpeakerId, DebateAudience } from '../../types/debate';
import { AI_POVERS } from '@lib/debate/types';
import type { DebateSession } from '../../types/debate';
import { DEBATE_PROTOCOLS } from '../../data/debateProtocols';
import { api } from '@bridge';
import { subscribeToSituationDebateStart } from './waitForSituationDebateStart';

type DebatePacing = 'tight' | 'moderate' | 'thorough';

const PACING_PRESETS: { id: DebatePacing; label: string; desc: string }[] = [
  { id: 'tight', label: 'Tight', desc: 'Shorter, focused exchanges.' },
  { id: 'moderate', label: 'Moderate', desc: 'Balanced depth.' },
  { id: 'thorough', label: 'Thorough', desc: 'Deep dive, longer exploration.' },
];

interface SituationDebateConfig {
  effectiveModel?: string;
  pacing: DebatePacing;
  useAdaptiveStaging: boolean;
  temperature: number;
  audience: DebateAudience;
  protocolId: string;
}

// Apply the panel's non-default config onto a freshly created session (t/1915:
// extracted from handleLaunch to keep that handler under the complexity ceiling).
// Mirrors the original inline order exactly; only non-default values are written.
function applySituationDebateConfig(session: DebateSession, cfg: SituationDebateConfig) {
  if (cfg.effectiveModel) session.debate_model = cfg.effectiveModel;
  // t/3783: mirrors sessionSlice.ts's createDebate() template for the regular-debate
  // path — phase_bounds_override/step_mode aren't applicable here (situation debates
  // don't expose per-phase round overrides), so this is the minimal correct subset,
  // not an independently-invented shape.
  if (cfg.useAdaptiveStaging) session.adaptive_staging = { enabled: true, pacing: cfg.pacing };
  if (cfg.temperature !== 0.7) session.debate_temperature = cfg.temperature;
  if (cfg.audience !== 'policymakers') session.audience = cfg.audience;
  if (cfg.protocolId !== 'structured') session.protocol_id = cfg.protocolId;
}

interface SituationDebatePanelProps {
  node: SituationNode;
}

export function SituationDebatePanel({ node }: SituationDebatePanelProps) {
  const { createDebate, loadDebate } = useDebateStore(
    useShallow(s => ({ createDebate: s.createDebate, loadDebate: s.loadDebate }))
  );
  const createSituationDebate = useDebateStore(s => s.createSituationDebate);
  const { geminiModel, setActiveTab } = useTaxonomyStore();

  const availableModels = useMemo(() =>
    Object.entries(MODELS_BY_BACKEND).flatMap(([backend, models]) =>
      models.map(m => ({ ...m, label: `${m.label} (${backend})` }))
    ), []);

  // Configuration state
  const [selected, setSelected] = useState<Set<SpeakerId>>(new Set(AI_POVERS));
  const [userIsPover, setUserIsPover] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState(geminiModel);
  const [protocolId, setProtocolId] = useState('structured');
  const [pacing, setPacing] = useState<DebatePacing>('moderate');
  const [temperature, setTemperature] = useState(0.7);
  const [audience, setAudience] = useState<DebateAudience>('policymakers');
  // t/3783: always on — matches NewDebateDialog's unconditional useAdaptiveStaging
  // default; there's no meaningful "pacing without adaptive staging" state to offer.
  const useAdaptiveStaging = true;
  const [launching, setLaunching] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const toggle = (id: SpeakerId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const canStart = selected.size >= 2;

  const handleLaunch = () => {
    if (!canStart || launching) return;
    setLaunching(true);
    setLaunchError(null);

    const povers = Array.from(selected);
    if (userIsPover && !povers.includes('user')) povers.push('user');
    const effectiveModel = useCustomModel ? customModel : undefined;

    // t/3749: setActiveTab alone only lands on the Debate tab's summary card
    // (a manual "Open in Window" button) — open the popout directly, mirroring
    // NewDebateDialog's working path, so Start actually takes the user somewhere.
    const openAndNavigate = async (id: string) => {
      try {
        const result = await api.openDebateWindow(id);
        if (result && 'atCap' in result && result.atCap) {
          setLaunchError('Close a debate window — max 5 open — then open this one from the Debates list.');
        }
      } catch (openErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'situation-debate',
          level: 'warn',
          debate_id: id,
          message: 'Failed to open debate popout window after situation debate launch',
          error: { name: (openErr as Error).name ?? 'Error', message: String(openErr), stack: (openErr as Error).stack },
        });
        setLaunchError('Debate created but the window failed to open — find it in the Debates list.');
      }
      setActiveTab('debate');
      setLaunching(false);
    };

    // t/3752: navigate as soon as the debate record exists (fires inside
    // createSituationDebate's createDebate() call) instead of blocking on the
    // full watch-only opening round (enterClarificationOrBegin, t/3629 — don't touch).
    const unsubscribe = subscribeToSituationDebateStart(node.id, (id) => {
      unsubscribe();
      void openAndNavigate(id);
    });

    // Use createSituationDebate for the enrichment, but we need to pass config.
    // Since createSituationDebate doesn't accept config, call createDebate directly
    // with the situation context built the same way.
    createSituationDebate(node.id)
      .then(async () => {
        // Update the session with custom config if non-default. Kept off the
        // navigation path per t/3752 — this still runs against the same
        // in-progress promise, just no longer gates when the user sees the debate.
        const store = useDebateStore.getState();
        const session = store.activeDebate;
        if (session) {
          applySituationDebateConfig(session, { effectiveModel, pacing, useAdaptiveStaging, temperature, audience, protocolId });
          await store.saveDebate('SituationDebatePanel:applyConfig');
        }
        setLaunching(false);
      })
      .catch((err) => {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'situation-debate', level: 'error', message: 'debate launch failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        setLaunchError(err instanceof Error ? err.message : 'Failed to start debate. Please try again.');
        setLaunching(false);
      })
      .finally(() => {
        unsubscribe();
      });
  };

  // Past debates linked to this situation
  const debateRefs = node.debate_refs || [];

  return (
    <div className="sit-debate-panel">
      {/* Past debates */}
      {debateRefs.length > 0 && (
        <div className="sit-debate-history">
          <h4 className="sit-debate-section-title">Past Debates ({debateRefs.length})</h4>
          <div className="sit-debate-history-list">
            {debateRefs.map(id => (
              <PastDebateLink key={id} debateId={id} />
            ))}
          </div>
        </div>
      )}

      {/* New debate config */}
      <div className="sit-debate-config">
        <h4 className="sit-debate-section-title">New Situation Debate</h4>
        <p className="sit-debate-desc">
          Each debater will defend their Perspective's interpretation of this situation.
          The moderator steers toward unaddressed BDI dimensions.
        </p>

        {/* Debaters */}
        <label className="sit-debate-label">Debaters</label>
        <div className="sit-debate-debaters">
          {AI_POVERS.map(id => {
            const info = POVER_INFO[id];
            return (
              <label key={id} className={`sit-debate-debater${selected.has(id) ? ' active' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(id)}
                  onChange={() => toggle(id)}
                />
                <span className="sit-debate-debater-name">{info.label}</span>
                <span className="sit-debate-debater-pov">{info.pov}</span>
              </label>
            );
          })}
          <label className={`sit-debate-debater${userIsPover ? ' active' : ''}`}>
            <input
              type="checkbox"
              checked={userIsPover}
              onChange={(e) => setUserIsPover(e.target.checked)}
            />
            <span className="sit-debate-debater-name">You</span>
            <span className="sit-debate-debater-pov">participate</span>
          </label>
        </div>

        {/* Format */}
        <label className="sit-debate-label">Format</label>
        <div className="sit-debate-format-row">
          {DEBATE_PROTOCOLS.map(p => (
            <label key={p.id} className={`sit-debate-format-opt${protocolId === p.id ? ' active' : ''}`}>
              <input type="radio" name="sit-protocol" value={p.id} checked={protocolId === p.id} onChange={() => setProtocolId(p.id)} />
              <span>{p.label}</span>
            </label>
          ))}
        </div>

        {/* Pacing */}
        <label className="sit-debate-label">Pacing</label>
        <div className="sit-debate-pacing-row">
          {PACING_PRESETS.map(p => (
            <label key={p.id} className={`sit-debate-pacing-opt${pacing === p.id ? ' active' : ''}`} title={p.desc}>
              <input type="radio" name="sit-pacing" value={p.id} checked={pacing === p.id} onChange={() => setPacing(p.id)} />
              <span>{p.label}</span>
            </label>
          ))}
        </div>

        {/* Model */}
        <label className="sit-debate-label">Model</label>
        <div className="sit-debate-model">
          <label className="sit-debate-model-toggle">
            <input type="checkbox" checked={useCustomModel} onChange={(e) => setUseCustomModel(e.target.checked)} />
            Custom model
          </label>
          {useCustomModel ? (
            <select className="sit-debate-model-select" value={customModel} onChange={(e) => setCustomModel(e.target.value as typeof customModel)}>
              {availableModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          ) : (
            <span className="sit-debate-model-current">{geminiModel}</span>
          )}
        </div>

        {/* Advanced */}
        <button className="sit-debate-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? 'Hide advanced ▲' : 'Advanced ▼'}
        </button>

        {showAdvanced && (
          <div className="sit-debate-advanced">
            <label className="sit-debate-label">Temperature ({temperature.toFixed(1)})</label>
            <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />

            <label className="sit-debate-label">Audience</label>
            <select className="sit-debate-audience-select" value={audience} onChange={(e) => setAudience(e.target.value as DebateAudience)}>
              {DEBATE_AUDIENCES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        )}

        {/* Launch */}
        <button
          className="btn btn-primary sit-debate-launch"
          disabled={!canStart || launching}
          onClick={handleLaunch}
        >
          {launching ? 'Starting...' : 'Start Situation Debate'}
        </button>

        {launchError && (
          <div className="sit-debate-launch-error" role="alert">
            {launchError}
            <button type="button" className="sit-debate-launch-retry" onClick={handleLaunch}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shows a past debate linked to this situation */
function PastDebateLink({ debateId }: { debateId: string }) {
  const loadDebate = useDebateStore(s => s.loadDebate);
  const setActiveTab = useTaxonomyStore(s => s.setActiveTab);

  const handleClick = async () => {
    await loadDebate(debateId);
    setActiveTab('debate');
  };

  return (
    <button className="sit-debate-history-item" onClick={handleClick} title={`Load debate ${debateId}`}>
      <span className="sit-debate-history-id">{debateId.slice(0, 8)}...</span>
    </button>
  );
}

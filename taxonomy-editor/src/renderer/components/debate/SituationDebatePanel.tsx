// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './SituationDebatePanel.css';
import type { SituationNode } from '../../types/taxonomy';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../../hooks/useTaxonomyStore';
import { POVER_INFO, DEBATE_AUDIENCES } from '../../types/debate';
import type { SpeakerId, DebateAudience } from '../../types/debate';
import { AI_POVERS } from '@lib/debate/types';
import { DEBATE_PROTOCOLS } from '../../data/debateProtocols';
import { api } from '@bridge';
import { subscribeToSituationDebateStart } from './waitForSituationDebateStart';
import { PRESET_DEFAULTS } from './NewDebateDialog';

type DebatePacing = 'tight' | 'moderate' | 'thorough';

// t/3928 (PI decision, t/3882#4): situation pacing maps to the SAME per-phase round bounds
// as the normal debate presets — TIGHT=Quick, MODERATE=Deep, THOROUGH=Socratic's bounds —
// reusing the constants (not copying the numbers) so the two paths can't drift apart.
const PACING_TO_PRESET: Record<DebatePacing, 'quick' | 'deep' | 'socratic'> = {
  tight: 'quick',
  moderate: 'deep',
  thorough: 'socratic',
};

function phaseBoundsForPacing(pacing: DebatePacing) {
  const p = PRESET_DEFAULTS[PACING_TO_PRESET[pacing]];
  return {
    maxConfrontationRounds: p.confrontationRounds,
    maxArgumentationRounds: p.argumentationRounds,
    maxConcludingRounds: p.concludingRounds,
  };
}

function totalRounds(pacing: DebatePacing): number {
  const p = PRESET_DEFAULTS[PACING_TO_PRESET[pacing]];
  return p.confrontationRounds + p.argumentationRounds + p.concludingRounds;
}

const PACING_PRESETS: { id: DebatePacing; label: string; desc: string }[] = [
  { id: 'tight', label: 'Tight', desc: `${totalRounds('tight')} rounds, focused exchanges.` },
  { id: 'moderate', label: 'Moderate', desc: `${totalRounds('moderate')} rounds, balanced depth.` },
  { id: 'thorough', label: 'Thorough', desc: `${totalRounds('thorough')} rounds, deep dive, longer exploration.` },
];

interface SituationDebatePanelProps {
  node: SituationNode;
}

export function SituationDebatePanel({ node }: SituationDebatePanelProps) {
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

    // t/3783: config is threaded into createSituationDebate so adaptive_staging
    // (and the rest) exist at creation time, not patched onto activeDebate
    // afterward — a post-creation mutate-then-save was silently discarded by
    // clarificationSlice's concurrent `set({ activeDebate: { ...fresh } })`
    // replacements during the opening/clarification pipeline (TL diagnosis, t/3783#4).
    createSituationDebate(node.id, { effectiveModel, pacing, useAdaptiveStaging, temperature, audience, protocolId, phaseBoundsOverride: phaseBoundsForPacing(pacing) })
      .then(() => {
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

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import type { SituationNode } from '../types/taxonomy';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../hooks/useTaxonomyStore';
import { useShallow } from 'zustand/react/shallow';
import { POVER_INFO, DEBATE_AUDIENCES } from '../types/debate';
import type { SpeakerId, DebateAudience } from '../types/debate';
import { AI_POVERS } from '@lib/debate/types';
import { DEBATE_PROTOCOLS } from '../data/debateProtocols';

type DebatePacing = 'tight' | 'moderate' | 'thorough';

const PACING_PRESETS: { id: DebatePacing; label: string; desc: string }[] = [
  { id: 'tight', label: 'Tight', desc: 'Shorter, focused exchanges.' },
  { id: 'moderate', label: 'Moderate', desc: 'Balanced depth.' },
  { id: 'thorough', label: 'Thorough', desc: 'Deep dive, longer exploration.' },
];

interface SituationDebatePanelProps {
  node: SituationNode;
  onLaunched: () => void;
}

export function SituationDebatePanel({ node, onLaunched }: SituationDebatePanelProps) {
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
  const [useAdaptiveStaging, setUseAdaptiveStaging] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggle = (id: SpeakerId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const canStart = selected.size >= 2;

  const handleLaunch = async () => {
    if (!canStart || launching) return;
    setLaunching(true);
    try {
      const povers = Array.from(selected);
      if (userIsPover && !povers.includes('user')) povers.push('user');
      const effectiveModel = useCustomModel ? customModel : undefined;

      // Use createSituationDebate for the enrichment, but we need to pass config.
      // Since createSituationDebate doesn't accept config, call createDebate directly
      // with the situation context built the same way.
      const id = await createSituationDebate(node.id);

      // Update the session with custom config if non-default
      const store = useDebateStore.getState();
      const session = store.activeDebate;
      if (session) {
        if (effectiveModel) session.debate_model = effectiveModel;
        if (pacing !== 'moderate') (session as Record<string, unknown>).pacing = pacing;
        if (useAdaptiveStaging) (session as Record<string, unknown>).adaptive_staging = true;
        if (temperature !== 0.7) (session as Record<string, unknown>).temperature = temperature;
        if (audience !== 'policymakers') (session as Record<string, unknown>).audience = audience;
        if (protocolId !== 'structured') (session as Record<string, unknown>).protocol_id = protocolId;
        await store.saveDebate();
      }

      setActiveTab('debate');
      onLaunched();
    } catch (err) {
      console.error('[SituationDebatePanel] Launch failed:', err);
    } finally {
      setLaunching(false);
    }
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
            <select className="sit-debate-model-select" value={customModel} onChange={(e) => setCustomModel(e.target.value)}>
              {availableModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          ) : (
            <span className="sit-debate-model-current">{geminiModel}</span>
          )}
        </div>

        {/* Adaptive staging */}
        <label className="sit-debate-adaptive">
          <input type="checkbox" checked={useAdaptiveStaging} onChange={(e) => setUseAdaptiveStaging(e.target.checked)} />
          Adaptive staging
          {useAdaptiveStaging && <span className="sit-debate-badge">Experimental</span>}
        </label>

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

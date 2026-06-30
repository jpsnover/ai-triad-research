// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import type { ExplorationSummary } from '@lib/debate/explorationSummary';

const PACING_OPTIONS = ['quick', 'moderate', 'thorough'] as const;

function CruxList({ cruxes, onRemove }: { cruxes: ExplorationSummary['cruxes']; onRemove: (index: number) => void }) {
  if (cruxes.length === 0) {
    return <div className="exploration-empty">No cruxes discovered during exploration.</div>;
  }

  return (
    <ul className="exploration-crux-list">
      {cruxes.map((crux, i) => (
        <li key={i} className="exploration-crux-item">
          <div className="exploration-crux-content">
            <span className="exploration-crux-description">{crux.description}</span>
            <span className={`exploration-crux-badge exploration-crux-badge--${crux.disagreement_type}`}>
              {crux.disagreement_type}
            </span>
          </div>
          <button
            className="btn btn-sm exploration-remove-btn"
            onClick={() => onRemove(i)}
            title="Remove this crux from production seeding"
          >
            &times;
          </button>
        </li>
      ))}
    </ul>
  );
}

function SituationList({
  effective,
  ineffective,
  onToggle,
}: {
  effective: ExplorationSummary['effective_situations'];
  ineffective: ExplorationSummary['ineffective_situations'];
  onToggle: (id: string, currentlyEffective: boolean) => void;
}) {
  if (effective.length === 0 && ineffective.length === 0) {
    return <div className="exploration-empty">No situation data from exploration.</div>;
  }

  return (
    <div className="exploration-situation-list">
      {effective.map(s => (
        <label key={s.id} className="exploration-situation-item">
          <input type="checkbox" checked onChange={() => onToggle(s.id, true)} />
          <span className="exploration-situation-label">{s.label || s.id}</span>
          <span className="exploration-situation-refs">{s.referenced_turns} ref{s.referenced_turns !== 1 ? 's' : ''}</span>
        </label>
      ))}
      {ineffective.map(s => (
        <label key={s.id} className="exploration-situation-item exploration-situation-item--ineffective">
          <input type="checkbox" checked={false} onChange={() => onToggle(s.id, false)} />
          <span className="exploration-situation-label">{s.label || s.id}</span>
        </label>
      ))}
    </div>
  );
}

function ConfigOverrides({
  config,
  onChange,
}: {
  config: ExplorationSummary['recommended_config'];
  onChange: (updates: Partial<ExplorationSummary['recommended_config']>) => void;
}) {
  return (
    <div className="exploration-config-grid">
      <label className="exploration-config-field">
        <span>Max Rounds</span>
        <input
          type="number"
          min={4}
          max={30}
          value={config.max_rounds}
          onChange={e => onChange({ max_rounds: parseInt(e.target.value, 10) || config.max_rounds })}
        />
      </label>
      <label className="exploration-config-field">
        <span>Temperature</span>
        <input
          type="number"
          min={0}
          max={1.5}
          step={0.05}
          value={config.temperature}
          onChange={e => onChange({ temperature: parseFloat(e.target.value) || config.temperature })}
        />
      </label>
      <label className="exploration-config-field">
        <span>Pacing</span>
        <select
          value={config.pacing}
          onChange={e => onChange({ pacing: e.target.value as typeof config.pacing })}
        >
          {PACING_OPTIONS.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </label>
      <label className="exploration-config-field">
        <span>Situation Cap</span>
        <input
          type="number"
          min={3}
          max={40}
          value={config.situation_cap}
          onChange={e => onChange({ situation_cap: parseInt(e.target.value, 10) || config.situation_cap })}
        />
      </label>
    </div>
  );
}

export function ExplorationSummaryCard() {
  const {
    explorationSummary,
    explorationSourceId,
    updateExplorationSummary,
    clearExplorationSummary,
    startSeededDebate,
    debateGenerating,
  } = useDebateStore(
    useShallow(s => ({
      explorationSummary: s.explorationSummary,
      explorationSourceId: s.explorationSourceId,
      updateExplorationSummary: s.updateExplorationSummary,
      clearExplorationSummary: s.clearExplorationSummary,
      startSeededDebate: s.startSeededDebate,
      debateGenerating: s.debateGenerating,
    })),
  );

  const [starting, setStarting] = useState(false);

  const summary = explorationSummary;
  if (!summary) return null;

  const isEmpty = summary.cruxes.length === 0
    && summary.effective_situations.length === 0
    && summary.argument_sketch.nodes.length === 0;

  const handleRemoveCrux = useCallback((index: number) => {
    const updated = { ...summary, cruxes: summary.cruxes.filter((_, i) => i !== index) };
    updateExplorationSummary(updated);
  }, [summary, updateExplorationSummary]);

  const handleToggleSituation = useCallback((id: string, currentlyEffective: boolean) => {
    if (currentlyEffective) {
      const situation = summary.effective_situations.find(s => s.id === id);
      if (!situation) return;
      updateExplorationSummary({
        ...summary,
        effective_situations: summary.effective_situations.filter(s => s.id !== id),
        ineffective_situations: [...summary.ineffective_situations, { id: situation.id, label: situation.label }],
      });
    } else {
      const situation = summary.ineffective_situations.find(s => s.id === id);
      if (!situation) return;
      updateExplorationSummary({
        ...summary,
        ineffective_situations: summary.ineffective_situations.filter(s => s.id !== id),
        effective_situations: [...summary.effective_situations, { id: situation.id, label: situation.label, referenced_turns: 0, match_type: 'semantic_match' }],
      });
    }
  }, [summary, updateExplorationSummary]);

  const handleConfigChange = useCallback((updates: Partial<ExplorationSummary['recommended_config']>) => {
    updateExplorationSummary({
      ...summary,
      recommended_config: { ...summary.recommended_config, ...updates },
    });
  }, [summary, updateExplorationSummary]);

  const handleStartProduction = async () => {
    setStarting(true);
    try {
      await startSeededDebate();
    } finally {
      setStarting(false);
    }
  };

  const qualityScore = summary.quality_summary.mean_process_reward;
  const convergenceScore = summary.convergence_profile.final_convergence_score;

  return (
    <div className="exploration-summary-card">
      <div className="exploration-summary-header">
        <h3>Exploration Summary</h3>
        <button
          className="btn btn-sm"
          onClick={clearExplorationSummary}
          title="Dismiss exploration summary"
        >
          Dismiss
        </button>
      </div>

      {isEmpty && (
        <div className="exploration-empty-banner">
          Exploration found no strong signals — the topic may be too narrow or the exploration too brief.
          You can still start a production debate without seeding.
        </div>
      )}

      <div className="exploration-stats">
        <span title="Cruxes discovered">{summary.cruxes.length} crux{summary.cruxes.length !== 1 ? 'es' : ''}</span>
        <span title="Argument network nodes">{summary.argument_sketch.nodes.length} AN nodes</span>
        <span title="Effective situations">{summary.effective_situations.length} effective sit.</span>
        {summary.phase_dynamics.total_rounds > 0 && (
          <span title="Exploration rounds">{summary.phase_dynamics.total_rounds} rounds</span>
        )}
        {qualityScore > 0 && (
          <span title="Mean process reward">{qualityScore.toFixed(2)} quality</span>
        )}
        {convergenceScore != null && (
          <span title="Final convergence score">{convergenceScore.toFixed(2)} convergence</span>
        )}
      </div>

      {summary.convergence_profile.areas_of_agreement.length > 0 && (
        <div className="exploration-section">
          <h4>Areas of Agreement</h4>
          <ul className="exploration-convergence-list">
            {summary.convergence_profile.areas_of_agreement.map((area, i) => (
              <li key={i}>{area}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.convergence_profile.areas_of_disagreement.length > 0 && (
        <div className="exploration-section">
          <h4>Areas of Disagreement</h4>
          <ul className="exploration-convergence-list">
            {summary.convergence_profile.areas_of_disagreement.map((area, i) => (
              <li key={i}>{area}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="exploration-section">
        <h4>Cruxes ({summary.cruxes.length})</h4>
        <CruxList cruxes={summary.cruxes} onRemove={handleRemoveCrux} />
      </div>

      <div className="exploration-section">
        <h4>Situations</h4>
        <SituationList
          effective={summary.effective_situations}
          ineffective={summary.ineffective_situations}
          onToggle={handleToggleSituation}
        />
      </div>

      <div className="exploration-section">
        <h4>Recommended Config</h4>
        <ConfigOverrides config={summary.recommended_config} onChange={handleConfigChange} />
      </div>

      <div className="exploration-summary-footer">
        <button
          className="btn btn-primary"
          onClick={handleStartProduction}
          disabled={starting || !!debateGenerating}
        >
          {starting ? 'Creating...' : 'Start Production Debate'}
        </button>
        {isEmpty && (
          <span className="exploration-footer-hint">
            Production debate will run without exploration seeding
          </span>
        )}
      </div>
    </div>
  );
}

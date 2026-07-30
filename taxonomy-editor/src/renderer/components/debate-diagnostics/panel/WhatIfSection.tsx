// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useFlag } from '../../../hooks/useFeatureFlags';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../types/debate';
import { CollapsibleSection, speakerLabel } from './helpers';

/** What-If Mode (D-Q6): counterfactual strength propagation via DF-QuAD. */
export function WhatIfSection({ nodes, edges }: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] }) {
  const qbafEnabled = useFlag('release-qbaf-analysis');
  const [active, setActive] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // Original strengths from the debate data
  const originalStrengths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of nodes) {
      if (n.computed_strength != null) map[n.id] = n.computed_strength;
      else if (n.base_strength != null) map[n.id] = n.base_strength;
    }
    return map;
  }, [nodes]);

  // Counterfactual: re-run DF-QuAD with overridden base_strengths
  const whatIfStrengths = useMemo(() => {
    if (!active || Object.keys(overrides).length === 0) return null;

    const qbafNodes: QbafNode[] = nodes
      .filter(n => n.base_strength != null)
      .map(n => ({
        id: n.id,
        base_strength: overrides[n.id] ?? n.base_strength ?? 0.5,
      }));
    const qbafEdges: QbafEdge[] = edges
      .filter(e => e.weight != null)
      .map(e => ({
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight!,
        attack_type: e.attack_type,
      }));

    if (qbafNodes.length === 0) return null;
    const result = computeQbafStrengths(qbafNodes, qbafEdges);
    const map: Record<string, number> = {};
    for (const [id, val] of result.strengths) map[id] = val;
    return map;
  }, [active, overrides, nodes, edges]);

  const scoredNodes = nodes.filter(n => n.base_strength != null);
  if (!qbafEnabled || scoredNodes.length === 0) return null;

  const handleSliderChange = (nodeId: string, value: number) => {
    setOverrides(prev => ({ ...prev, [nodeId]: value }));
  };

  const handleReset = () => {
    setOverrides({});
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <CollapsibleSection title={`What-If Mode — counterfactual strength propagation${active ? ' (active)' : ''}`} defaultOpen={active}>
      <div className="whatif-header">
        <button
          className={`btn btn-sm whatif-toggle ${active ? 'whatif-toggle-active' : ''}`}
          onClick={() => { setActive(!active); if (active) setOverrides({}); }}
        >
          {active ? 'Disable What-If' : 'Enable What-If'}
        </button>
        {active && hasOverrides && (
          <button className="btn btn-sm whatif-reset" onClick={handleReset}>
            Reset
          </button>
        )}
        {active && hasOverrides && whatIfStrengths && (
          <span className="whatif-status">
            {Object.keys(overrides).length} override{Object.keys(overrides).length !== 1 ? 's' : ''} applied
          </span>
        )}
      </div>

      {active && (
        <div className="whatif-node-list">
          {scoredNodes.map(n => (
            <WhatIfNodeRow
              key={n.id}
              n={n}
              overrides={overrides}
              originalStrengths={originalStrengths}
              whatIfStrengths={whatIfStrengths}
              handleSliderChange={handleSliderChange}
              setOverrides={setOverrides}
            />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

/** Single node row within What-If Mode: intrinsic slider + dialectical result. */
function WhatIfNodeRow({
  n,
  overrides,
  originalStrengths,
  whatIfStrengths,
  handleSliderChange,
  setOverrides,
}: {
  n: ArgumentNetworkNode;
  overrides: Record<string, number>;
  originalStrengths: Record<string, number>;
  whatIfStrengths: Record<string, number> | null;
  handleSliderChange: (nodeId: string, value: number) => void;
  setOverrides: Dispatch<SetStateAction<Record<string, number>>>;
}) {
  const origBase = n.base_strength ?? 0.5;
  const currentBase = overrides[n.id] ?? origBase;
  const isOverridden = overrides[n.id] != null;
  const origComputed = originalStrengths[n.id] ?? origBase;
  const whatIfComputed = whatIfStrengths?.[n.id] ?? origComputed;
  const delta = whatIfStrengths ? whatIfComputed - origComputed : 0;

  return (
    <div key={n.id} className={`whatif-node ${isOverridden ? 'whatif-node-modified' : ''}`}>
      <div className="whatif-node-header">
        <span className="diag-an-id">{n.id}</span>
        <span className="diag-an-speaker">({speakerLabel(n.speaker)})</span>
        {isOverridden && (
          <button
            className="whatif-node-reset-btn"
            onClick={() => setOverrides(prev => { const next = { ...prev }; delete next[n.id]; return next; })}
            title="Reset this node"
          >
            x
          </button>
        )}
      </div>
      <div className="whatif-node-text">{n.text.slice(0, 100)}{n.text.length > 100 ? '...' : ''}</div>
      <div className="whatif-slider-row">
        <span className="diag-k">Intrinsic:</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={currentBase}
          onChange={e => handleSliderChange(n.id, Number(e.target.value))}
          className="whatif-slider"
          title={`Intrinsic strength: ${currentBase.toFixed(2)} (original: ${origBase.toFixed(2)})`}
        />
        <span className="whatif-slider-value">{currentBase.toFixed(2)}</span>
        {isOverridden && (
          <span className="whatif-orig-value">(was {origBase.toFixed(2)})</span>
        )}
      </div>
      <WhatIfResultRow
        whatIfStrengths={whatIfStrengths}
        origComputed={origComputed}
        whatIfComputed={whatIfComputed}
        delta={delta}
      />
    </div>
  );
}

/** Dialectical strength before/after row; hidden until counterfactual strengths exist. */
function WhatIfResultRow({
  whatIfStrengths,
  origComputed,
  whatIfComputed,
  delta,
}: {
  whatIfStrengths: Record<string, number> | null;
  origComputed: number;
  whatIfComputed: number;
  delta: number;
}) {
  return (
    whatIfStrengths && (
      <div className="whatif-result-row">
        <span className="diag-k">Dialectical:</span>
        <span className="diag-v">{origComputed.toFixed(2)}</span>
        <span className="diag-qbaf-arrow">{'→'}</span>
        <span className={`whatif-new-value ${Math.abs(delta) > 0.01 ? (delta > 0 ? 'whatif-up' : 'whatif-down') : ''}`}>
          {whatIfComputed.toFixed(2)}
        </span>
        {Math.abs(delta) > 0.01 && (
          <span className={`whatif-delta ${delta > 0 ? 'whatif-delta-up' : 'whatif-delta-down'}`}>
            {delta > 0 ? '↑' : '↓'} {delta > 0 ? '+' : ''}{delta.toFixed(2)}
          </span>
        )}
      </div>
    )
  );
}

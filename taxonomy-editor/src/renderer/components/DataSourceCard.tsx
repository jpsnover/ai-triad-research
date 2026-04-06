// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Inline configuration controls for a single data source in the Prompt Inspector.
 * Phase B: reads/writes from usePromptConfigStore.
 */

import React from 'react';
import type { DataSourceId } from '../data/promptCatalog';
import { usePromptConfigStore, PROMPT_CONFIG_DEFAULTS } from '../hooks/usePromptConfigStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { Category } from '../types/taxonomy';

interface DataSourceCardProps {
  dsId: DataSourceId;
  disabled?: boolean;
  disabledReason?: string;
}

function Slider({ label, configKey, min, max, step = 1 }: {
  label: string;
  configKey: string;
  min: number;
  max: number;
  step?: number;
}) {
  const value = usePromptConfigStore(s => s.get(configKey)) as number;
  const setSession = usePromptConfigStore(s => s.setSession);
  return (
    <label className="pi-control">
      <span className="pi-control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => setSession(configKey, Number(e.target.value))}
        className="pi-slider"
      />
      <span className="pi-control-value">{value}</span>
    </label>
  );
}

function Toggle({ label, configKey }: { label: string; configKey: string }) {
  const value = usePromptConfigStore(s => s.get(configKey)) as boolean;
  const setSession = usePromptConfigStore(s => s.setSession);
  return (
    <label className="pi-control pi-control-toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={e => setSession(configKey, e.target.checked)}
      />
      <span className="pi-control-label">{label}</span>
    </label>
  );
}

function Dropdown({ label, configKey, options }: {
  label: string;
  configKey: string;
  options: { value: string; label: string }[];
}) {
  const value = usePromptConfigStore(s => s.get(configKey)) as string;
  const setSession = usePromptConfigStore(s => s.setSession);
  return (
    <label className="pi-control">
      <span className="pi-control-label">{label}</span>
      <select
        value={value}
        onChange={e => setSession(configKey, e.target.value)}
        className="pi-dropdown"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

const DATA_SOURCE_DESCRIPTIONS: Record<DataSourceId, string> = {
  taxonomyNodes: 'POV taxonomy nodes selected by cosine similarity, organized into BDI sections.',
  situationNodes: 'Contested concepts with per-POV interpretations (DOLCE D&S situations).',
  vulnerabilities: 'Steelman vulnerabilities — where this POV\'s position is weakest.',
  fallacies: 'Possible reasoning fallacies identified on taxonomy nodes.',
  policyRegistry: 'Policy actions referenced by taxonomy nodes.',
  sourceDocument: 'The source document snapshot (markdown) being analyzed.',
  commitments: 'Per-debater commitment tracking — asserted, conceded, challenged claims.',
  argumentNetwork: 'Incremental argument network — claims, supports, attacks from prior turns.',
  establishedPoints: 'Points of agreement/disagreement established so far in the debate.',
};

const DATA_SOURCE_LABELS: Record<DataSourceId, string> = {
  taxonomyNodes: 'Taxonomy Nodes',
  situationNodes: 'Situation Nodes',
  vulnerabilities: 'Vulnerabilities',
  fallacies: 'Fallacies',
  policyRegistry: 'Policy Registry',
  sourceDocument: 'Source Document',
  commitments: 'Commitments',
  argumentNetwork: 'Argument Network',
  establishedPoints: 'Established Points',
};

/** Live node selection preview for RAG parameter visibility (RAG-4) */
function TaxonomyNodeCountPreview() {
  const configGet = usePromptConfigStore(s => s.get);
  const maxTotal = configGet('taxonomyNodes.maxTotal') as number;
  const beliefsOn = configGet('taxonomyNodes.bdiFilter.Beliefs') as boolean;
  const desiresOn = configGet('taxonomyNodes.bdiFilter.Desires') as boolean;
  const intentionsOn = configGet('taxonomyNodes.bdiFilter.Intentions') as boolean;

  // Count nodes per category across all POVs (equality fn avoids infinite re-render)
  const counts = useTaxonomyStore(
    s => {
      let beliefs = 0, desires = 0, intentions = 0;
      for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const file = s[pov];
        if (!file?.nodes) continue;
        for (const n of file.nodes) {
          if (n.category === 'Beliefs') beliefs++;
          else if (n.category === 'Desires') desires++;
          else if (n.category === 'Intentions') intentions++;
        }
      }
      return { Beliefs: beliefs, Desires: desires, Intentions: intentions };
    },
    (a, b) => a.Beliefs === b.Beliefs && a.Desires === b.Desires && a.Intentions === b.Intentions,
  );

  const totalAvailable = (beliefsOn ? counts.Beliefs : 0) + (desiresOn ? counts.Desires : 0) + (intentionsOn ? counts.Intentions : 0);
  const totalAll = counts.Beliefs + counts.Desires + counts.Intentions;
  const selected = Math.min(maxTotal, totalAvailable);
  const pct = totalAll > 0 ? ((selected / totalAll) * 100).toFixed(1) : '0';

  return (
    <div className="pi-node-count-preview">
      <span className="pi-node-count-main">{selected} / {totalAll} nodes selected ({pct}%)</span>
      <span className="pi-node-count-breakdown">
        {beliefsOn ? `B:${counts.Beliefs}` : <s>B:{counts.Beliefs}</s>}
        {' · '}
        {desiresOn ? `D:${counts.Desires}` : <s>D:{counts.Desires}</s>}
        {' · '}
        {intentionsOn ? `I:${counts.Intentions}` : <s>I:{counts.Intentions}</s>}
      </span>
    </div>
  );
}

function renderControls(dsId: DataSourceId): React.ReactNode {
  switch (dsId) {
    case 'taxonomyNodes':
      return (
        <>
          <TaxonomyNodeCountPreview />
          <Slider label="Max total" configKey="taxonomyNodes.maxTotal" min={5} max={100} />
          <Slider label="Min per BDI" configKey="taxonomyNodes.minPerBdi" min={1} max={10} />
          <Slider label="Similarity threshold" configKey="taxonomyNodes.threshold" min={0} max={1} step={0.05} />
          <div className="pi-control-group">
            <Toggle label="Beliefs" configKey="taxonomyNodes.bdiFilter.Beliefs" />
            <Toggle label="Desires" configKey="taxonomyNodes.bdiFilter.Desires" />
            <Toggle label="Intentions" configKey="taxonomyNodes.bdiFilter.Intentions" />
          </div>
        </>
      );
    case 'situationNodes':
      return (
        <>
          <Slider label="Max" configKey="situationNodes.max" min={3} max={50} />
          <Slider label="Min" configKey="situationNodes.min" min={1} max={10} />
          <Slider label="Threshold" configKey="situationNodes.threshold" min={0} max={1} step={0.05} />
        </>
      );
    case 'vulnerabilities':
      return (
        <>
          <Toggle label="Enabled" configKey="vulnerabilities.enabled" />
          <Slider label="Max" configKey="vulnerabilities.max" min={1} max={20} />
        </>
      );
    case 'fallacies':
      return (
        <>
          <Toggle label="Enabled" configKey="fallacies.enabled" />
          <Dropdown label="Confidence" configKey="fallacies.confidenceFilter" options={[
            { value: 'likely', label: 'Likely only' },
            { value: 'all', label: 'All' },
          ]} />
        </>
      );
    case 'policyRegistry':
      return (
        <>
          <Toggle label="Enabled" configKey="policyRegistry.enabled" />
          <Slider label="Max" configKey="policyRegistry.max" min={1} max={30} />
        </>
      );
    case 'sourceDocument':
      return (
        <Slider label="Truncation (chars)" configKey="sourceDocument.truncationLimit" min={10000} max={100000} step={5000} />
      );
    case 'commitments':
      return <Toggle label="Enabled" configKey="commitments.enabled" />;
    case 'argumentNetwork':
      return <Toggle label="Enabled" configKey="argumentNetwork.enabled" />;
    case 'establishedPoints':
      return (
        <>
          <Toggle label="Enabled" configKey="establishedPoints.enabled" />
          <Slider label="Max" configKey="establishedPoints.max" min={5} max={20} />
        </>
      );
    default:
      return null;
  }
}

export function DataSourceCard({ dsId, disabled, disabledReason }: DataSourceCardProps) {
  const resetDataSource = usePromptConfigStore(s => s.resetDataSource);

  return (
    <div className={`pi-pipeline-card ${disabled ? 'pi-card-disabled' : ''}`} title={disabled ? disabledReason : undefined}>
      <div className="pi-card-header">
        <span>{DATA_SOURCE_LABELS[dsId]}</span>
        {!disabled && (
          <button
            className="pi-card-reset"
            onClick={() => resetDataSource(dsId)}
            title="Reset to defaults"
          >
            Reset
          </button>
        )}
      </div>
      <div className="pi-card-desc">{DATA_SOURCE_DESCRIPTIONS[dsId]}</div>
      {!disabled && (
        <div className="pi-card-controls">
          {renderControls(dsId)}
        </div>
      )}
    </div>
  );
}

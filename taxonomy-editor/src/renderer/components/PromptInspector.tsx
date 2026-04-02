// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import { PROMPT_CATALOG, type PromptCatalogEntry, type PromptGroup, type DataSourceId } from '../data/promptCatalog';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { generatePromptPreview } from '../utils/promptPreview';

const GROUP_LABELS: Record<PromptGroup, string> = {
  'debate-setup': 'Debate Setup',
  'debate-turns': 'Debate Turns',
  'debate-analysis': 'Debate Analysis',
  'moderator': 'Moderator',
  'chat': 'Chat',
  'taxonomy': 'Taxonomy',
  'research': 'Research',
  'powershell': 'PowerShell Backend',
};

const GROUP_ORDER: PromptGroup[] = [
  'debate-setup', 'debate-turns', 'debate-analysis', 'moderator',
  'chat', 'taxonomy', 'research', 'powershell',
];

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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Highlight {placeholders} in template text */
function highlightTemplate(template: string): JSX.Element[] {
  const parts = template.split(/(\{[^}]+\})/g);
  return parts.map((part, i) =>
    part.startsWith('{') && part.endsWith('}')
      ? <span key={i} className="pi-placeholder">{part}</span>
      : <span key={i}>{part}</span>
  );
}

export function PromptInspector() {
  const [selectedId, setSelectedId] = useState<string>(PROMPT_CATALOG[0]?.id ?? '');
  const [showTemplate, setShowTemplate] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const activeDebate = useDebateStore((s) => s.activeDebate);
  const hasActiveSession = !!activeDebate;

  const grouped = useMemo(() => {
    const map = new Map<PromptGroup, PromptCatalogEntry[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const entry of PROMPT_CATALOG) {
      const list = map.get(entry.group);
      if (list) list.push(entry);
    }
    return map;
  }, []);

  const selected = useMemo(
    () => PROMPT_CATALOG.find(e => e.id === selectedId) ?? null,
    [selectedId],
  );

  const handleGeneratePreview = () => {
    if (!selected) return;
    setPreviewLoading(true);
    try {
      const result = generatePromptPreview(selected.id);
      if (result) {
        setPreviewText(result.text);
      } else {
        // Fallback to template for prompts we can't assemble (PS backend, etc.)
        setPreviewText(selected.template);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="prompt-inspector">
      {/* Zone 1: Prompt Selector (sidebar) */}
      <div className="pi-selector">
        {GROUP_ORDER.map(group => {
          const entries = grouped.get(group);
          if (!entries || entries.length === 0) return null;
          return (
            <div key={group} className="pi-group">
              <div className="pi-group-header">{GROUP_LABELS[group]}</div>
              {entries.map(entry => (
                <button
                  key={entry.id}
                  className={`pi-entry ${entry.id === selectedId ? 'pi-entry-active' : ''}`}
                  onClick={() => { setSelectedId(entry.id); setPreviewText(null); }}
                >
                  <span className="pi-entry-title">{entry.title}</span>
                  <span className="pi-entry-meta">
                    {entry.applicableDataSources.length} data source{entry.applicableDataSources.length !== 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Zone 2: Pipeline View (main area) */}
      <div className="pi-main">
        {selected ? (
          <>
            {/* Section A: Purpose & Settings */}
            <div className="pi-section">
              <h3 className="pi-section-header">{selected.title}</h3>
              {selected.phase && (
                <span className="pi-phase-badge">{selected.phase}</span>
              )}
              <p className="pi-purpose">{selected.purpose}</p>
              <div className="pi-settings-row">
                <span className="pi-setting">Source: <code>{selected.source}</code></span>
              </div>
            </div>

            {/* Section B: Data Pipeline */}
            {selected.applicableDataSources.length > 0 && (
              <div className="pi-section">
                <h4 className="pi-section-subheader">Data Pipeline</h4>
                <div className="pi-pipeline-cards">
                  {selected.applicableDataSources.map(dsId => (
                    <div key={dsId} className="pi-pipeline-card">
                      <div className="pi-card-header">{DATA_SOURCE_LABELS[dsId]}</div>
                      <div className="pi-card-desc">{DATA_SOURCE_DESCRIPTIONS[dsId]}</div>
                      <div className="pi-card-stats">
                        <span className="pi-card-stat">Volume: —</span>
                        <span className="pi-card-stat">Tokens: —</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section C: Template */}
            <div className="pi-section">
              <button
                className="pi-template-toggle"
                onClick={() => setShowTemplate(!showTemplate)}
              >
                <span className={`pi-chevron ${showTemplate ? 'pi-chevron-open' : ''}`}>&#9654;</span>
                Template
                <span className="pi-template-tokens">
                  ~{estimateTokens(selected.template).toLocaleString()} tokens
                </span>
              </button>
              {showTemplate && (
                <pre className="pi-template">
                  {highlightTemplate(selected.template)}
                </pre>
              )}
            </div>

            {/* Zone 3: Preview */}
            <div className="pi-section pi-preview-section">
              <div className="pi-preview-header">
                <button
                  className="btn btn-sm"
                  onClick={handleGeneratePreview}
                  disabled={!hasActiveSession || previewLoading}
                  title={!hasActiveSession ? 'Start a debate or chat to generate a preview with real data' : 'Assemble the full prompt with real session data'}
                >
                  {previewLoading ? 'Generating...' : 'Generate Preview'}
                </button>
                {!hasActiveSession && (
                  <span className="pi-preview-hint">Start a debate or chat first</span>
                )}
                {previewText && (
                  <span className="pi-preview-tokens">
                    ~{estimateTokens(previewText).toLocaleString()} tokens
                  </span>
                )}
              </div>
              {previewText && (
                <pre className="pi-preview">{previewText}</pre>
              )}
            </div>
          </>
        ) : (
          <div className="pi-empty">Select a prompt from the sidebar</div>
        )}
      </div>
    </div>
  );
}

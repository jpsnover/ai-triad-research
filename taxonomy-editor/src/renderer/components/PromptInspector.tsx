// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { PROMPT_CATALOG, type PromptCatalogEntry, type PromptGroup, type DataSourceId } from '../data/promptCatalog';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore, MODELS_BY_BACKEND } from '../hooks/useTaxonomyStore';
import { generatePromptPreview } from '../utils/promptPreview';
import { DataSourceCard } from './DataSourceCard';
import { usePromptConfigStore } from '../hooks/usePromptConfigStore';
import type { PromptPreviewResult } from '@lib/debate';

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

// Data source labels/descriptions moved to DataSourceCard.tsx

/** Highlight {{PLACEHOLDERS}} in PS prompt files */
function highlightPsPlaceholders(text: string): React.ReactNode[] {
  const parts = text.split(/(\{\{[A-Z_]+\}\})/g);
  return parts.map((part, i) =>
    part.startsWith('{{') && part.endsWith('}}')
      ? <span key={i} className="pi-placeholder">{part}</span>
      : <span key={i}>{part}</span>
  );
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Highlight {placeholders} in template text */
function highlightTemplate(template: string): React.ReactNode[] {
  const parts = template.split(/(\{[^}]+\})/g);
  return parts.map((part, i) =>
    part.startsWith('{') && part.endsWith('}')
      ? <span key={i} className="pi-placeholder">{part}</span>
      : <span key={i}>{part}</span>
  );
}

const ALL_MODELS = Object.values(MODELS_BY_BACKEND).flat();
const RESPONSE_LENGTHS: ('brief' | 'medium' | 'detailed')[] = ['brief', 'medium', 'detailed'];
const DEBATE_GROUPS = new Set<PromptGroup>(['debate-setup', 'debate-turns', 'debate-analysis', 'moderator']);

/** Simple line-based diff: returns lines tagged as 'same', 'added', or 'removed'. */
function computeLineDiff(
  baseline: string,
  current: string,
): { type: 'same' | 'added' | 'removed'; text: string }[] {
  const baseLines = baseline.split('\n');
  const currLines = current.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];

  // Simple LCS-based diff for reasonable-length prompts
  const m = baseLines.length;
  const n = currLines.length;

  // For very long prompts, fall back to sequential comparison
  if (m + n > 2000) {
    let bi = 0, ci = 0;
    while (bi < m || ci < n) {
      if (bi < m && ci < n && baseLines[bi] === currLines[ci]) {
        result.push({ type: 'same', text: currLines[ci] });
        bi++; ci++;
      } else if (ci < n) {
        result.push({ type: 'added', text: currLines[ci] });
        ci++;
      } else {
        result.push({ type: 'removed', text: baseLines[bi] });
        bi++;
      }
    }
    return result;
  }

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = baseLines[i - 1] === currLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const diff: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && baseLines[i - 1] === currLines[j - 1]) {
      diff.push({ type: 'same', text: baseLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({ type: 'added', text: currLines[j - 1] });
      j--;
    } else {
      diff.push({ type: 'removed', text: baseLines[i - 1] });
      i--;
    }
  }
  return diff.reverse();
}

function SettingsControls({ promptId, group }: { promptId: string; group: PromptGroup }) {
  const configGet = usePromptConfigStore(s => s.get);
  const setSession = usePromptConfigStore(s => s.setSession);
  const debateModel = useDebateStore(s => s.debateModel);

  const temperature = configGet(`temperature.${promptId}`) as number | undefined
    ?? configGet(group.startsWith('debate') ? 'temperature.debate' : 'temperature.debate') as number;
  const model = configGet(`model.${promptId}`) as string | undefined ?? debateModel ?? '';
  const responseLength = configGet('responseLength') as string ?? 'medium';
  const isDebate = DEBATE_GROUPS.has(group);

  return (
    <div className="pi-settings-grid">
      <label className="pi-control">
        <span className="pi-control-label">Model</span>
        <select
          className="pi-dropdown"
          value={model}
          onChange={e => setSession(`model.${promptId}`, e.target.value)}
        >
          <option value="">(session default)</option>
          {ALL_MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>
      <label className="pi-control">
        <span className="pi-control-label">Temperature</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={e => setSession(`temperature.${promptId}`, Number(e.target.value))}
          className="pi-slider"
        />
        <span className="pi-control-value">{temperature.toFixed(1)}</span>
      </label>
      {isDebate && (
        <div className="pi-control">
          <span className="pi-control-label">Response length</span>
          <div className="pi-pills">
            {RESPONSE_LENGTHS.map(len => (
              <button
                key={len}
                className={`pi-pill ${responseLength === len ? 'pi-pill-active' : ''}`}
                onClick={() => setSession('responseLength', len)}
              >
                {len}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PromptInspector() {
  const [selectedId, setSelectedId] = useState<string>(PROMPT_CATALOG[0]?.id ?? '');
  const [showTemplate, setShowTemplate] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [baselinePreview, setBaselinePreview] = useState<PromptPreviewResult | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [psPromptContent, setPsPromptContent] = useState<Record<string, string>>({});
  const [psPromptLoading, setPsPromptLoading] = useState(false);

  const activeDebate = useDebateStore((s) => s.activeDebate);
  const hasActiveSession = !!activeDebate;

  // Subscribe to config changes so preview auto-updates when knobs are tweaked
  const configOverrides = usePromptConfigStore(s => s.sessionOverrides);
  const configDefaults = usePromptConfigStore(s => s.workspaceDefaults);

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

  // Load PS prompt files from disk when a powershell entry is selected
  useEffect(() => {
    if (!selected?.promptFiles?.length) return;
    const filesToLoad = selected.promptFiles.filter(f => !psPromptContent[f]);
    if (filesToLoad.length === 0) return;

    setPsPromptLoading(true);
    Promise.all(
      filesToLoad.map(async (name) => {
        const result = await window.electronAPI.readPsPrompt(name);
        return [name, result.text ?? `(Error: ${result.error})`] as [string, string];
      })
    ).then(results => {
      setPsPromptContent(prev => {
        const next = { ...prev };
        for (const [name, text] of results) next[name] = text;
        return next;
      });
    }).finally(() => setPsPromptLoading(false));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase C: Auto-updating preview — recomputes when selection, debate, or config changes
  const livePreview = useMemo<PromptPreviewResult | null>(() => {
    if (!selected || !hasActiveSession) return null;
    try {
      const result = generatePromptPreview(selected.id);
      if (result) return result;
      // Fallback to template for prompts we can't assemble (PS backend, etc.)
      return { text: selected.template, tokenEstimate: estimateTokens(selected.template), sections: [] };
    } catch {
      return null;
    }
    // configOverrides/configDefaults included to re-trigger when config knobs change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hasActiveSession, activeDebate, configOverrides, configDefaults]);

  // Clear baseline when switching prompts
  useEffect(() => {
    setBaselinePreview(null);
    setShowDiff(false);
  }, [selectedId]);

  const handleSnapshot = useCallback(() => {
    setBaselinePreview(livePreview);
  }, [livePreview]);

  const handleCopy = useCallback(async () => {
    if (!livePreview?.text) return;
    try {
      await navigator.clipboard.writeText(livePreview.text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [livePreview]);

  const diffLines = useMemo(() => {
    if (!showDiff || !baselinePreview || !livePreview) return null;
    if (baselinePreview.text === livePreview.text) return [];
    return computeLineDiff(baselinePreview.text, livePreview.text);
  }, [showDiff, baselinePreview, livePreview]);

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
                  onClick={() => setSelectedId(entry.id)}
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
              <div className="pi-settings-controls">
                <SettingsControls promptId={selected.id} group={selected.group} />
              </div>
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
                    <DataSourceCard key={dsId} dsId={dsId} />
                  ))}
                </div>
              </div>
            )}

            {/* PS Parameters (PowerShell prompts only) */}
            {selected.psParameters && selected.psParameters.length > 0 && (
              <div className="pi-section">
                <h4 className="pi-section-subheader">Cmdlet Parameters</h4>
                <div className="pi-ps-params">
                  {selected.psParameters.map(p => (
                    <div key={p.name} className="pi-ps-param">
                      <code className="pi-ps-param-name">{p.name}</code>
                      <span className="pi-ps-param-type">{p.type}</span>
                      <span className="pi-ps-param-default">default: {p.default}</span>
                      <span className="pi-ps-param-desc">{p.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section C: Template / Prompt Files */}
            <div className="pi-section">
              {selected.promptFiles && selected.promptFiles.length > 0 ? (
                <>
                  <button
                    className="pi-template-toggle"
                    onClick={() => setShowTemplate(!showTemplate)}
                  >
                    <span className={`pi-chevron ${showTemplate ? 'pi-chevron-open' : ''}`}>&#9654;</span>
                    Prompt Files ({selected.promptFiles.length})
                    {!psPromptLoading && selected.promptFiles.every(f => psPromptContent[f]) && (
                      <span className="pi-template-tokens">
                        ~{estimateTokens(selected.promptFiles.map(f => psPromptContent[f] ?? '').join('\n')).toLocaleString()} tokens
                      </span>
                    )}
                    {psPromptLoading && <span className="pi-template-tokens">loading...</span>}
                  </button>
                  {showTemplate && selected.promptFiles.map(fileName => (
                    <div key={fileName} className="pi-prompt-file">
                      <div className="pi-prompt-file-header">
                        <code>{fileName}.prompt</code>
                        <span className="pi-template-tokens">
                          {psPromptContent[fileName] ? `~${estimateTokens(psPromptContent[fileName]).toLocaleString()} tokens` : ''}
                        </span>
                      </div>
                      <pre className="pi-template">
                        {psPromptContent[fileName]
                          ? highlightPsPlaceholders(psPromptContent[fileName])
                          : 'Loading...'}
                      </pre>
                    </div>
                  ))}
                </>
              ) : (
                <>
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
                </>
              )}
            </div>

            {/* Zone 3: Live Preview (Phase C) */}
            <div className="pi-section pi-preview-section">
              {!hasActiveSession ? (
                <div className="pi-preview-header">
                  <span className="pi-preview-hint">Start a debate or chat to see a live preview</span>
                </div>
              ) : livePreview ? (
                <>
                  {/* Token count bar */}
                  <div className="pi-token-bar">
                    <span className="pi-token-total">
                      ~{livePreview.tokenEstimate.toLocaleString()} tokens
                    </span>
                    {livePreview.sections.length > 0 && (
                      <span className="pi-token-breakdown">
                        ({livePreview.sections.map(s =>
                          `${s.name}: ~${s.tokenEstimate.toLocaleString()}`
                        ).join(' · ')})
                      </span>
                    )}
                  </div>

                  {/* Toolbar */}
                  <div className="pi-preview-header">
                    <button
                      className="btn btn-sm"
                      onClick={handleCopy}
                      title="Copy assembled prompt to clipboard"
                    >
                      {copyFeedback ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={handleSnapshot}
                      title="Save current preview as baseline for diff comparison"
                    >
                      Snapshot
                    </button>
                    <button
                      className={`btn btn-sm ${showDiff ? 'pi-btn-active' : ''}`}
                      onClick={() => setShowDiff(d => !d)}
                      disabled={!baselinePreview}
                      title={baselinePreview ? 'Toggle diff view against snapshot' : 'Take a snapshot first'}
                    >
                      Diff
                    </button>
                    {baselinePreview && (
                      <span className="pi-diff-hint">
                        Baseline: ~{baselinePreview.tokenEstimate.toLocaleString()} tokens
                        {livePreview.tokenEstimate !== baselinePreview.tokenEstimate && (
                          <> ({livePreview.tokenEstimate > baselinePreview.tokenEstimate ? '+' : ''}
                          {(livePreview.tokenEstimate - baselinePreview.tokenEstimate).toLocaleString()})</>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Diff view */}
                  {showDiff && diffLines !== null ? (
                    diffLines.length === 0 ? (
                      <div className="pi-diff-match">No differences — preview matches snapshot</div>
                    ) : (
                      <pre className="pi-preview pi-diff-view">
                        {diffLines.map((line, i) => (
                          <div
                            key={i}
                            className={
                              line.type === 'added' ? 'pi-diff-added' :
                              line.type === 'removed' ? 'pi-diff-removed' : ''
                            }
                          >
                            <span className="pi-diff-marker">
                              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                            </span>
                            {line.text}
                          </div>
                        ))}
                      </pre>
                    )
                  ) : (
                    <pre className="pi-preview">{livePreview.text}</pre>
                  )}
                </>
              ) : (
                <div className="pi-preview-header">
                  <span className="pi-preview-hint">Preview not available for this prompt type</span>
                </div>
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

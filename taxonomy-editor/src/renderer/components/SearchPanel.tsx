// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { nodePovFromId } from '@lib/debate';
import { useTaxonomyStore, type SearchMode } from '../hooks/useTaxonomyStore';
import type { TabId, Category, PovNode, SituationNode, ConflictFile } from '../types/taxonomy';
import { interpretationText } from '../types/taxonomy';
import { buildSearchRegex } from '../utils/searchRegex';

type SearchPanelMode =
  | 'taxonomy'
  | 'related'
  | 'intellectual_lineage'
  | 'epistemic_type'
  | 'rhetorical_strategy'
  | 'audience'
  | 'emotional_register'
  | 'possible_fallacy';

const MODE_LABELS: Record<SearchPanelMode, string> = {
  taxonomy: 'Taxonomy',
  related: 'Related',
  audience: 'Audience',
  emotional_register: 'Emotional Register',
  epistemic_type: 'Epistemic Type',
  intellectual_lineage: 'Intellectual Lineage',
  possible_fallacy: 'Possible Fallacy',
  rhetorical_strategy: 'Rhetorical Strategy',
};

/** Sorted dropdown entries: Taxonomy first, Related second, then alphabetical */
const MODE_ENTRIES = Object.entries(MODE_LABELS).sort(([a], [b]) => {
  if (a === 'taxonomy') return -1;
  if (b === 'taxonomy') return 1;
  if (a === 'related') return -1;
  if (b === 'related') return 1;
  return MODE_LABELS[a as SearchPanelMode].localeCompare(MODE_LABELS[b as SearchPanelMode]);
});

/** Persists the user's last search mode across toolbar switches */
let _lastSearchMode: SearchPanelMode = 'taxonomy';

const ATTRIBUTE_OPTIONS: Record<string, string[]> = {
  intellectual_lineage: [], // free-form — collected dynamically
  epistemic_type: [
    'definitional', 'empirical_claim', 'interpretive_lens',
    'normative_prescription', 'predictive', 'strategic_recommendation',
  ],
  rhetorical_strategy: [
    'analogical_reasoning', 'appeal_to_authority', 'appeal_to_evidence',
    'cost_benefit_analysis', 'inevitability_framing', 'moral_imperative',
    'precautionary_framing', 'reductio_ad_absurdum', 'structural_critique',
    'techno_optimism',
  ],
  audience: [
    'academic_community', 'civil_society', 'general_public',
    'industry_leaders', 'policymakers', 'technical_researchers',
  ],
  emotional_register: [
    'alarmed', 'aspirational', 'cautionary', 'defiant', 'dismissive',
    'measured', 'optimistic', 'pragmatic', 'urgent',
  ],
};

function formatValue(val: string): string {
  return val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Unified result type for all modes ──────────────────
interface SearchResult {
  id: string;
  label: string;
  pov: string; // tab/pov identifier
  score?: number;
  matchText?: string;
}

// ─── Taxonomy search helpers ────────────────────────────
interface TaxResult {
  id: string;
  label: string;
  tab: TabId;
  category?: Category;
  field: string;
  matchText: string;
  score?: number;
}

function searchPovNode(node: PovNode, regex: RegExp, tab: TabId): TaxResult[] {
  const results: TaxResult[] = [];
  for (const [field, value] of [['id', node.id], ['label', node.label], ['description', node.description], ['category', node.category]] as const) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: node.id, label: node.label, tab, category: node.category, field, matchText: value });
    }
  }
  return results;
}

function searchCCNode(node: SituationNode, regex: RegExp): TaxResult[] {
  const results: TaxResult[] = [];
  for (const [field, value] of [
    ['id', node.id], ['label', node.label], ['description', node.description],
    ['interp:accelerationist', interpretationText(node.interpretations.accelerationist)],
    ['interp:safetyist', interpretationText(node.interpretations.safetyist)],
    ['interp:skeptic', interpretationText(node.interpretations.skeptic)],
  ] as const) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: node.id, label: node.label, tab: 'situations', field, matchText: value });
    }
  }
  return results;
}

function searchConflict(conflict: ConflictFile, regex: RegExp): TaxResult[] {
  const results: TaxResult[] = [];
  const fields: [string, string][] = [
    ['claim_id', conflict.claim_id], ['claim_label', conflict.claim_label],
    ['description', conflict.description], ['status', conflict.status],
  ];
  for (const inst of conflict.instances) {
    fields.push(['instance:doc_id', inst.doc_id], ['instance:stance', inst.stance], ['instance:assertion', inst.assertion]);
  }
  for (const note of conflict.human_notes ?? []) {
    fields.push(['note:author', note.author], ['note:note', note.note]);
  }
  for (const [field, value] of fields) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: conflict.claim_id, label: conflict.claim_label, tab: 'conflicts', field, matchText: value });
    }
  }
  return results;
}

function dedupe(results: TaxResult[]): TaxResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.id}::${r.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Component ──────────────────────────────────────────
interface SearchPanelProps {
  onAnalyze?: (elementB: { label: string; description: string; category: string }) => void;
  onSelectResult?: (id: string) => void;
}

export function SearchPanel({ onAnalyze, onSelectResult }: SearchPanelProps) {
  const {
    accelerationist, safetyist, skeptic, situations, conflicts,
    getLabelForId,
    findQuery, findMode, findCaseSensitive,
    setFindQuery, setFindMode, setFindCaseSensitive,
    hasApiKey, checkApiKey, runSemanticSearch,
    semanticResults, embeddingLoading, embeddingError,
    similarResults, similarLoading, similarStep, similarError, runSimilarSearch,
    clearSimilarSearch, setToolbarPanel,
    pendingSearchRelatedId,
  } = useTaxonomyStore();

  const [mode, setMode] = useState<SearchPanelMode>(_lastSearchMode);
  const [attrValue, setAttrValue] = useState<string>('');
  const [attrQuery, setAttrQuery] = useState('');
  const [relatedQuery, setRelatedQuery] = useState('');
  const [relatedNodeId, setRelatedNodeId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSemantic = findMode === 'semantic';

  useEffect(() => { checkApiKey(); }, [checkApiKey]);

  // Auto-switch to Related mode when navigated from Similar Search button
  useEffect(() => {
    if (!pendingSearchRelatedId) return;
    const nodeId = pendingSearchRelatedId;
    useTaxonomyStore.setState({ pendingSearchRelatedId: null });
    setMode('related');
    setRelatedNodeId(nodeId);
    setRelatedQuery('');
    const label = getLabelForId(nodeId);
    const state = useTaxonomyStore.getState();
    let desc = '';
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const n = state[pov]?.nodes.find(n => n.id === nodeId);
      if (n) { desc = n.description; break; }
    }
    if (!desc && state.situations) {
      const n = state.situations.nodes.find(n => n.id === nodeId);
      if (n) desc = n.description;
    }
    runSimilarSearch(nodeId, label, desc);
  }, [pendingSearchRelatedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced semantic search
  useEffect(() => {
    if (mode !== 'taxonomy' || !isSemantic) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!findQuery.trim()) return;
    debounceRef.current = setTimeout(() => {
      runSemanticSearch(findQuery, new Set(), new Set());
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [findQuery, isSemantic, mode, runSemanticSearch]);

  // ─── Collect all node IDs for Related mode typeahead ───
  const allNodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = useTaxonomyStore.getState()[pov];
      if (file) for (const n of file.nodes) ids.push(n.id);
    }
    const sit = useTaxonomyStore.getState().situations;
    if (sit) for (const n of sit.nodes) ids.push(n.id);
    return ids;
  }, [accelerationist, safetyist, skeptic, situations]);

  // ─── Collect unique intellectual lineage values ────────
  const lineageValues = useMemo(() => {
    const vals = new Set<string>();
    const state = useTaxonomyStore.getState();
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) for (const n of file.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) vals.add(l);
      }
    }
    if (state.situations) {
      for (const n of state.situations.nodes) {
        for (const l of n.graph_attributes?.intellectual_lineage ?? []) vals.add(l);
      }
    }
    return [...vals].sort();
  }, [accelerationist, safetyist, skeptic, situations]);

  // ─── Collect unique possible fallacy values ─────────
  const fallacyValues = useMemo(() => {
    const vals = new Set<string>();
    const state = useTaxonomyStore.getState();
    const collectFallacies = (attrs: Record<string, unknown> | undefined) => {
      const pf = attrs?.possible_fallacies;
      if (Array.isArray(pf)) {
        for (const entry of pf) {
          if (entry && typeof entry === 'object' && typeof (entry as { fallacy: string }).fallacy === 'string') {
            vals.add((entry as { fallacy: string }).fallacy);
          }
        }
      }
    };
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) for (const n of file.nodes) collectFallacies(n.graph_attributes as unknown as Record<string, unknown>);
    }
    if (state.situations) {
      for (const n of state.situations.nodes) collectFallacies(n.graph_attributes as unknown as Record<string, unknown>);
    }
    return [...vals].sort();
  }, [accelerationist, safetyist, skeptic, situations]);

  // ─── Related mode filtered options ────────────────────
  const relatedFilteredIds = useMemo(() => {
    if (!relatedQuery) return allNodeIds.slice(0, 20);
    const q = relatedQuery.toLowerCase();
    return allNodeIds.filter(id => {
      const label = getLabelForId(id).toLowerCase();
      return id.toLowerCase().includes(q) || label.includes(q);
    }).slice(0, 20);
  }, [relatedQuery, allNodeIds, getLabelForId]);

  // ─── Taxonomy text results ────────────────────────────
  const taxResults = useMemo(() => {
    if (mode !== 'taxonomy' || isSemantic) return [];
    const regex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
    if (!regex) return [];
    const all: TaxResult[] = [];
    for (const [pov, file] of [
      ['accelerationist', accelerationist], ['safetyist', safetyist], ['skeptic', skeptic],
    ] as const) {
      if (file) for (const node of file.nodes) all.push(...searchPovNode(node, regex, pov));
    }
    if (situations) for (const node of situations.nodes) all.push(...searchCCNode(node, regex));
    for (const conflict of conflicts) all.push(...searchConflict(conflict, regex));
    return dedupe(all);
  }, [mode, findQuery, findMode, findCaseSensitive, accelerationist, safetyist, skeptic, situations, conflicts, isSemantic]);

  // Semantic results mapped
  const semResults: TaxResult[] = useMemo(() => {
    if (mode !== 'taxonomy' || !isSemantic) return [];
    return (semanticResults || []).map(r => {
      const label = getLabelForId(r.id);
      const tab: TabId = r.id.startsWith('conflict-') ? 'conflicts'
        : (nodePovFromId(r.id) as TabId) || 'skeptic';
      return { id: r.id, label, tab, field: 'semantic', matchText: '', score: r.score };
    });
  }, [mode, isSemantic, semanticResults, getLabelForId]);

  const taxonomyResults = isSemantic ? semResults : taxResults;

  // ─── Similar (Related) results ────────────────────────
  const relatedResults = useMemo(() => {
    if (mode !== 'related' || !similarResults) return [];
    return similarResults.map(r => ({
      id: r.id,
      label: getLabelForId(r.id),
      score: r.score,
      pov: nodePovFromId(r.id) ?? 'unknown',
    }));
  }, [mode, similarResults, getLabelForId]);

  // ─── Attribute results ────────────────────────────────
  const attrResults = useMemo(() => {
    if (mode === 'taxonomy' || mode === 'related' || !attrValue) return [];
    const normalizedValue = attrValue.toLowerCase();
    const results: SearchResult[] = [];
    const state = useTaxonomyStore.getState();

    const matchAttr = (attrs: Record<string, unknown> | undefined, nodeId: string, nodeLabel: string, pov: string) => {
      if (!attrs) return;

      // Special handling for possible_fallacy — search inside array of objects
      if (mode === 'possible_fallacy') {
        const pf = attrs.possible_fallacies;
        if (Array.isArray(pf) && pf.some((entry: { fallacy?: string }) => entry?.fallacy?.toLowerCase() === normalizedValue)) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
        return;
      }

      const raw = attrs[mode];
      if (raw == null) return;
      if (Array.isArray(raw)) {
        if (raw.some((v: string) => v.toLowerCase().includes(normalizedValue))) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
      } else {
        const tokens = String(raw).toLowerCase().split(',').map(t => t.trim());
        if (tokens.some(t => t === normalizedValue)) {
          results.push({ id: nodeId, label: nodeLabel, pov });
        }
      }
    };

    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const file = state[pov];
      if (file) for (const node of file.nodes) matchAttr(node.graph_attributes as unknown as Record<string, unknown>, node.id, node.label, pov);
    }
    if (state.situations) {
      for (const node of state.situations.nodes) matchAttr(node.graph_attributes as unknown as Record<string, unknown>, node.id, node.label, 'situations');
    }
    return results;
  }, [mode, attrValue, accelerationist, safetyist, skeptic, situations]);

  // ─── Unified flat results list for keyboard nav ───────
  const flatResults: SearchResult[] = useMemo(() => {
    if (mode === 'taxonomy') {
      return taxonomyResults.map(r => ({ id: r.id, label: r.label, pov: r.tab, score: r.score, matchText: r.matchText }));
    }
    if (mode === 'related') {
      return relatedResults;
    }
    return attrResults;
  }, [mode, taxonomyResults, relatedResults, attrResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [flatResults]);

  // ─── Select a result → show in Pane 2 ────────────────
  const selectResult = useCallback((index: number) => {
    if (index < 0 || index >= flatResults.length) return;
    setSelectedIndex(index);
    onSelectResult?.(flatResults[index].id);
    // Keep focus on the panel for keyboard nav
    panelRef.current?.focus();
    // Scroll into view
    const el = resultsRef.current?.children[index + 1] as HTMLElement | undefined; // +1 for count div
    el?.scrollIntoView({ block: 'nearest' });
  }, [flatResults, onSelectResult]);

  // ─── Keyboard navigation ─────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, flatResults.length - 1);
      selectResult(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      selectResult(prev);
    }
  }, [selectedIndex, flatResults.length, selectResult]);

  // ─── Handlers ─────────────────────────────────────────
  const handleRelatedSelect = useCallback((nodeId: string) => {
    setRelatedNodeId(nodeId);
    setRelatedQuery('');
    const label = getLabelForId(nodeId);
    const state = useTaxonomyStore.getState();
    let desc = '';
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const n = state[pov]?.nodes.find(n => n.id === nodeId);
      if (n) { desc = n.description; break; }
    }
    if (!desc && state.situations) {
      const n = state.situations.nodes.find(n => n.id === nodeId);
      if (n) desc = n.description;
    }
    runSimilarSearch(nodeId, label, desc);
  }, [getLabelForId, runSimilarSearch]);

  const handleModeChange = (newMode: SearchPanelMode) => {
    setMode(newMode);
    _lastSearchMode = newMode;
    setAttrValue('');
    setAttrQuery('');
    setRelatedNodeId(null);
    setRelatedQuery('');
    setSelectedIndex(-1);
  };

  const handleClose = () => {
    clearSimilarSearch();
    setToolbarPanel(null);
  };

  const povColor = (pov: string) => {
    switch (pov) {
      case 'accelerationist': return 'var(--color-acc)';
      case 'safetyist': return 'var(--color-saf)';
      case 'skeptic': return 'var(--color-skp)';
      case 'situations': return 'var(--color-sit)';
      default: return 'var(--text-muted)';
    }
  };

  const highlightMatch = (text: string): React.ReactNode => {
    if (isSemantic || mode !== 'taxonomy') return text;
    const regex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
    if (!regex || !findQuery) return text;
    const truncated = text.length > 100 ? text.slice(0, 100) + '...' : text;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = regex.exec(truncated)) !== null && i < 10) {
      if (match.index > lastIndex) parts.push(truncated.slice(lastIndex, match.index));
      parts.push(<mark key={i}>{match[0]}</mark>);
      lastIndex = regex.lastIndex;
      if (match[0].length === 0) regex.lastIndex++;
      i++;
    }
    if (lastIndex < truncated.length) parts.push(truncated.slice(lastIndex));
    return parts.length > 0 ? parts : truncated;
  };

  // Determine options for current attribute mode
  const isAttrMode = mode !== 'taxonomy' && mode !== 'related';
  const isTypeaheadAttr = mode === 'intellectual_lineage' || mode === 'possible_fallacy';
  const currentOptions = isAttrMode
    ? (mode === 'intellectual_lineage' ? lineageValues : mode === 'possible_fallacy' ? fallacyValues : ATTRIBUTE_OPTIONS[mode] || [])
    : [];

  // Filtered options for typeahead attribute modes
  const filteredAttrOptions = useMemo(() => {
    if (!isTypeaheadAttr || !attrQuery) return currentOptions;
    const q = attrQuery.toLowerCase();
    return currentOptions.filter(opt => opt.toLowerCase().includes(q));
  }, [isTypeaheadAttr, attrQuery, currentOptions]);

  // Render a single result row
  const renderResultRow = (r: SearchResult, i: number) => (
    <div
      key={`${r.id}-${i}`}
      className={`search-panel-result-item${i === selectedIndex ? ' selected' : ''}`}
      onClick={() => selectResult(i)}
    >
      <div className="search-panel-result-header">
        <span className="search-panel-result-pov" style={{ color: povColor(r.pov) }}>
          {r.pov.slice(0, 3)}
        </span>
        <span className="search-panel-result-id">{r.id}</span>
        {r.score != null && (
          <span className="search-panel-result-score">{Math.round(r.score * 100)}%</span>
        )}
      </div>
      <div className="search-panel-result-label">
        {mode === 'taxonomy' && r.matchText ? highlightMatch(r.matchText) : r.label}
      </div>
    </div>
  );

  return (
    <div className="search-panel" ref={panelRef} tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="search-panel-header">
        <span className="search-panel-title">Search</span>
        <button className="btn btn-ghost btn-sm" onClick={handleClose}>Close</button>
      </div>

      {/* Mode selector */}
      <div className="search-panel-mode">
        <select
          className="search-panel-mode-select"
          value={mode}
          onChange={(e) => handleModeChange(e.target.value as SearchPanelMode)}
        >
          {MODE_ENTRIES.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Mode-specific input area */}
      <div className="search-panel-input">
        {mode === 'taxonomy' && (
          <div className="search-panel-taxonomy">
            <div className="search-panel-input-row">
              <input
                ref={inputRef}
                className="search-panel-text-input"
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isSemantic) {
                    runSemanticSearch(findQuery, new Set(), new Set());
                  }
                  // Let arrow keys bubble up to panel handler
                }}
                placeholder={isSemantic ? 'Describe what you\'re looking for...' : 'Search taxonomy...'}
              />
              <select
                className="search-panel-search-mode"
                value={findMode}
                onChange={(e) => setFindMode(e.target.value as SearchMode)}
              >
                <option value="raw">Raw</option>
                <option value="wildcard">Wildcard</option>
                <option value="regex">Regex</option>
                <option value="semantic">Semantic</option>
              </select>
            </div>
            {!isSemantic && (
              <label className="search-panel-option">
                <input
                  type="checkbox"
                  checked={findCaseSensitive}
                  onChange={(e) => setFindCaseSensitive(e.target.checked)}
                />
                Case sensitive
              </label>
            )}
          </div>
        )}

        {mode === 'related' && (
          <div className="search-panel-related">
            {relatedNodeId ? (
              <div className="search-panel-selected-node">
                <span className="search-panel-selected-id">{relatedNodeId}</span>
                <span className="search-panel-selected-label">{getLabelForId(relatedNodeId)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { setRelatedNodeId(null); clearSimilarSearch(); }}>
                  &times;
                </button>
              </div>
            ) : (
              <div className="search-panel-typeahead">
                <input
                  className="search-panel-text-input"
                  type="text"
                  value={relatedQuery}
                  onChange={(e) => setRelatedQuery(e.target.value)}
                  placeholder="Search for a node..."
                />
                {relatedFilteredIds.length > 0 && relatedQuery && (
                  <div className="search-panel-typeahead-list">
                    {relatedFilteredIds.map(id => (
                      <div
                        key={id}
                        className="search-panel-typeahead-item"
                        onClick={() => handleRelatedSelect(id)}
                      >
                        <span className="search-panel-typeahead-id">{id}</span>
                        <span className="search-panel-typeahead-label">{getLabelForId(id)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isAttrMode && (
          <div className="search-panel-attr">
            {isTypeaheadAttr ? (
              <div className="search-panel-typeahead">
                {attrValue ? (
                  <div className="search-panel-selected-node">
                    <span className="search-panel-selected-label">{formatValue(attrValue)}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setAttrValue(''); setAttrQuery(''); }}>
                      &times;
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="search-panel-text-input"
                      type="text"
                      value={attrQuery}
                      onChange={(e) => setAttrQuery(e.target.value)}
                      placeholder={`Type to search ${MODE_LABELS[mode].toLowerCase()} values...`}
                    />
                    {filteredAttrOptions.length > 0 && (
                      <div className="search-panel-typeahead-list">
                        {filteredAttrOptions.map(opt => (
                          <div
                            key={opt}
                            className="search-panel-typeahead-item"
                            onClick={() => { setAttrValue(opt); setAttrQuery(''); }}
                          >
                            <span className="search-panel-typeahead-label">{formatValue(opt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {attrQuery && filteredAttrOptions.length === 0 && (
                      <div className="search-panel-attr-empty">No matching values</div>
                    )}
                  </>
                )}
              </div>
            ) : currentOptions.length > 0 ? (
              <select
                className="search-panel-attr-select"
                value={attrValue}
                onChange={(e) => setAttrValue(e.target.value)}
              >
                <option value="">Select a value...</option>
                {currentOptions.map(opt => (
                  <option key={opt} value={opt}>{formatValue(opt)}</option>
                ))}
              </select>
            ) : (
              <div className="search-panel-attr-empty">No values found</div>
            )}
          </div>
        )}
      </div>

      {/* Results area */}
      <div className="search-panel-results" ref={resultsRef}>
        {mode === 'taxonomy' && (
          <>
            {embeddingLoading && <div className="search-panel-status">Searching...</div>}
            {embeddingError && <div className="search-panel-error">{embeddingError}</div>}
          </>
        )}
        {mode === 'related' && (
          <>
            {similarLoading && <div className="search-panel-status"><span className="search-spinner" />{similarStep || 'Finding similar nodes...'}</div>}
            {similarError && <div className="search-panel-error">{similarError}</div>}
          </>
        )}

        {flatResults.length > 0 && (
          <div className="search-panel-count">{flatResults.length} result{flatResults.length !== 1 ? 's' : ''}</div>
        )}
        {flatResults.map((r, i) => renderResultRow(r, i))}

        {/* Empty states */}
        {mode === 'taxonomy' && !embeddingLoading && findQuery && flatResults.length === 0 && (
          <div className="search-panel-empty">No results</div>
        )}
        {mode === 'related' && !relatedNodeId && !similarLoading && (
          <div className="search-panel-empty">Select a node above to find similar items</div>
        )}
        {isAttrMode && !attrValue && (
          <div className="search-panel-empty">Select a value above to filter nodes</div>
        )}
        {isAttrMode && attrValue && flatResults.length === 0 && (
          <div className="search-panel-empty">No matching nodes</div>
        )}
      </div>
    </div>
  );
}

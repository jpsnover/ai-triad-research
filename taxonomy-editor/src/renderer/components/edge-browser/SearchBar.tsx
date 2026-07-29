// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import { useTaxonomyStore, type SearchMode } from '../../hooks/useTaxonomyStore';
import type { PovNode, CrossCuttingNode, ConflictFile, TabId, Category, PovTaxonomyFile, SituationsFile } from '../../types/taxonomy';
import { interpretationText } from '../../types/taxonomy';
import { buildSearchRegex } from '../../utils/searchRegex';
import { ApiKeyDialog } from '../settings/ApiKeyDialog';
import { ApiKeyErrorMessage } from '../settings/ApiKeyErrorMessage';

interface SearchResult {
  id: string;
  label: string;
  tab: TabId;
  category?: Category;
  field: string;
  matchText: string;
  score?: number;
}

function searchPovNode(node: PovNode, regex: RegExp, tab: TabId): SearchResult[] {
  const results: SearchResult[] = [];
  const fields: [string, string][] = [
    ['id', node.id],
    ['label', node.label],
    ['description', node.description],
    ['category', node.category],
  ];
  for (const [field, value] of fields) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: node.id, label: node.label, tab, category: node.category, field, matchText: value });
    }
  }
  return results;
}

function searchSituationNode(node: CrossCuttingNode, regex: RegExp): SearchResult[] {
  const results: SearchResult[] = [];
  const fields: [string, string][] = [
    ['id', node.id],
    ['label', node.label],
    ['description', node.description],
    ['interp:accelerationist', interpretationText(node.interpretations.accelerationist)],
    ['interp:safetyist', interpretationText(node.interpretations.safetyist)],
    ['interp:skeptic', interpretationText(node.interpretations.skeptic)],
  ];
  for (const [field, value] of fields) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: node.id, label: node.label, tab: 'situations', field, matchText: value });
    }
  }
  return results;
}

function searchConflict(conflict: ConflictFile, regex: RegExp): SearchResult[] {
  const results: SearchResult[] = [];
  const fields: [string, string][] = [
    ['claim_id', conflict.claim_id],
    ['claim_label', conflict.claim_label],
    ['description', conflict.description],
    ['status', conflict.status],
  ];
  for (const inst of conflict.instances) {
    fields.push(['instance:doc_id', inst.doc_id]);
    fields.push(['instance:stance', inst.stance]);
    fields.push(['instance:assertion', inst.assertion]);
  }
  for (const note of conflict.human_notes) {
    fields.push(['note:author', note.author]);
    fields.push(['note:note', note.note]);
  }
  for (const [field, value] of fields) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: conflict.claim_id, label: conflict.claim_label, tab: 'conflicts', field, matchText: value });
    }
  }
  return results;
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.id}::${r.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Per-scope text-result collectors. Extracted from the textResults useMemo so the
// memo callback (and each collector) stays under the cyclomatic-complexity ceiling.
// Loop/branch order and the final dedupe are preserved exactly (ADR-007 line-slice).
function collectPovResults(
  files: readonly (readonly [TabId, PovTaxonomyFile | null])[],
  regex: RegExp,
  povScopes: Set<TabId>,
  aspectScopes: Set<Category>,
): SearchResult[] {
  const hasPovFilter = povScopes.size > 0;
  const hasAspectFilter = aspectScopes.size > 0;
  const all: SearchResult[] = [];
  for (const [pov, file] of files) {
    if (hasPovFilter && !povScopes.has(pov)) continue;
    if (file) {
      for (const node of file.nodes) {
        if (hasAspectFilter && !aspectScopes.has(node.category)) continue;
        all.push(...searchPovNode(node, regex, pov));
      }
    }
  }
  return all;
}

function collectSituationResults(
  situations: SituationsFile | null,
  regex: RegExp,
  povScopes: Set<TabId>,
  aspectScopes: Set<Category>,
): SearchResult[] {
  const hasPovFilter = povScopes.size > 0;
  const hasAspectFilter = aspectScopes.size > 0;
  const all: SearchResult[] = [];
  if (!hasPovFilter || povScopes.has('situations')) {
    if (situations) {
      for (const node of situations.nodes) {
        if (hasAspectFilter) continue;
        all.push(...searchSituationNode(node, regex));
      }
    }
  }
  return all;
}

function collectConflictResults(
  conflicts: ConflictFile[],
  regex: RegExp,
  povScopes: Set<TabId>,
  aspectScopes: Set<Category>,
): SearchResult[] {
  const hasPovFilter = povScopes.size > 0;
  const hasAspectFilter = aspectScopes.size > 0;
  const all: SearchResult[] = [];
  if (!hasPovFilter || povScopes.has('conflicts')) {
    if (!hasAspectFilter) {
      for (const conflict of conflicts) {
        all.push(...searchConflict(conflict, regex));
      }
    }
  }
  return all;
}

interface TextResultsArgs {
  findQuery: string;
  findMode: SearchMode;
  findCaseSensitive: boolean;
  accelerationist: PovTaxonomyFile | null;
  safetyist: PovTaxonomyFile | null;
  skeptic: PovTaxonomyFile | null;
  situations: SituationsFile | null;
  conflicts: ConflictFile[];
  povScopes: Set<TabId>;
  aspectScopes: Set<Category>;
}

function computeTextResults(args: TextResultsArgs): SearchResult[] {
  const {
    findQuery, findMode, findCaseSensitive,
    accelerationist, safetyist, skeptic, situations, conflicts,
    povScopes, aspectScopes,
  } = args;
  const regex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
  if (!regex) return [];

  const all: SearchResult[] = [
    ...collectPovResults(
      [
        ['accelerationist', accelerationist],
        ['safetyist', safetyist],
        ['skeptic', skeptic],
      ] as const,
      regex, povScopes, aspectScopes,
    ),
    ...collectSituationResults(situations, regex, povScopes, aspectScopes),
    ...collectConflictResults(conflicts, regex, povScopes, aspectScopes),
  ];

  return dedupeResults(all);
}

const POV_SCOPES: { id: TabId; label: string }[] = [
  { id: 'accelerationist', label: 'Acc' },
  { id: 'safetyist', label: 'Saf' },
  { id: 'skeptic', label: 'Skp' },
  { id: 'situations', label: 'CC' },
  { id: 'conflicts', label: 'Conflicts' },
];

const ASPECT_SCOPES: { id: Category; label: string }[] = [
  { id: 'Desires', label: 'Desires' },
  { id: 'Beliefs', label: 'Beliefs' },
  { id: 'Intentions', label: 'Intentions' },
];

// ---- Props-only render sub-components (no hooks) — extracted from SearchBar's
// return to keep the component under the cyclomatic-complexity ceiling. ----

interface SearchInlineRowProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  findQuery: string;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  semanticDisabled: boolean;
  embeddingLoading: boolean;
  count: string;
  isSemantic: boolean;
  onFindPrev: () => void;
  onFindNext: () => void;
  resultsCount: number;
  findMode: SearchMode;
  onModeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  showDropdown: boolean;
  hasActiveFilters: boolean;
  onToggleDropdown: () => void;
}

function SearchInlineRow(props: SearchInlineRowProps) {
  const {
    inputRef, findQuery, onInputChange, onFocus, onKeyDown, placeholder, semanticDisabled,
    embeddingLoading, count, isSemantic, onFindPrev, onFindNext, resultsCount,
    findMode, onModeChange, showDropdown, hasActiveFilters, onToggleDropdown,
  } = props;
  return (
    <div className="search-bar-inline">
      <input
        ref={inputRef}
        className="find-input"
        type="text"
        value={findQuery}
        onChange={onInputChange}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={semanticDisabled}
      />
      {embeddingLoading && <span className="search-spinner" />}
      {count && <span className="find-count">{count}</span>}
      {!isSemantic && (
        <>
          <button className="btn btn-sm" onClick={onFindPrev} disabled={resultsCount === 0} title="Previous (Shift+Enter)" aria-label="Previous match">
            &uarr;
          </button>
          <button className="btn btn-sm" onClick={onFindNext} disabled={resultsCount === 0} title="Next (Enter)" aria-label="Next match">
            &darr;
          </button>
        </>
      )}
      <select
        className="find-mode-select"
        value={findMode}
        onChange={onModeChange}
      >
        <option value="raw">Raw</option>
        <option value="wildcard">Wildcard</option>
        <option value="regex">Regex</option>
        <option value="semantic">Semantic</option>
      </select>
      <button
        className={`btn btn-ghost btn-sm ${showDropdown ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
        onClick={onToggleDropdown}
        title="Search options & filters"
      >
        {hasActiveFilters ? 'Filters*' : 'Filters'}
      </button>
    </div>
  );
}

interface SearchResultsListProps {
  show: boolean;
  results: SearchResult[];
  activeIndex: number;
  isSemantic: boolean;
  onSelectResult: (index: number, r: SearchResult) => void;
  highlightMatch: (text: string) => React.ReactNode;
}

function SearchResultsList(props: SearchResultsListProps) {
  const { show, results, activeIndex, isSemantic, onSelectResult, highlightMatch } = props;
  if (!show || results.length === 0) return null;
  return (
    <div className="find-results-panel">
      {results.map((r, i) => (
        <div
          key={`${r.id}-${r.field}-${i}`}
          className={`find-result-item ${i === activeIndex ? 'active' : ''}`}
          onClick={() => onSelectResult(i, r)}
        >
          <div className="find-result-id">
            {r.tab} / {r.id}
            {r.score != null && (
              <span className="search-score-badge">{Math.round(r.score * 100)}%</span>
            )}
          </div>
          {!isSemantic && (
            <div className="find-result-match">
              {highlightMatch(r.matchText)}
            </div>
          )}
          {isSemantic && r.label && (
            <div className="find-result-match">{r.label}</div>
          )}
        </div>
      ))}
    </div>
  );
}

interface SearchDropdownProps {
  isSemantic: boolean;
  findCaseSensitive: boolean;
  onCaseSensitiveChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenApiKeyDialog: () => void;
  showResults: boolean;
  onToggleResults: () => void;
  povScopes: Set<TabId>;
  onTogglePovScope: (id: TabId) => void;
  aspectScopes: Set<Category>;
  onToggleAspectScope: (id: Category) => void;
  embeddingError: string | null;
  results: SearchResult[];
  activeIndex: number;
  onSelectResult: (index: number, r: SearchResult) => void;
  highlightMatch: (text: string) => React.ReactNode;
}

function SearchDropdown(props: SearchDropdownProps) {
  const {
    isSemantic, findCaseSensitive, onCaseSensitiveChange, onOpenApiKeyDialog,
    showResults, onToggleResults, povScopes, onTogglePovScope, aspectScopes,
    onToggleAspectScope, embeddingError, results, activeIndex, onSelectResult, highlightMatch,
  } = props;
  return (
    <div className="search-dropdown">
      <div className="search-dropdown-options">
        {!isSemantic && (
          <label>
            <input
              type="checkbox"
              checked={findCaseSensitive}
              onChange={onCaseSensitiveChange}
            />
            Case sensitive
          </label>
        )}
        {isSemantic && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={onOpenApiKeyDialog}
            title="Configure API key (optional — local embeddings used by default)"
          >
            API Key
          </button>
        )}
        <button
          className={`btn btn-ghost btn-sm ${showResults ? 'active' : ''}`}
          onClick={onToggleResults}
          title="Show results list"
        >
          List
        </button>
      </div>

      <div className="find-scopes">
        <div className="find-scope-group">
          <span className="find-scope-label">Perspective</span>
          {POV_SCOPES.map(s => (
            <button
              key={s.id}
              className={`find-scope-chip ${povScopes.has(s.id) ? 'active' : ''}`}
              data-tab={s.id}
              onClick={() => onTogglePovScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="find-scope-group">
          <span className="find-scope-label">Aspect</span>
          {ASPECT_SCOPES.map(s => (
            <button
              key={s.id}
              className={`find-scope-chip ${aspectScopes.has(s.id) ? 'active' : ''}`}
              data-cat={s.id}
              onClick={() => onToggleAspectScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {embeddingError && (
        <ApiKeyErrorMessage error={embeddingError} />
      )}

      <SearchResultsList
        show={showResults}
        results={results}
        activeIndex={activeIndex}
        isSemantic={isSemantic}
        onSelectResult={onSelectResult}
        highlightMatch={highlightMatch}
      />
    </div>
  );
}

export function SearchBar() {
  const [showResults, setShowResults] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [povScopes, setPovScopes] = useState<Set<TabId>>(new Set());
  const [aspectScopes, setAspectScopes] = useState<Set<Category>>(new Set());
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    accelerationist, safetyist, skeptic, situations, conflicts,
    navigateToNode,
    findQuery, findMode, findCaseSensitive,
    setFindQuery, setFindMode, setFindCaseSensitive,
    hasApiKey, checkApiKey, runSemanticSearch,
    semanticResults, embeddingLoading, embeddingError,
    getLabelForId,
  } = useTaxonomyStore();

  const isSemantic = findMode === 'semantic';

  // Check API key availability on mount and when dialog closes
  useEffect(() => {
    void checkApiKey();
  }, [checkApiKey]);

  // Ctrl+F focuses input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        setShowDropdown(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced semantic search
  useEffect(() => {
    if (!isSemantic) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!findQuery.trim()) return;
    debounceRef.current = setTimeout(() => {
      void runSemanticSearch(findQuery, povScopes, aspectScopes);
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [findQuery, isSemantic, povScopes, aspectScopes, runSemanticSearch]);

  const togglePovScope = (id: TabId) => {
    setPovScopes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAspectScope = (id: Category) => {
    setAspectScopes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Text-mode results (Raw/Wildcard/Regex)
  const textResults = useMemo(() => {
    if (isSemantic) return [];
    return computeTextResults({
      findQuery, findMode, findCaseSensitive,
      accelerationist, safetyist, skeptic, situations, conflicts,
      povScopes, aspectScopes,
    });
  }, [findQuery, findMode, findCaseSensitive, accelerationist, safetyist, skeptic, situations, conflicts, povScopes, aspectScopes, isSemantic]);

  // Semantic results mapped to SearchResult shape for display
  const semResults: SearchResult[] = useMemo(() => {
    if (!isSemantic) return [];
    return semanticResults.map(r => {
      const label = getLabelForId(r.id);
      const tab: TabId = r.id.startsWith('conflict-')
        ? 'conflicts'
        : (nodePovFromId(r.id) as TabId) || 'accelerationist';
      return { id: r.id, label, tab, field: 'semantic', matchText: '', score: r.score };
    });
  }, [isSemantic, semanticResults, getLabelForId]);

  const results = isSemantic ? semResults : textResults;

  const navigateTo = useCallback((result: SearchResult) => {
    navigateToNode(result.tab, result.id);
  }, [navigateToNode]);

  const findNext = useCallback(() => {
    if (results.length === 0) return;
    const nextIdx = (activeIndex + 1) % results.length;
    setActiveIndex(nextIdx);
    navigateTo(results[nextIdx]);
  }, [results, activeIndex, navigateTo]);

  const findPrev = useCallback(() => {
    if (results.length === 0) return;
    const prevIdx = (activeIndex - 1 + results.length) % results.length;
    setActiveIndex(prevIdx);
    navigateTo(results[prevIdx]);
  }, [results, activeIndex, navigateTo]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setFindQuery('');
      setShowDropdown(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isSemantic && !e.shiftKey) {
        void runSemanticSearch(findQuery, povScopes, aspectScopes);
        setShowResults(true);
        setShowDropdown(true);
      } else if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
    }
  };

  const highlightMatch = (text: string): React.ReactNode => {
    const regex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
    if (!regex || !findQuery) return text;

    const truncated = text.length > 120 ? text.slice(0, 120) + '...' : text;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = regex.exec(truncated)) !== null && i < 10) {
      if (match.index > lastIndex) {
        parts.push(truncated.slice(lastIndex, match.index));
      }
      parts.push(<mark key={i}>{match[0]}</mark>);
      lastIndex = regex.lastIndex;
      if (match[0].length === 0) regex.lastIndex++;
      i++;
    }
    if (lastIndex < truncated.length) {
      parts.push(truncated.slice(lastIndex));
    }
    return parts.length > 0 ? parts : truncated;
  };

  const handleModeChange = (mode: SearchMode) => {
    setFindMode(mode);
    if (mode === 'semantic') {
      void checkApiKey();
    }
  };

  const handleApiKeyDialogClose = () => {
    setShowApiKeyDialog(false);
    void checkApiKey();
  };

  const semanticDisabled = false;

  const placeholder = isSemantic
    ? 'Describe what you\'re looking for...'
    : 'Search taxonomy...';

  const countText = () => {
    if (!findQuery) return '';
    if (isSemantic) {
      if (embeddingLoading) return '';
      return `${results.length}`;
    }
    return `${results.length}`;
  };

  const hasActiveFilters = povScopes.size > 0 || aspectScopes.size > 0;

  const handleSelectResult = (index: number, r: SearchResult) => {
    setActiveIndex(index);
    navigateTo(r);
  };

  return (
    <div className="search-bar-wrapper" ref={wrapperRef}>
      {/* Inline row: sits inside tab-bar flex */}
      <SearchInlineRow
        inputRef={inputRef}
        findQuery={findQuery}
        onInputChange={(e) => { setFindQuery(e.target.value); setActiveIndex(0); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        semanticDisabled={semanticDisabled}
        embeddingLoading={embeddingLoading}
        count={countText()}
        isSemantic={isSemantic}
        onFindPrev={findPrev}
        onFindNext={findNext}
        resultsCount={results.length}
        findMode={findMode}
        onModeChange={(e) => handleModeChange(e.target.value as SearchMode)}
        showDropdown={showDropdown}
        hasActiveFilters={hasActiveFilters}
        onToggleDropdown={() => setShowDropdown(v => !v)}
      />

      {/* Dropdown panel: absolutely positioned below the tab bar */}
      {showDropdown && (
        <SearchDropdown
          isSemantic={isSemantic}
          findCaseSensitive={findCaseSensitive}
          onCaseSensitiveChange={(e) => setFindCaseSensitive(e.target.checked)}
          onOpenApiKeyDialog={() => setShowApiKeyDialog(true)}
          showResults={showResults}
          onToggleResults={() => setShowResults(v => !v)}
          povScopes={povScopes}
          onTogglePovScope={togglePovScope}
          aspectScopes={aspectScopes}
          onToggleAspectScope={toggleAspectScope}
          embeddingError={embeddingError}
          results={results}
          activeIndex={activeIndex}
          onSelectResult={handleSelectResult}
          highlightMatch={highlightMatch}
        />
      )}

      {showApiKeyDialog && <ApiKeyDialog onClose={handleApiKeyDialogClose} />}
    </div>
  );
}

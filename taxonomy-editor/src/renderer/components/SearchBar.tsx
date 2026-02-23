import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTaxonomyStore, type SearchMode } from '../hooks/useTaxonomyStore';
import type { PovNode, CrossCuttingNode, ConflictFile, TabId, Category } from '../types/taxonomy';
import { buildSearchRegex } from '../utils/searchRegex';
import { ApiKeyDialog } from './ApiKeyDialog';

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

function searchCCNode(node: CrossCuttingNode, regex: RegExp): SearchResult[] {
  const results: SearchResult[] = [];
  const fields: [string, string][] = [
    ['id', node.id],
    ['label', node.label],
    ['description', node.description],
    ['interp:accelerationist', node.interpretations.accelerationist],
    ['interp:safetyist', node.interpretations.safetyist],
    ['interp:skeptic', node.interpretations.skeptic],
  ];
  for (const [field, value] of fields) {
    regex.lastIndex = 0;
    if (regex.test(value)) {
      results.push({ id: node.id, label: node.label, tab: 'cross-cutting', field, matchText: value });
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
    fields.push(['instance:position', inst.position]);
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

const POV_SCOPES: { id: TabId; label: string }[] = [
  { id: 'accelerationist', label: 'Acc' },
  { id: 'safetyist', label: 'Saf' },
  { id: 'skeptic', label: 'Skp' },
  { id: 'cross-cutting', label: 'CC' },
  { id: 'conflicts', label: 'Conflicts' },
];

const ASPECT_SCOPES: { id: Category; label: string }[] = [
  { id: 'Goals/Values', label: 'Goals' },
  { id: 'Data/Facts', label: 'Data' },
  { id: 'Methods', label: 'Methods' },
];

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
    accelerationist, safetyist, skeptic, crossCutting, conflicts,
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
    checkApiKey();
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
      runSemanticSearch(findQuery, povScopes, aspectScopes);
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
    const regex = buildSearchRegex(findQuery, findMode, findCaseSensitive);
    if (!regex) return [];

    const hasPovFilter = povScopes.size > 0;
    const hasAspectFilter = aspectScopes.size > 0;

    const all: SearchResult[] = [];

    for (const [pov, file] of [
      ['accelerationist', accelerationist],
      ['safetyist', safetyist],
      ['skeptic', skeptic],
    ] as const) {
      if (hasPovFilter && !povScopes.has(pov)) continue;
      if (file) {
        for (const node of file.nodes) {
          if (hasAspectFilter && !aspectScopes.has(node.category)) continue;
          all.push(...searchPovNode(node, regex, pov));
        }
      }
    }

    if (!hasPovFilter || povScopes.has('cross-cutting')) {
      if (crossCutting) {
        for (const node of crossCutting.nodes) {
          if (hasAspectFilter) continue;
          all.push(...searchCCNode(node, regex));
        }
      }
    }

    if (!hasPovFilter || povScopes.has('conflicts')) {
      if (!hasAspectFilter) {
        for (const conflict of conflicts) {
          all.push(...searchConflict(conflict, regex));
        }
      }
    }

    return dedupeResults(all);
  }, [findQuery, findMode, findCaseSensitive, accelerationist, safetyist, skeptic, crossCutting, conflicts, povScopes, aspectScopes, isSemantic]);

  // Semantic results mapped to SearchResult shape for display
  const semResults: SearchResult[] = useMemo(() => {
    if (!isSemantic) return [];
    return semanticResults.map(r => {
      const label = getLabelForId(r.id);
      const prefix = r.id.split('-')[0];
      const prefixToTab: Record<string, TabId> = {
        acc: 'accelerationist',
        saf: 'safetyist',
        skp: 'skeptic',
        cc: 'cross-cutting',
        conflict: 'conflicts',
      };
      const tab: TabId = r.id.startsWith('cc-')
        ? 'cross-cutting'
        : r.id.startsWith('conflict-')
          ? 'conflicts'
          : (prefixToTab[prefix] || 'accelerationist');
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
        runSemanticSearch(findQuery, povScopes, aspectScopes);
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
      checkApiKey();
    }
  };

  const handleApiKeyDialogClose = () => {
    setShowApiKeyDialog(false);
    checkApiKey();
  };

  const semanticDisabled = isSemantic && !hasApiKey;

  const placeholder = isSemantic
    ? (hasApiKey ? 'Describe what you\'re looking for...' : 'API key required')
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

  return (
    <div className="search-bar-wrapper" ref={wrapperRef}>
      {/* Inline row: sits inside tab-bar flex */}
      <div className="search-bar-inline">
        <input
          ref={inputRef}
          className="find-input"
          type="text"
          value={findQuery}
          onChange={(e) => { setFindQuery(e.target.value); setActiveIndex(0); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={semanticDisabled}
        />
        {embeddingLoading && <span className="search-spinner" />}
        {countText() && <span className="find-count">{countText()}</span>}
        {!isSemantic && (
          <>
            <button className="btn btn-sm" onClick={findPrev} disabled={results.length === 0} title="Previous (Shift+Enter)">
              &uarr;
            </button>
            <button className="btn btn-sm" onClick={findNext} disabled={results.length === 0} title="Next (Enter)">
              &darr;
            </button>
          </>
        )}
        <select
          className="find-mode-select"
          value={findMode}
          onChange={(e) => handleModeChange(e.target.value as SearchMode)}
        >
          <option value="raw">Raw</option>
          <option value="wildcard">Wildcard</option>
          <option value="regex">Regex</option>
          <option value="semantic">Semantic</option>
        </select>
        <button
          className={`btn btn-ghost btn-sm ${showDropdown ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
          onClick={() => setShowDropdown(v => !v)}
          title="Search options & filters"
        >
          {hasActiveFilters ? 'Filters*' : 'Filters'}
        </button>
      </div>

      {/* Dropdown panel: absolutely positioned below the tab bar */}
      {showDropdown && (
        <div className="search-dropdown">
          <div className="search-dropdown-options">
            {!isSemantic && (
              <label>
                <input
                  type="checkbox"
                  checked={findCaseSensitive}
                  onChange={(e) => setFindCaseSensitive(e.target.checked)}
                />
                Case sensitive
              </label>
            )}
            {isSemantic && !hasApiKey && (
              <button
                className="btn btn-sm"
                onClick={() => setShowApiKeyDialog(true)}
              >
                Configure Key
              </button>
            )}
            {isSemantic && hasApiKey && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowApiKeyDialog(true)}
                title="Update API key"
              >
                Key
              </button>
            )}
            <button
              className={`btn btn-ghost btn-sm ${showResults ? 'active' : ''}`}
              onClick={() => setShowResults(v => !v)}
              title="Show results list"
            >
              List
            </button>
          </div>

          <div className="find-scopes">
            <div className="find-scope-group">
              <span className="find-scope-label">POV</span>
              {POV_SCOPES.map(s => (
                <button
                  key={s.id}
                  className={`find-scope-chip ${povScopes.has(s.id) ? 'active' : ''}`}
                  data-tab={s.id}
                  onClick={() => togglePovScope(s.id)}
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
                  onClick={() => toggleAspectScope(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {embeddingError && (
            <div className="search-error">{embeddingError}</div>
          )}

          {showResults && results.length > 0 && (
            <div className="find-results-panel">
              {results.map((r, i) => (
                <div
                  key={`${r.id}-${r.field}-${i}`}
                  className={`find-result-item ${i === activeIndex ? 'active' : ''}`}
                  onClick={() => { setActiveIndex(i); navigateTo(r); }}
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
          )}
        </div>
      )}

      {showApiKeyDialog && <ApiKeyDialog onClose={handleApiKeyDialogClose} />}
    </div>
  );
}

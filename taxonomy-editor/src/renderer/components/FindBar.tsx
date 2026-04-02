// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTaxonomyStore, type SearchMode } from '../hooks/useTaxonomyStore';
import type { PovNode, CrossCuttingNode, ConflictFile, TabId, Category } from '../types/taxonomy';
import { buildSearchRegex } from '../utils/searchRegex';

interface SearchResult {
  id: string;
  label: string;
  tab: TabId;
  category?: Category;
  field: string;
  matchText: string;
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
    ['interp:accelerationist', node.interpretations.accelerationist],
    ['interp:safetyist', node.interpretations.safetyist],
    ['interp:skeptic', node.interpretations.skeptic],
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

export function FindBar() {
  const [visible, setVisible] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [povScopes, setPovScopes] = useState<Set<TabId>>(new Set());
  const [aspectScopes, setAspectScopes] = useState<Set<Category>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    accelerationist, safetyist, skeptic, situations, conflicts,
    setActiveTab, setSelectedNodeId,
    findQuery, findMode, findCaseSensitive,
    setFindQuery, setFindMode, setFindCaseSensitive,
  } = useTaxonomyStore();

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setVisible(v => {
          if (!v) {
            setTimeout(() => inputRef.current?.focus(), 50);
          }
          return !v;
        });
      }
      if (e.key === 'Escape' && visible) {
        setVisible(false);
        setFindQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, setFindQuery]);

  const results = useMemo(() => {
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

    if (!hasPovFilter || povScopes.has('situations')) {
      if (situations) {
        for (const node of situations.nodes) {
          // Situation nodes don't have a category, so skip if aspect-only filter is active
          if (hasAspectFilter) continue;
          all.push(...searchSituationNode(node, regex));
        }
      }
    }

    if (!hasPovFilter || povScopes.has('conflicts')) {
      // Conflicts don't have a category, so skip if aspect-only filter is active
      if (!hasAspectFilter) {
        for (const conflict of conflicts) {
          all.push(...searchConflict(conflict, regex));
        }
      }
    }

    return dedupeResults(all);
  }, [findQuery, findMode, findCaseSensitive, accelerationist, safetyist, skeptic, situations, conflicts, povScopes, aspectScopes]);

  const navigateTo = useCallback((result: SearchResult) => {
    setActiveTab(result.tab);
    setTimeout(() => setSelectedNodeId(result.id), 0);
  }, [setActiveTab, setSelectedNodeId]);

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
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else findNext();
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

  if (!visible) return null;

  return (
    <div className="find-overlay">
      <div className="find-row">
        <input
          ref={inputRef}
          className="find-input"
          type="text"
          value={findQuery}
          onChange={(e) => { setFindQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search across all taxonomy..."
          autoFocus
        />
        <span className="find-count">
          {findQuery ? `${results.length} found` : ''}
        </span>
        <button className="btn btn-sm" onClick={findPrev} disabled={results.length === 0} title="Previous (Shift+Enter)">
          &uarr;
        </button>
        <button className="btn btn-sm" onClick={findNext} disabled={results.length === 0} title="Next (Enter)">
          &darr;
        </button>
        <button
          className={`btn btn-ghost btn-sm ${showResults ? 'active' : ''}`}
          onClick={() => setShowResults(v => !v)}
          title="Show results list"
        >
          List
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setVisible(false); setFindQuery(''); }}>
          &times;
        </button>
      </div>

      <div className="find-options">
        <label>
          <input
            type="checkbox"
            checked={findCaseSensitive}
            onChange={(e) => setFindCaseSensitive(e.target.checked)}
          />
          Case sensitive
        </label>
        <select
          className="find-mode-select"
          value={findMode}
          onChange={(e) => setFindMode(e.target.value as SearchMode)}
        >
          <option value="raw">Raw</option>
          <option value="wildcard">Wildcard</option>
          <option value="regex">Regex</option>
        </select>
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

      {showResults && results.length > 0 && (
        <div className="find-results-panel">
          {results.map((r, i) => (
            <div
              key={`${r.id}-${r.field}-${i}`}
              className={`find-result-item ${i === activeIndex ? 'active' : ''}`}
              onClick={() => { setActiveIndex(i); navigateTo(r); }}
            >
              <div className="find-result-id">{r.tab} / {r.id} / {r.field}</div>
              <div className="find-result-match">
                {highlightMatch(r.matchText)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

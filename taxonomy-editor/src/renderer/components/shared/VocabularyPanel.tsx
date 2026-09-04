// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { bridgeGet } from '../../bridge/web-bridge';
import { DocLink } from './TheoryLink';
import type { StandardizedTerm, ColloquialTerm, LintViolation, CampOrigin, CoinageStatus } from '@lib/dictionary';
import './VocabularyPanel.css'; // t/3287 — readability styles, namespaced under .vocab-shared

const POV_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
};

const STATUS_ICONS: Record<string, string> = {
  accepted: '●',
  provisional: '○',
  contested: '◐',
  deprecated: '×',
};

type Tab = 'dictionary' | 'colloquial' | 'lint';

export function VocabularyPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('dictionary');
  const [standardized, setStandardized] = useState<StandardizedTerm[]>([]);
  const [colloquial, setColloquial] = useState<ColloquialTerm[]>([]);
  const [lintResults, setLintResults] = useState<LintViolation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [campFilter, setCampFilter] = useState<CampOrigin | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<CoinageStatus | 'all'>('all');
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // t/3290: distinguish "load failed" (loadError set) from a genuine "no terms" empty result, so
  // the panel never shows a silent blank list (owner reported no concepts in both Electron + web).
  const [loadError, setLoadError] = useState<string | null>(null);

  // A useRef guard survives React 19 Strict Mode's dev double-invoke of mount
  // effects, so the dictionary is loaded once rather than twice (t/2300, sibling
  // of t/2296). Low impact here — loadDictionary is an idempotent local read —
  // but the redundant fetch is avoided and the pattern matches NewsReportModal.
  const loadStartedRef = useRef(false);
  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    void loadDictionary();
  }, []);

  async function loadDictionary() {
    setLoading(true);
    setLoadError(null);
    // t/3290: mirror the load through BOTH transports; a throw sets loadError so the render shows a
    // distinct "load failed" state (not a silent blank). Fallback-Path Logging: WARN, not debug — a
    // blanked Vocabulary panel is invisible degradation (docs/error-handling.md).
    const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.loadDictionary;
    try {
      const data = isElectron
        ? await (window as any).electronAPI.loadDictionary()
        : await bridgeGet<{ standardized?: StandardizedTerm[]; colloquial?: ColloquialTerm[]; lintViolations?: LintViolation[] }>('/api/dictionary');
      setStandardized(data.standardized ?? []);
      setColloquial(data.colloquial ?? []);
      setLintResults(data.lintViolations ?? []);
    } catch (err) {
      setLoadError((err as Error).message || 'Unknown error');
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'vocabulary-panel',
        level: 'warn',
        message: `Dictionary load failed (${isElectron ? 'electron' : 'web'}) — panel shows load-error state`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredStandardized = useMemo(() => {
    let terms = standardized;
    if (campFilter !== 'all') {
      terms = terms.filter(t => t.primary_camp_origin === campFilter);
    }
    if (statusFilter !== 'all') {
      terms = terms.filter(t => t.coinage_status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      terms = terms.filter(t =>
        t.canonical_form.includes(q) ||
        t.display_form.toLowerCase().includes(q) ||
        t.definition.toLowerCase().includes(q),
      );
    }
    return terms.sort((a, b) => a.canonical_form.localeCompare(b.canonical_form));
  }, [standardized, campFilter, statusFilter, searchQuery]);

  const filteredColloquial = useMemo(() => {
    let terms = colloquial;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      terms = terms.filter(t =>
        t.colloquial_term.includes(q) ||
        t.resolves_to.some(r => r.standardized_term.includes(q)),
      );
    }
    return terms.sort((a, b) => a.colloquial_term.localeCompare(b.colloquial_term));
  }, [colloquial, searchQuery]);

  if (loading) {
    return <div className="vocabulary-panel loading vocab-shared">Loading dictionary...</div>;
  }

  // t/3290: distinct load-FAILURE state (vs. a genuine empty result below) — never a silent blank.
  if (loadError) {
    return (
      <div className="vocabulary-panel vocab-shared">
        <div className="vocab-header"><h3>Vocabulary</h3></div>
        <div className="empty-state vocab-load-error" role="alert">
          <p>Couldn&apos;t load the dictionary — {loadError}.</p>
          <button type="button" onClick={() => void loadDictionary()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vocabulary-panel vocab-shared">
      <div className="vocab-header">
        <h3>Vocabulary</h3>
        <DocLink docPath="research/comp-linguist/docs/theory-of-success/theory-of-success-vocabulary.md" label="Theory of success: Vocabulary" tooltip="Open the Vocabulary theory-of-success doc in GitHub" />
        <span className="vocab-stats">
          {standardized.length} terms / {colloquial.length} colloquial
          {lintResults.length > 0 && (
            <span className="lint-badge" title={`${lintResults.length} lint violations`}>
              {lintResults.length}
            </span>
          )}
        </span>
      </div>

      <div className="vocab-tabs">
        <button className={activeTab === 'dictionary' ? 'active' : ''} onClick={() => setActiveTab('dictionary')}>
          Dictionary ({filteredStandardized.length})
        </button>
        <button className={activeTab === 'colloquial' ? 'active' : ''} onClick={() => setActiveTab('colloquial')}>
          Colloquial ({filteredColloquial.length})
        </button>
        <button className={activeTab === 'lint' ? 'active' : ''} onClick={() => setActiveTab('lint')}>
          Lint {lintResults.length > 0 ? `(${lintResults.length})` : ''}
        </button>
      </div>

      <div className="vocab-filters">
        <input
          type="text"
          placeholder="Search terms..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="vocab-search"
        />
        {activeTab === 'dictionary' && (
          <div className="vocab-filter-row">
            <select value={campFilter} onChange={e => setCampFilter(e.target.value as CampOrigin | 'all')}>
              <option value="all">All camps</option>
              <option value="accelerationist">Accelerationist</option>
              <option value="safetyist">Safetyist</option>
              <option value="skeptic">Skeptic</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as CoinageStatus | 'all')}>
              <option value="all">All statuses</option>
              <option value="accepted">Accepted</option>
              <option value="provisional">Provisional</option>
              <option value="contested">Contested</option>
              <option value="deprecated">Deprecated</option>
            </select>
          </div>
        )}
      </div>

      <div className="vocab-content">
        {activeTab === 'dictionary' && (
          <div className="vocab-list">
            {filteredStandardized.length === 0 && (
              <div className="empty-state">
                {searchQuery || campFilter !== 'all' || statusFilter !== 'all'
                  ? 'No terms match the current filters.'
                  : 'No dictionary terms available.'}
              </div>
            )}
            {filteredStandardized.map(term => (
              <div
                key={term.canonical_form}
                className={`vocab-entry ${expandedTerm === term.canonical_form ? 'expanded' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={expandedTerm === term.canonical_form}
                onClick={() => setExpandedTerm(
                  expandedTerm === term.canonical_form ? null : term.canonical_form,
                )}
                onKeyDown={e => {
                  // t/3287 §7: keyboard-operable expandable row (Enter/Space toggles).
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedTerm(expandedTerm === term.canonical_form ? null : term.canonical_form);
                  }
                }}
              >
                <div className="vocab-entry-header">
                  <span
                    className="camp-dot"
                    /* eslint-disable-next-line local/no-inline-style -- color is computed per-term from POV_COLORS lookup */
                    style={{ color: POV_COLORS[term.primary_camp_origin] }}
                    title={term.primary_camp_origin}
                  >
                    {STATUS_ICONS[term.coinage_status] ?? '●'}
                  </span>
                  <code className="canonical">{term.canonical_form}</code>
                  <span className="display-form">{term.display_form}</span>
                  <span className="node-count" title="Used by nodes">
                    {term.used_by_nodes.length}
                  </span>
                </div>
                {expandedTerm === term.canonical_form && (
                  <div className="vocab-entry-detail">
                    <p className="definition">{term.definition}</p>
                    <div className="detail-row">
                      <strong>Camp:</strong> {term.primary_camp_origin}
                    </div>
                    <div className="detail-row">
                      <strong>Status:</strong> {term.coinage_status}
                    </div>
                    <div className="detail-row">
                      <strong>Rationale:</strong> {term.rationale_for_coinage}
                    </div>
                    {term.characteristic_phrases.length > 0 && (
                      <div className="detail-row">
                        <strong>Phrases:</strong>{' '}
                        {term.characteristic_phrases.map((p, i) => (
                          <span key={i} className="phrase-tag">{p}</span>
                        ))}
                      </div>
                    )}
                    {term.see_also && term.see_also.length > 0 && (
                      <div className="detail-row">
                        <strong>See also:</strong>{' '}
                        {term.see_also.map((s, i) => (
                          <code
                            key={i}
                            className="see-also-link"
                            onClick={e => {
                              e.stopPropagation();
                              setExpandedTerm(s);
                              setSearchQuery('');
                            }}
                          >
                            {s}
                          </code>
                        ))}
                      </div>
                    )}
                    {term.do_not_confuse_with && term.do_not_confuse_with.length > 0 && (
                      <div className="detail-row confusion">
                        <strong>Do not confuse with:</strong>
                        {term.do_not_confuse_with.map((c, i) => (
                          <div key={i} className="confusion-entry">
                            <code>{c.term}</code>: {c.note}
                          </div>
                        ))}
                      </div>
                    )}
                    {term.contested_aspects && term.contested_aspects.length > 0 && (
                      <div className="detail-row">
                        <strong>Contested:</strong>
                        <ul>
                          {term.contested_aspects.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="detail-row">
                      <strong>Used by:</strong>{' '}
                      {term.used_by_nodes.slice(0, 10).join(', ')}
                      {term.used_by_nodes.length > 10 && ` +${term.used_by_nodes.length - 10} more`}
                    </div>
                    <div className="detail-row meta">
                      Coined {term.coined_at} by {term.coined_by} ({term.coinage_log_ref})
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'colloquial' && (
          <div className="vocab-list">
            {filteredColloquial.length === 0 && (
              <div className="empty-state">
                {searchQuery ? 'No colloquial terms match the current search.' : 'No colloquial terms available.'}
              </div>
            )}
            {filteredColloquial.map(term => (
              <div key={term.colloquial_term} className="vocab-entry colloquial-entry">
                <div className="vocab-entry-header">
                  <span className={`status-badge ${term.status}`}>{term.status.replace(/_/g, ' ')}</span>
                  <strong>{term.colloquial_term}</strong>
                </div>
                <div className="resolves-to">
                  {term.resolves_to.map((r, i) => (
                    <div key={i} className="resolution">
                      <code
                        className="see-also-link"
                        onClick={() => {
                          setActiveTab('dictionary');
                          setExpandedTerm(r.standardized_term);
                          setSearchQuery('');
                        }}
                      >
                        {r.standardized_term}
                      </code>
                      <span className="when">{r.when}</span>
                      {r.default_for_camp && (
                        <span
                          className="camp-tag"
                          /* eslint-disable-next-line local/no-inline-style -- color is computed per-camp from POV_COLORS lookup */
                          style={{ color: POV_COLORS[r.default_for_camp] }}
                        >
                          {r.default_for_camp}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {term.translation_ambiguous_when && term.translation_ambiguous_when.length > 0 && (
                  <div className="ambiguous-when">
                    <em>Ambiguous when:</em> {term.translation_ambiguous_when.join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'lint' && (
          <div className="vocab-list lint-list">
            {lintResults.length === 0 ? (
              <div className="empty-state">No lint violations found.</div>
            ) : (
              lintResults.map((v, i) => (
                <div key={i} className={`lint-violation severity-${v.severity}`}>
                  <div className="lint-header">
                    <span className="severity">{v.severity}</span>
                    <span className="constraint">C{v.constraint_id}</span>
                    {v.file && <span className="file">{v.file}</span>}
                  </div>
                  <div className="lint-message">{v.message}</div>
                  {v.suggested_fix && (
                    <div className="lint-fix">{v.suggested_fix}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

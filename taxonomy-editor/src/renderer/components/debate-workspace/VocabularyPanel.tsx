// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { extractLineageNames } from '../../utils/lineageMatcher';
import { getLineageInfo } from '../../data/lineageLookup';
import type { VocabResolution } from '../../utils/vocabularyAnnotations';
import { POV_COLOR_VAR } from './utils';

export function LineageTermsView({ content }: { content: string }) {
  const names = useMemo(() => extractLineageNames(content), [content]);
  if (names.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '4px 0' }}>No lineage references found</div>;
  return (
    <div style={{ fontSize: '0.8rem', padding: '4px 0' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
        {names.length} lineage reference{names.length !== 1 ? 's' : ''}
      </div>
      {names.map((name, i) => {
        const info = getLineageInfo(name);
        return (
          <div key={i} style={{ marginBottom: 10, padding: '4px 8px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{name}</div>
            {info?.summary && (
              <div style={{ marginLeft: 16, marginTop: 2, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {info.summary}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function VocabTermCard({ bare, dict, resolved, defLookup, navigateToLineage }: {
  bare: string;
  dict?: { resolves_to: { standardized_term: string; when: string; default_for_camp?: string }[]; ambiguous_when?: string[] };
  resolved?: string;
  defLookup?: Map<string, { display: string; definition: string }>;
  navigateToLineage: (value: string) => void;
}) {
  return (
    <div style={{ marginBottom: 10, padding: '4px 8px' }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{bare}</div>
      {dict?.resolves_to.map((rt, j) => {
        const isHighlighted = resolved != null && rt.standardized_term === resolved;
        const def = defLookup?.get(rt.standardized_term);
        return (
          <div key={j} style={{ marginLeft: 16, marginTop: 4 }}>
            <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <a
                href="#"
                style={{
                  fontWeight: 600,
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                  color: isHighlighted ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title={`Go to "${def?.display ?? rt.standardized_term}" in Lineage Panel`}
                onClick={(ev) => { ev.preventDefault(); navigateToLineage(rt.standardized_term); }}
              >
                {def?.display ?? rt.standardized_term}
              </a>
              {rt.when && <span style={{ color: 'var(--text-muted)' }}>{rt.when}</span>}
              {rt.default_for_camp && (
                <span style={{ color: POV_COLOR_VAR[rt.default_for_camp] ?? 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', flexShrink: 0 }}>
                  {rt.default_for_camp}
                </span>
              )}
            </div>
            {def?.definition && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                {def.definition}
              </div>
            )}
          </div>
        );
      })}
      {!dict && resolved && (
        <div style={{ marginLeft: 16, marginTop: 2 }}>
          <div style={{ fontSize: '0.78rem' }}>
            <a
              href="#"
              style={{ textDecoration: 'underline dotted', textUnderlineOffset: '2px', color: 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={(ev) => { ev.preventDefault(); navigateToLineage(resolved); }}
            >
              {defLookup?.get(resolved)?.display ?? resolved}
            </a>
          </div>
          {defLookup?.get(resolved)?.definition && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, marginLeft: 16, lineHeight: 1.4 }}>
              {defLookup.get(resolved)!.definition}
            </div>
          )}
        </div>
      )}
      {dict?.ambiguous_when && dict.ambiguous_when.length > 0 && (
        <div style={{ marginLeft: 16, marginTop: 3, fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          Ambiguous when: {dict.ambiguous_when.join('; ')}
        </div>
      )}
    </div>
  );
}

export function VocabTermsView({ resolutions, ambiguities }: {
  resolutions: VocabResolution[];
  ambiguities?: { colloquial: string; offset?: number }[];
}) {
  const vocabTerms = useDebateStore(s => s.vocabularyTerms?.colloquial);
  const stdTerms = useDebateStore(s => s.vocabularyTerms?.standardized);
  const navigateToLineage = useTaxonomyStore(s => s.navigateToLineage);

  // Build lookup from full dictionary (shared between entries and ambiguities)
  const dictLookup = useMemo(() => {
    const lookup = new Map<string, { resolves_to: { standardized_term: string; when: string; default_for_camp?: string }[]; ambiguous_when?: string[] }>();
    if (vocabTerms) {
      for (const ct of vocabTerms) {
        const entry = ct as { colloquial_term: string; resolves_to: { standardized_term: string; when: string; default_for_camp?: string }[]; translation_ambiguous_when?: string[] };
        lookup.set(entry.colloquial_term.toLowerCase(), { resolves_to: entry.resolves_to, ambiguous_when: entry.translation_ambiguous_when });
      }
    }
    return lookup;
  }, [vocabTerms]);

  // Build canonical_form → definition lookup from standardized terms
  const defLookup = useMemo(() => {
    const lookup = new Map<string, { display: string; definition: string }>();
    if (stdTerms) {
      for (const st of stdTerms) {
        const entry = st as { canonical_form: string; display_form: string; definition: string };
        if (entry.canonical_form && entry.definition) {
          lookup.set(entry.canonical_form, { display: entry.display_form, definition: entry.definition });
        }
      }
    }
    return lookup;
  }, [stdTerms]);

  // Build unique colloquial terms from this entry's resolutions, then enrich with full dictionary data
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const bareTerms: string[] = [];
    for (const r of resolutions) {
      const key = r.colloquial.toLowerCase();
      if (!seen.has(key)) { seen.add(key); bareTerms.push(r.colloquial); }
    }
    bareTerms.sort((a, b) => a.localeCompare(b));

    return bareTerms.map(term => ({
      bare: term,
      dict: dictLookup.get(term.toLowerCase()),
      resolved: resolutions.find(r => r.colloquial.toLowerCase() === term.toLowerCase())?.canonical,
    }));
  }, [resolutions, dictLookup]);

  return (
    <div style={{ fontSize: '0.8rem', padding: '4px 0' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
        {entries.length} term{entries.length !== 1 ? 's' : ''} resolved
        {ambiguities && ambiguities.length > 0 && (
          <span style={{ color: '#d97706', marginLeft: 6 }}> · {new Set(ambiguities.map(a => a.colloquial)).size} ambiguous</span>
        )}
      </div>
      {entries.map((e, i) => (
        <VocabTermCard key={i} bare={e.bare} dict={e.dict} resolved={e.resolved} defLookup={defLookup} navigateToLineage={navigateToLineage} />
      ))}
      {ambiguities && ambiguities.length > 0 && (() => {
        const uniqueTerms = [...new Set(ambiguities.map(a => a.colloquial))].sort((a, b) => a.localeCompare(b));
        return (
          <div style={{ marginTop: 8, padding: '4px 8px', background: 'rgba(217,119,6,0.06)', borderLeft: '3px solid #d97706', borderRadius: 4 }}>
            <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 4, fontSize: '0.72rem' }}>Ambiguous meaning — could be any of these:</div>
            {uniqueTerms.map((term, i) => (
              <VocabTermCard key={i} bare={term} dict={dictLookup.get(term.toLowerCase())} defLookup={defLookup} navigateToLineage={navigateToLineage} />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

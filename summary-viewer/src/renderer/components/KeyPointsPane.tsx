import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { KeyPoint, PipelineSummary } from '../types/types';

const POV_CONFIG: Record<string, { label: string; colorVar: string; bgVar: string }> = {
  accelerationist: { label: 'Accelerationist', colorVar: 'var(--color-acc)', bgVar: 'var(--bg-acc)' },
  safetyist: { label: 'Safetyist', colorVar: 'var(--color-saf)', bgVar: 'var(--bg-saf)' },
  skeptic: { label: 'Skeptic', colorVar: 'var(--color-skp)', bgVar: 'var(--bg-skp)' },
};

const STANCE_LABELS: Record<string, string> = {
  strongly_aligned: 'Strongly Aligned',
  aligned: 'Aligned',
  neutral: 'Neutral',
  opposed: 'Opposed',
  strongly_opposed: 'Strongly Opposed',
};

interface GroupedPoint {
  docId: string;
  docTitle: string;
  index: number;
  keyPoint: KeyPoint;
  stance: string;
  sortLabel: string;
}

interface AggregatedClaim {
  docId: string;
  docTitle: string;
  claim: string;
  doc_position: string;
  potential_conflict_id: string | null;
}

interface AggregatedUnmapped {
  docId: string;
  docTitle: string;
  concept: string;
  suggested_label?: string;
  suggested_description?: string;
  suggested_pov: string;
  suggested_category: string;
  reason: string;
  'Accelerationist Interpretation'?: string;
  'Safetyist Interpretation'?: string;
  'Skeptic Interpretation'?: string;
}

function UnmappedCard({ uc, index }: { uc: AggregatedUnmapped; index: number }) {
  const addToTaxonomy = useStore(s => s.addToTaxonomy);
  const runSimilarSearch = useStore(s => s.runSimilarSearch);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ success: boolean; nodeId?: string; error?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    setResult(null);
    const label = uc.suggested_label || uc.concept.slice(0, 80);
    const description = uc.suggested_description || uc.concept;
    const interpretations = uc.suggested_pov === 'cross-cutting'
      ? {
          accelerationist: uc['Accelerationist Interpretation'] || '',
          safetyist: uc['Safetyist Interpretation'] || '',
          skeptic: uc['Skeptic Interpretation'] || '',
        }
      : undefined;
    const res = await addToTaxonomy(uc.suggested_pov, uc.suggested_category, label, description, interpretations);
    setResult(res);
    setAdding(false);
    if (res.success) {
      setTimeout(() => setMenuOpen(false), 1500);
    }
  }, [uc, addToTaxonomy]);

  return (
    <div key={`unmapped-${uc.docId}-${index}`} className="unmapped-card">
      <div className="unmapped-card-header">
        {uc.suggested_label && (
          <div className="unmapped-label">{uc.suggested_label}</div>
        )}
        <div className="unmapped-actions">
          <button
            ref={btnRef}
            className="unmapped-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
            title="Actions"
          >
            {'\u22EE'}
          </button>
          {menuOpen && (
            <div ref={menuRef} className="unmapped-popup">
              {!result?.success && (
                <button
                  className="unmapped-popup-item"
                  onClick={handleAdd}
                  disabled={adding}
                >
                  {adding ? 'Adding...' : 'Add to Taxonomy'}
                </button>
              )}
              <button
                className="unmapped-popup-item"
                onClick={() => {
                  runSimilarSearch(uc.suggested_label || uc.concept, uc.suggested_description || uc.concept);
                  setMenuOpen(false);
                }}
              >
                View Similar
              </button>
              {result?.success && (
                <div className="unmapped-popup-success">
                  Added as {result.nodeId}
                </div>
              )}
              {result && !result.success && (
                <div className="unmapped-popup-error">
                  {result.error || 'Failed'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="unmapped-concept">{uc.concept}</div>
      {uc.suggested_description && (
        <div className="unmapped-description">{uc.suggested_description}</div>
      )}
      {uc.suggested_pov === 'cross-cutting' && (
        <div className="unmapped-interpretations">
          {uc['Accelerationist Interpretation'] && (
            <div className="unmapped-interp">
              <span className="unmapped-interp-label" style={{ color: 'var(--color-acc)' }}>Accelerationist:</span>
              <span className="unmapped-interp-text">{uc['Accelerationist Interpretation']}</span>
            </div>
          )}
          {uc['Safetyist Interpretation'] && (
            <div className="unmapped-interp">
              <span className="unmapped-interp-label" style={{ color: 'var(--color-saf)' }}>Safetyist:</span>
              <span className="unmapped-interp-text">{uc['Safetyist Interpretation']}</span>
            </div>
          )}
          {uc['Skeptic Interpretation'] && (
            <div className="unmapped-interp">
              <span className="unmapped-interp-label" style={{ color: 'var(--color-skp)' }}>Skeptic:</span>
              <span className="unmapped-interp-text">{uc['Skeptic Interpretation']}</span>
            </div>
          )}
        </div>
      )}
      <div className="unmapped-meta">
        <span className="unmapped-source">{uc.docTitle}</span>
        <span className="unmapped-pov">{uc.suggested_pov}</span>
        <span className="unmapped-category">{uc.suggested_category}</span>
      </div>
      <div className="unmapped-reason">{uc.reason}</div>
    </div>
  );
}

export default function KeyPointsPane() {
  const selectedSourceIds = useStore(s => s.selectedSourceIds);
  const summaries = useStore(s => s.summaries);
  const sources = useStore(s => s.sources);
  const taxonomy = useStore(s => s.taxonomy);
  const selectedKeyPoint = useStore(s => s.selectedKeyPoint);
  const selectKeyPoint = useStore(s => s.selectKeyPoint);
  const [expandedPovs, setExpandedPovs] = useState<Set<string>>(
    new Set(['accelerationist', 'safetyist', 'skeptic'])
  );
  const [claimsExpanded, setClaimsExpanded] = useState(true);
  const [unmappedExpanded, setUnmappedExpanded] = useState(true);

  const { groupedByPov, factualClaims, unmappedConcepts } = useMemo(() => {
    const groups: Record<string, GroupedPoint[]> = {
      accelerationist: [],
      safetyist: [],
      skeptic: [],
    };
    const claims: AggregatedClaim[] = [];
    const unmapped: AggregatedUnmapped[] = [];

    for (const sourceId of selectedSourceIds) {
      const summary: PipelineSummary | undefined = summaries[sourceId];
      if (!summary) continue;

      const source = sources.find(s => s.id === sourceId);
      const docTitle = source?.title || sourceId;

      // Key points
      if (summary.pov_summaries) {
        for (const [pov, povSummary] of Object.entries(summary.pov_summaries)) {
          if (!groups[pov]) continue;
          povSummary.key_points.forEach((kp, idx) => {
            const taxNode = kp.taxonomy_node_id ? taxonomy[kp.taxonomy_node_id] : null;
            groups[pov].push({
              docId: sourceId,
              docTitle,
              index: idx,
              keyPoint: kp,
              stance: kp.stance || povSummary.stance || 'neutral',
              sortLabel: taxNode?.label || '\uffff',
            });
          });
        }
      }

      // Factual claims
      if (summary.factual_claims) {
        for (const fc of summary.factual_claims) {
          claims.push({ docId: sourceId, docTitle, ...fc });
        }
      }

      // Unmapped concepts
      if (summary.unmapped_concepts) {
        for (const uc of summary.unmapped_concepts) {
          unmapped.push({ docId: sourceId, docTitle, ...uc });
        }
      }
    }

    // Sort each POV group by taxonomy label (alphabetical), unmapped last
    for (const pov of Object.keys(groups)) {
      groups[pov].sort((a, b) => a.sortLabel.localeCompare(b.sortLabel));
    }

    return { groupedByPov: groups, factualClaims: claims, unmappedConcepts: unmapped };
  }, [selectedSourceIds, summaries, sources, taxonomy]);

  const togglePov = (pov: string) => {
    setExpandedPovs(prev => {
      const next = new Set(prev);
      if (next.has(pov)) {
        next.delete(pov);
      } else {
        next.add(pov);
      }
      return next;
    });
  };

  const totalPoints = Object.values(groupedByPov).reduce((sum, arr) => sum + arr.length, 0);

  const hasSelection = selectedSourceIds.size > 0;

  return (
    <>
      <div className="pane-header">
        <h2>Key Points</h2>
        <span className="point-count">{totalPoints} points</span>
      </div>
      <div className="pane-body">
        {!hasSelection && (
          <div className="empty-state">
            Select one or more sources to see key points
          </div>
        )}

        {/* === POV Accordions === */}
        {Object.entries(POV_CONFIG).map(([pov, config]) => {
          const points = groupedByPov[pov] || [];
          if (!hasSelection || points.length === 0) return null;

          const isExpanded = expandedPovs.has(pov);

          return (
            <div key={pov} className="pov-accordion">
              <button
                className="pov-accordion-header"
                style={{ borderLeftColor: config.colorVar }}
                onClick={() => togglePov(pov)}
              >
                <span className="pov-accordion-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="pov-accordion-label" style={{ color: config.colorVar }}>
                  {config.label}
                </span>
                <span className="pov-accordion-count">{points.length}</span>
              </button>

              {isExpanded && (
                <div className="pov-accordion-body">
                  {points.map((gp) => {
                    const isSelected = selectedKeyPoint?.docId === gp.docId &&
                      selectedKeyPoint?.pov === pov &&
                      selectedKeyPoint?.index === gp.index;

                    const taxNode = gp.keyPoint.taxonomy_node_id
                      ? taxonomy[gp.keyPoint.taxonomy_node_id]
                      : null;

                    return (
                      <div
                        key={`${gp.docId}-${pov}-${gp.index}`}
                        className={`key-point-card${isSelected ? ' selected' : ''}`}
                        onClick={() => selectKeyPoint(gp.docId, pov, gp.index)}
                      >
                        {taxNode && (
                          <div className="kp-taxonomy">
                            <span className="kp-taxonomy-id">{taxNode.id}</span>
                            <span className="kp-taxonomy-label">{taxNode.label}</span>
                            <div className="kp-taxonomy-desc">{taxNode.description}</div>
                          </div>
                        )}
                        {!taxNode && gp.keyPoint.taxonomy_node_id && (
                          <div className="kp-taxonomy">
                            <span className="kp-taxonomy-id">{gp.keyPoint.taxonomy_node_id}</span>
                            <span className="kp-taxonomy-label kp-taxonomy-unknown">Unknown node</span>
                          </div>
                        )}

                        <div className="kp-stance-row">
                          <span className="kp-stance-label">Stance:</span>
                          <span className={`kp-stance-value kp-stance--${gp.stance}`}>
                            {STANCE_LABELS[gp.stance] || gp.stance}
                          </span>
                        </div>

                        <div className="key-point-text">{gp.keyPoint.point}</div>

                        <div className="key-point-meta">
                          <span className="key-point-source">{gp.docTitle}</span>
                          <span
                            className="key-point-category"
                            style={{ background: config.bgVar, color: config.colorVar }}
                          >
                            {gp.keyPoint.category}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* === Factual Claims === */}
        {hasSelection && factualClaims.length > 0 && (
          <div className="pov-accordion section-claims">
            <button
              className="pov-accordion-header section-header--claims"
              onClick={() => setClaimsExpanded(v => !v)}
            >
              <span className="pov-accordion-arrow">{claimsExpanded ? '\u25BC' : '\u25B6'}</span>
              <span className="pov-accordion-label section-label--claims">Factual Claims</span>
              <span className="pov-accordion-count">{factualClaims.length}</span>
            </button>

            {claimsExpanded && (
              <div className="pov-accordion-body">
                {factualClaims.map((fc, i) => (
                  <div key={`claim-${fc.docId}-${i}`} className="claim-card">
                    <div className="claim-text">{fc.claim}</div>
                    <div className="claim-meta">
                      <span className="claim-source">{fc.docTitle}</span>
                      <span className={`claim-position claim-position--${fc.doc_position}`}>
                        {fc.doc_position}
                      </span>
                      {fc.potential_conflict_id && (
                        <span className="claim-conflict">{fc.potential_conflict_id}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === Unmapped Concepts === */}
        {hasSelection && unmappedConcepts.length > 0 && (
          <div className="pov-accordion section-unmapped">
            <button
              className="pov-accordion-header section-header--unmapped"
              onClick={() => setUnmappedExpanded(v => !v)}
            >
              <span className="pov-accordion-arrow">{unmappedExpanded ? '\u25BC' : '\u25B6'}</span>
              <span className="pov-accordion-label section-label--unmapped">Unmapped Concepts</span>
              <span className="pov-accordion-count">{unmappedConcepts.length}</span>
            </button>

            {unmappedExpanded && (
              <div className="pov-accordion-body">
                {unmappedConcepts.map((uc, i) => (
                  <UnmappedCard key={`unmapped-${uc.docId}-${i}`} uc={uc} index={i} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

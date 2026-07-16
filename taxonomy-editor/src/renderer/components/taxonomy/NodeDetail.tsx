// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { POV_META } from '@lib/electron-shared/povMeta';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { Pov, PovNode, Category, TabId } from '../../types/taxonomy';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { AggregatedCrux } from '../../hooks/useTaxonomyStore';
import { useDebateStore } from '../../hooks/useDebateStore';
import { DeleteConfirmDialog } from '../shared/DeleteConfirmDialog';
import { HighlightedTextarea } from '../shared/HighlightedField';
import { TypeaheadSelect } from '../shared/TypeaheadSelect';
import { FieldHelp } from '../shared/FieldHelp';
import { LinkedChip } from '../shared/LinkedChip';
import { GraphAttributesPanel } from './GraphAttributesPanel';
import { RelatedEdgesPanel } from '../edge-browser/RelatedEdgesPanel';
import { EdgeDetailPanel } from '../edge-browser/EdgeDetailPanel';
import { getLineageInfo } from '../../data/lineageLookup';
import { researchPrompt } from '../../prompts/research';
import { SourcesPanel } from '../policy/SourcesPanel';
import { PhrasesPanel } from '../policy/PhrasesPanel';
import { FactsPanel, getFactCount, preloadFactsIndex } from '../analysis/FactsPanel';
import type { SourceFact } from '../analysis/FactsPanel';
import type { SourceDocumentResolution } from '../../bridge/types';
import { ConflictsPanel, conflictsForNode } from '../conflict';
import { NodeEditHistory } from './NodeEditHistory';
import { nodeTypeFromId, nodePovFromId } from '@lib/debate/nodeIdUtils';
import { POV_KEYS } from '@lib/debate/types';
import { api } from '@bridge';
import { EditConflictBadge, type NodeConflict } from '../conflict/edit-conflicts';
import { triggerPovNodeRegeneration } from '../../utils/regeneratePlainDescription';
import { generateAphorism } from '../../utils/regenerateAphorism';
import { useDescriptionMode, resolveDescription, DescriptionToggle } from '../shared/DescriptionToggle';
import { EmptyState } from '../shared/EmptyState';
import { OverflowMenu, type OverflowMenuEntry } from '../shared/OverflowMenu';
import { DebateTestedChip } from './DebateTestedChip';
import { DebateTestedDrilldown } from './DebateTestedDrilldown';
import './NodeDetail.css';

interface MoveTarget {
  label: string;
  action: () => void;
  isTransfer?: boolean;
}

function buildOverflowEntries(moveTargets: MoveTarget[], onDelete: () => void, onAIAnalysis: () => void, onPin?: () => void): OverflowMenuEntry[] {
  const entries: OverflowMenuEntry[] = [
    { type: 'item', key: 'ai', label: 'AI Analysis', onClick: onAIAnalysis },
  ];
  if (onPin) entries.push({ type: 'item', key: 'pin', label: 'Pin for Comparison', onClick: onPin });

  const categoryMoves = moveTargets.filter(t => !t.isTransfer);
  const transfers = moveTargets.filter(t => t.isTransfer);

  entries.push({ type: 'divider' });
  for (const t of categoryMoves) {
    entries.push({ type: 'item', key: `move-${t.label}`, label: `Move to ${t.label}`, onClick: t.action });
  }
  if (transfers.length > 0) {
    entries.push({ type: 'divider' });
    entries.push({ type: 'label', text: 'Transfer to' });
    for (const t of transfers) {
      entries.push({ type: 'item', key: `xfer-${t.label}`, label: t.label, onClick: t.action, className: 'overflow-menu-transfer' });
    }
  }
  entries.push({ type: 'divider' });
  entries.push({ type: 'item', key: 'delete', label: 'Delete', onClick: onDelete, danger: true });
  return entries;
}

interface NodeDetailProps {
  pov: Pov;
  node: PovNode;
  readOnly?: boolean;
  onPin?: () => void;
  onSimilarSearch?: () => void;
  onRelated?: () => void;
  chipDepth?: number;
  conflict?: NodeConflict;
  resolveUrl?: string | null;
}

const ALL_CATEGORIES: Category[] = ['Desires', 'Beliefs', 'Intentions'];
const ALL_POVS: Pov[] = [...POV_KEYS];

/** BDI layer guidance for each category */
const BDI_GUIDANCE: Record<Category, string> = {
  'Beliefs': 'Beliefs — empirical claims that could be verified or falsified with evidence.',
  'Desires': 'Desires — normative commitments about what should happen or what matters.',
  'Intentions': 'Intentions — reasoning strategies and argumentative approaches for how to think about something.',
};

/** Singular form with article for genus-differentia descriptions */
const CATEGORY_SINGULAR: Record<Category, string> = {
  'Beliefs': 'A Belief',
  'Desires': 'A Desire',
  'Intentions': 'An Intention',
};
const POV_LABELS: Record<Pov, string> = {
  accelerationist: POV_META.accelerationist.label,
  safetyist: POV_META.safetyist.label,
  skeptic: POV_META.skeptic.label,
};

type NodeDetailTabId = 'content' | 'related' | 'attributes' | 'conflicts' | 'phrases' | 'sources' | 'facts' | 'cruxes' | 'research' | 'history';

export function NodeDetail({ pov, node, readOnly, onPin, onSimilarSearch, onRelated, chipDepth = 0, conflict, resolveUrl }: NodeDetailProps) {
  const { updatePovNode, deletePovNode, movePovNodeCategory, movePovNode, validationErrors, getAllNodeIds, getAllConflictIds, runAttributeFilter, showAttributeInfo, navigateToLineage, setToolbarPanel, selectedEdge, relatedNodeId, loadEdges, edgesFile, setSelectedNodeId, getLabelForId, aggregatedCruxes, showCruxDetail, conflicts } = useTaxonomyStore();
  const [descMode, setDescMode] = useDescriptionMode();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<NodeDetailTabId>('content');
  const [expandedLineage, setExpandedLineage] = useState<string | null>(null);
  const [showDtDrilldown, setShowDtDrilldown] = useState(false);
  const [relatedSplitPct, setRelatedSplitPct] = useState(40);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Eagerly load facts index so count badge is available
  const [factCount, setFactCount] = useState(() => getFactCount(node.id));
  useEffect(() => {
    preloadFactsIndex();
    const t = setTimeout(() => setFactCount(getFactCount(node.id)), 500);
    return () => clearTimeout(t);
  }, [node.id]);

  const cruxCount = useMemo(
    () => aggregatedCruxes?.filter(c => c.linked_node_ids.includes(node.id)).length ?? 0,
    [aggregatedCruxes, node.id],
  );

  const conflictCount = useMemo(
    () => conflictsForNode(conflicts, node.id).length,
    [conflicts, node.id],
  );

  // Source document viewer state (Facts tab)
  const [selectedFact, setSelectedFact] = useState<SourceFact | null>(null);
  const [sourceDoc, setSourceDoc] = useState<SourceDocumentResolution | null>(null);
  const [sourceDocLoading, setSourceDocLoading] = useState(false);
  const [factSplitPct, setFactSplitPct] = useState(40);
  const factSplitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedFact) { setSourceDoc(null); return; }
    let cancelled = false;
    setSourceDocLoading(true);
    api.resolveSourceDocument(selectedFact.doc_id)
      .then(res => { if (!cancelled) setSourceDoc(res); })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'node-detail', level: 'error',
          message: 'Failed to resolve source document',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        if (!cancelled) setSourceDoc({ available: false, type: null });
      })
      .finally(() => { if (!cancelled) setSourceDocLoading(false); });
    return () => { cancelled = true; };
  }, [selectedFact]);

  // Clear fact selection on node change
  useEffect(() => { setSelectedFact(null); }, [node.id]);

  const handleFactSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = factSplitRef.current;
    if (!container) return;
    const startY = e.clientY;
    const startPct = factSplitPct;
    const containerHeight = container.offsetHeight;
    const onMouseMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      setFactSplitPct(Math.min(70, Math.max(20, startPct + (dy / containerHeight) * 100)));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [factSplitPct]);

  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startPct = relatedSplitPct;
    const containerWidth = container.offsetWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const newPct = Math.min(70, Math.max(20, startPct + (dx / containerWidth) * 100));
      setRelatedSplitPct(newPct);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [relatedSplitPct]);

  // Research prompt state
  const [researchText, setResearchText] = useState('');
  const [researchCopied, setResearchCopied] = useState(false);
  const researchTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Aphorism editing / regeneration state
  const [aphorismEditing, setAphorismEditing] = useState(false);
  const [aphorismDraft, setAphorismDraft] = useState('');
  const [aphorismProposal, setAphorismProposal] = useState<string | null>(null);
  const [aphorismGenerating, setAphorismGenerating] = useState(false);

  const aphorismBaseLabel = useRef(node.label);
  const aphorismBaseDesc = useRef(node.description);

  useEffect(() => {
    setAphorismEditing(false);
    setAphorismProposal(null);
    setAphorismGenerating(false);
    aphorismBaseLabel.current = node.label;
    aphorismBaseDesc.current = node.description;
  }, [node.id]);

  const handleAphorismRegenerate = useCallback(() => {
    if (aphorismGenerating) return;
    setAphorismGenerating(true);
    const povKey = nodePovFromId(node.id) ?? pov;
    void generateAphorism(povKey, node.category, node.label, node.description)
      .then(result => {
        if (result) setAphorismProposal(result);
      })
      .finally(() => setAphorismGenerating(false));
  }, [node.id, pov, node.category, node.label, node.description, aphorismGenerating]);

  const maybeRegenAphorism = useCallback(() => {
    if (readOnly || !node.graph_attributes?.aphorism) return;
    if (node.label === aphorismBaseLabel.current && node.description === aphorismBaseDesc.current) return;
    aphorismBaseLabel.current = node.label;
    aphorismBaseDesc.current = node.description;
    handleAphorismRegenerate();
  }, [readOnly, node.graph_attributes?.aphorism, node.label, node.description, handleAphorismRegenerate]);

  // Generate research prompt when tab is selected or node changes
  useEffect(() => {
    if (activeTab === 'research') {
      setResearchText(researchPrompt(node.label, node.description));
      setResearchCopied(false);
    }
  }, [activeTab, node.id, node.label, node.description]);

  const handleResearchCopy = async () => {
    try {
      await api.clipboardWriteText(researchText);
      setResearchCopied(true);
      setTimeout(() => setResearchCopied(false), 2000);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'node-detail', level: 'warn', message: 'clipboard write failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
  };

  // When switching to Related tab, set relatedNodeId and load edges without switching toolbar
  useEffect(() => {
    if (activeTab === 'related') {
      if (relatedNodeId !== node.id) {
        useTaxonomyStore.setState({ relatedNodeId: node.id, selectedEdge: null });
      }
      if (!edgesFile) {
        void loadEdges();
      }
    }
  }, [activeTab, node.id, relatedNodeId, edgesFile, loadEdges]);

  // Same-POV category moves
  const categoryMoveTargets: MoveTarget[] = ALL_CATEGORIES
    .filter(c => c !== node.category)
    .map(c => ({ label: c, action: () => movePovNodeCategory(pov, node.id, c) }));

  // Cross-POV transfers (every other POV × every category)
  const transferTargets: MoveTarget[] = ALL_POVS
    .filter(p => p !== pov)
    .flatMap(p => ALL_CATEGORIES.map(c => ({
      label: `${POV_LABELS[p]} / ${c}`,
      action: () => movePovNode(pov, node.id, p, c),
      isTransfer: true,
    })));

  const moveTargets = [...categoryMoveTargets, ...transferTargets];

  const allCcIds = getAllNodeIds().filter(id => nodeTypeFromId(id) === 'situation');
  const allConflictIds = getAllConflictIds();

  const err = (field: string) => validationErrors[`nodes.${node.id}.${field}`];
  const hasErrors = Object.keys(validationErrors).some(k => k.startsWith(`nodes.${node.id}.`));

  useEffect(() => {
    if (hasErrors && formRef.current) {
      const firstError = formRef.current.querySelector('.has-error');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = firstError.querySelector<HTMLElement>('input, textarea');
        input?.focus();
      }
    }
  }, [hasErrors]);

  const update = (updates: Partial<PovNode>) => {
    if (readOnly) return;
    updatePovNode(pov, node.id, updates);
  };

  const addRef = (id: string) => {
    if (id && !node.situation_refs.includes(id)) {
      update({ situation_refs: [...node.situation_refs, id] });
    }
  };

  const removeRef = (ref: string) => {
    update({ situation_refs: node.situation_refs.filter(r => r !== ref) });
  };

  const addConflict = (id: string) => {
    if (id && !(node.conflict_ids || []).includes(id)) {
      update({ conflict_ids: [...(node.conflict_ids || []), id] });
    }
  };

  const removeConflict = (id: string) => {
    update({ conflict_ids: (node.conflict_ids || []).filter(c => c !== id) });
  };

  const hasGraphAttrs = !!node.graph_attributes;

  return (
    <div ref={formRef} className="node-detail-tabbed">
      <div className="nd-header">
        <div className="nd-header-top">
          <div className="nd-header-title">
            {readOnly ? (
              <span className="nd-header-label" title={node.label}>{node.label}</span>
            ) : (
              <input
                className={`nd-header-label nd-header-label-editable ${err('label') ? 'has-error' : ''}`}
                value={node.label}
                onChange={(e) => update({ label: e.target.value })}
                onBlur={maybeRegenAphorism}
                placeholder="Label"
                aria-label="Label"
                title={node.label}
              />
            )}
          </div>
          <div className="nd-header-actions">
            {onSimilarSearch && (
              <button className="nd-header-btn" onClick={onSimilarSearch} title="Find similar taxonomy elements">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
            )}
            {!readOnly && (
              <OverflowMenu entries={buildOverflowEntries(
                moveTargets,
                () => setShowDelete(true),
                () => void useTaxonomyStore.getState().runNodeCritique(pov, node),
                onPin,
              )} />
            )}
            {readOnly && onPin && (
              <button className="nd-header-btn" onClick={onPin} title="Pin for comparison">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
              </button>
            )}
          </div>
        </div>
        <div className="nd-header-meta">
          <span className="nd-header-cat" data-cat={node.category}>
            {node.category.toUpperCase()}
            <FieldHelp text={BDI_GUIDANCE[node.category]} />
          </span>
          <span className="nd-header-id">{node.id}</span>
          <EditConflictBadge conflict={conflict} resolveUrl={resolveUrl} />
        </div>

        {/* Aphorism display */}
        {aphorismEditing && !readOnly ? (
          <>
            <input
              className="nd-aphorism-input"
              value={aphorismDraft}
              onChange={(e) => setAphorismDraft(e.target.value)}
              placeholder="Enter aphorism…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  update({ graph_attributes: { ...node.graph_attributes!, aphorism: aphorismDraft || undefined } });
                  setAphorismEditing(false);
                } else if (e.key === 'Escape') {
                  setAphorismEditing(false);
                }
              }}
            />
            <div className="nd-aphorism-actions">
              <button onClick={() => {
                update({ graph_attributes: { ...node.graph_attributes!, aphorism: aphorismDraft || undefined } });
                setAphorismEditing(false);
              }}>Save</button>
              <button onClick={() => setAphorismEditing(false)}>Cancel</button>
            </div>
          </>
        ) : node.graph_attributes?.aphorism ? (
          <div className="nd-aphorism">
            <span className="nd-aphorism-text">&ldquo;{node.graph_attributes.aphorism}&rdquo;</span>
            {!readOnly && (
              <button
                className="nd-aphorism-edit-btn"
                onClick={() => { setAphorismDraft(node.graph_attributes?.aphorism ?? ''); setAphorismEditing(true); }}
                title="Edit aphorism"
              >&#9998;</button>
            )}
          </div>
        ) : !readOnly ? (
          <div className="nd-aphorism-empty">
            <button
              className="nd-aphorism-edit-btn nd-aphorism-edit-btn-visible"
              onClick={handleAphorismRegenerate}
              disabled={aphorismGenerating}
            >{aphorismGenerating ? 'Generating…' : '+ Generate aphorism'}</button>
          </div>
        ) : null}

        {/* Aphorism regeneration proposal */}
        {aphorismProposal && !readOnly && (
          <div className="nd-aphorism-regen">
            <span className="nd-aphorism-regen-text">&ldquo;{aphorismProposal}&rdquo;</span>
            <button onClick={() => {
              update({ graph_attributes: { ...node.graph_attributes!, aphorism: aphorismProposal } });
              setAphorismProposal(null);
            }}>Accept</button>
            <button onClick={() => {
              setAphorismDraft(aphorismProposal);
              setAphorismProposal(null);
              setAphorismEditing(true);
            }}>Edit</button>
            <button onClick={() => setAphorismProposal(null)}>Reject</button>
          </div>
        )}
      </div>

      {hasErrors && (
        <div className="validation-banner">
          <span className="validation-banner-icon">!</span>
          Please fix the highlighted fields before saving.
        </div>
      )}

      {/* Tab bar */}
      <div className="node-detail-tabs">
        <button
          className={`node-detail-tab ${activeTab === 'content' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('content')}
        >
          Content
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'attributes' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('attributes')}
        >
          Attributes
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'related' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('related')}
        >
          Related
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'conflicts' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('conflicts')}
        >
          Conflicts{conflictCount > 0 ? ` (${conflictCount})` : ''}
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'cruxes' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('cruxes')}
        >
          Cruxes{cruxCount > 0 ? ` (${cruxCount})` : ''}
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'phrases' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('phrases')}
        >
          Phrases
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'sources' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          Sources
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'facts' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('facts')}
        >
          Facts{factCount > 0 ? ` (${factCount})` : ''}
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'research' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('research')}
        >
          Research
        </button>
        <button
          className={`node-detail-tab ${activeTab === 'history' ? 'node-detail-tab-active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History{node._edit_history?.length ? ` (${node._edit_history.length})` : ''}
        </button>
      </div>

      {/* Tab content */}
      <div className="node-detail-tab-content">
        {activeTab === 'content' && (
          <>
            {node.category === 'Beliefs' && (
              <div className="nd-metrics-row">
                {node.confidence != null && (
                  <span className="nd-metric" title="Confidence score">
                    Confidence: <strong>{node.confidence.toFixed(2)}</strong>
                  </span>
                )}
                <DebateTestedChip
                  record={node.graph_attributes?.debate_tested}
                  description={node.description}
                  onClick={() => node.graph_attributes?.debate_tested && setShowDtDrilldown(v => !v)}
                />
              </div>
            )}
            {showDtDrilldown && node.graph_attributes?.debate_tested && (
              <DebateTestedDrilldown
                record={node.graph_attributes.debate_tested}
                description={node.description}
                onClose={() => setShowDtDrilldown(false)}
              />
            )}

            {!readOnly && err('label') && (
              <div className="error-text">{err('label')}</div>
            )}

            <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
              <div className="description-header">
                <label>
                  Description
                  <FieldHelp text={`Genus-differentia format:\n"${CATEGORY_SINGULAR[node.category]} within [POV] discourse that [differentia].\nEncompasses: ...\nExcludes: ..."\nEncompasses and Excludes must each start on a new line.`} />
                </label>
                <DescriptionToggle mode={descMode} onToggle={setDescMode} hasPlainDescription={!!node.plain_description} />
              </div>
              {descMode === 'formal' ? (
                <div className="prose" onBlur={maybeRegenAphorism}>
                  <HighlightedTextarea
                    value={node.description}
                    onChange={(v) => update({ description: v })}
                    rows={6}
                    readOnly={readOnly}
                  />
                  {err('description') && <div className="error-text">{err('description')}</div>}
                </div>
              ) : (
                <>
                  {node.plain_description === null ? (
                    <div className="plain-description-box plain-description-generating">Regenerating…</div>
                  ) : (
                    <div className="plain-description-box">{node.plain_description ?? node.description}</div>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="plain-description-regen"
                      disabled={node.plain_description === null}
                      onClick={() => triggerPovNodeRegeneration(pov, node.id, node.description, updatePovNode)}
                    >
                      ↻ Regenerate
                    </button>
                  )}
                </>
              )}
            </div>

            {hasGraphAttrs && (
              <div className="form-group">
                <label>Steelman Vulnerability</label>
                {typeof node.graph_attributes!.steelman_vulnerability === 'string' ? (
                  readOnly ? (
                    <div className="ga-promoted-text">{node.graph_attributes!.steelman_vulnerability}</div>
                  ) : (
                    <textarea
                      className="nd-vulnerability-input"
                      value={node.graph_attributes!.steelman_vulnerability}
                      rows={3}
                      onChange={(e) => {
                        update({ graph_attributes: { ...node.graph_attributes!, steelman_vulnerability: e.target.value } });
                      }}
                    />
                  )
                ) : typeof node.graph_attributes!.steelman_vulnerability === 'object' && node.graph_attributes!.steelman_vulnerability ? (
                  <div className="ga-promoted-text">
                    {(['from_accelerationist', 'from_safetyist', 'from_skeptic'] as const).map(key => {
                      const vuln = node.graph_attributes!.steelman_vulnerability as Record<string, string | undefined>;
                      const povKey = key.replace('from_', '') as 'accelerationist' | 'safetyist' | 'skeptic';
                      const meta = POV_META[povKey];
                      if (!vuln[key] && readOnly) return null;
                      return (
                        <div key={key} className="vulnerability-subsection">
                          <strong style={{ color: `var(${meta.cssVar})` }}>{meta.label}:</strong>
                          {readOnly ? (
                            <span> {vuln[key]}</span>
                          ) : (
                            <textarea
                              className="nd-vulnerability-input"
                              value={vuln[key] ?? ''}
                              rows={2}
                              onChange={(e) => {
                                update({ graph_attributes: { ...node.graph_attributes!, steelman_vulnerability: { ...vuln, [key]: e.target.value } } });
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : !readOnly ? (
                  <button
                    className="btn btn-sm nd-add-btn"
                    onClick={() => {
                      update({ graph_attributes: { ...node.graph_attributes!, steelman_vulnerability: '' } });
                    }}
                  >+ Add Vulnerability</button>
                ) : (
                  <div className="ga-empty">&mdash;</div>
                )}
              </div>
            )}

            {node.graph_attributes?.intellectual_lineage && node.graph_attributes.intellectual_lineage.length > 0 && (
              <div className="form-group">
                <label>Intellectual Lineage</label>
                <div className="ga-promoted-list">
                  {[...node.graph_attributes.intellectual_lineage].map(v => typeof v === 'string' ? v : (v as { name?: string })?.name).filter((v): v is string => typeof v === 'string' && v.length > 0).sort((a, b) => a.localeCompare(b)).map((l, i) => (
                    <span
                      key={i}
                      className={`ga-promoted-chip ga-promoted-chip-interactive${expandedLineage === l ? ' ga-promoted-chip-selected' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setExpandedLineage(expandedLineage === l ? null : l); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttributeInfo('intellectual_lineage', l); }}
                      title={`Click to view lineage info: "${l}"`}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                {expandedLineage && (() => {
                  const info = getLineageInfo(expandedLineage);
                  if (!info) return (
                    <div className="lineage-inline-detail">
                      <div className="lineage-inline-header">
                        <span className="lineage-inline-label">{expandedLineage}</span>
                        <button className="lineage-inline-close" onClick={() => setExpandedLineage(null)} title="Close">×</button>
                      </div>
                      <div className="lineage-inline-empty">No detailed information available for this lineage.</div>
                    </div>
                  );
                  return (
                    <div className="lineage-inline-detail">
                      <div className="lineage-inline-header">
                        <span className="lineage-inline-label">{info.label}</span>
                        <button className="lineage-inline-close" onClick={() => setExpandedLineage(null)} title="Close">×</button>
                      </div>
                      <div className="lineage-inline-summary">{info.summary}</div>
                      {info.example && (
                        <div className="lineage-inline-example">
                          <span className="lineage-inline-example-label">Example:</span> {info.example}
                        </div>
                      )}
                      {info.links && info.links.length > 0 && (
                        <div className="lineage-inline-links">
                          {info.links.map((link, li) => (
                            <a
                              key={li}
                              className="lineage-inline-link"
                              href="#"
                              onClick={(e) => { e.preventDefault(); void api.openExternal(link.url); }}
                              title={link.url}
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {activeTab === 'related' && (
          <div className="node-detail-related-split" ref={splitContainerRef}>
            <div className="node-detail-related-list" style={{ width: `${relatedSplitPct}%` }}>
              <RelatedEdgesPanel />
            </div>
            <div className="resize-handle" onMouseDown={handleSplitMouseDown} />
            <div className="node-detail-related-detail" style={{ width: `${100 - relatedSplitPct}%` }}>
              {selectedEdge ? (
                <EdgeDetailPanel width={0} />
              ) : (
                <EmptyState headline="No edge selected" direction="Select an edge to view details" />
              )}
            </div>
          </div>
        )}

        {activeTab === 'conflicts' && (
          <ConflictsPanel nodeId={node.id} />
        )}

        {activeTab === 'cruxes' && (
          <RelatedCruxes nodeId={node.id} mode="full" />
        )}

        {activeTab === 'attributes' && hasGraphAttrs && (
          <GraphAttributesPanel
            attrs={node.graph_attributes!}
            onBadgeClick={runAttributeFilter}
            onShowAttributeInfo={showAttributeInfo}
            onUpdatePolicyActions={readOnly ? undefined : (actions) => updatePovNode(pov, node.id, { graph_attributes: { ...node.graph_attributes!, policy_actions: actions } })}
            onUpdateAssumptions={readOnly ? undefined : (assumes) => updatePovNode(pov, node.id, { graph_attributes: { ...node.graph_attributes!, assumes } })}
            readOnly={readOnly}
            defaultOpen
            nodeCategory={node.category}
            confidence={node.confidence}
            priority={node.priority}
            operationality={node.operationality}
            doctrinallyAnchored={node.doctrinally_anchored}
            evidentialConfidence={node.evidential_confidence}
            confidenceHistory={node.confidence_history}
            priorityHistory={node.priority_history}
            operationalityHistory={node.operationality_history}
            onUpdateWeightedBdi={readOnly ? undefined : (updates) => update(updates)}
          />
        )}

        {activeTab === 'phrases' && (
          <PhrasesPanel nodeId={node.id} />
        )}

        {activeTab === 'sources' && (
          <SourcesPanel nodeId={node.id} />
        )}

        {activeTab === 'facts' && (
          <div className="facts-split-container" ref={factSplitRef}>
            <div className="facts-split-list" style={sourceDoc?.available ? { height: `${factSplitPct}%` } : undefined}>
              <FactsPanel nodeId={node.id} onSelectFact={setSelectedFact} />
            </div>
            {sourceDocLoading && (
              <div className="facts-doc-loading">
                <span className="facts-doc-spinner" />
                Resolving source document...
              </div>
            )}
            {sourceDoc?.available && (
              <>
                <div className="resize-handle resize-handle-horizontal" onMouseDown={handleFactSplitMouseDown} />
                <div className="facts-doc-pane" style={{ height: `${100 - factSplitPct}%` }}>
                  <div className="facts-doc-header">
                    <span className="facts-doc-title">{selectedFact?.doc_id}</span>
                    <span className="facts-doc-type">{sourceDoc.type?.toUpperCase()}</span>
                    <button className="facts-doc-close" onClick={() => setSelectedFact(null)} title="Close document viewer">&times;</button>
                  </div>
                  <SourceDocumentViewer doc={sourceDoc} claimText={selectedFact?.claim} />
                </div>
              </>
            )}
            {sourceDoc && !sourceDoc.available && !sourceDocLoading && (
              <div className="facts-doc-unavailable">Source document not available for this fact.</div>
            )}
          </div>
        )}

        {activeTab === 'research' && (
          <div className="node-detail-research">
            <EvidenceGraphSection nodeId={node.id} />
            <RelatedCruxes nodeId={node.id} mode="compact" />
            <div className="node-detail-research-header">
              <span className="node-detail-research-desc">Research prompt for this position. Edit as needed, then copy to clipboard.</span>
              <button
                className={`btn btn-sm${researchCopied ? '' : ' btn-ghost'}`}
                onClick={handleResearchCopy}
              >
                {researchCopied ? '\u2713 Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              ref={researchTextareaRef}
              className="node-detail-research-textarea"
              value={researchText}
              onChange={(e) => setResearchText(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        {activeTab === 'history' && (
          <NodeEditHistory
            editMeta={node._edit_meta}
            editHistory={node._edit_history}
            descriptionHistory={node.description_history}
            labelHistory={node.label_history}
          />
        )}
      </div>

      {showDelete && !readOnly && (
        <DeleteConfirmDialog
          itemLabel={node.label}
          onConfirm={() => {
            deletePovNode(pov, node.id);
            setShowDelete(false);
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

// ── Related Cruxes (shown in Research tab) ──

const CRUX_TYPE_COLORS: Record<string, string> = {
  empirical: 'var(--color-acc, #3b82f6)',
  values: 'var(--color-saf, #ef4444)',
  definitional: 'var(--color-skp, #f59e0b)',
};

function RelatedCruxes({ nodeId, mode = 'compact' }: { nodeId: string; mode?: 'compact' | 'full' }) {
  const { aggregatedCruxes, showCruxDetail, activeTab } = useTaxonomyStore();
  const related = useMemo(() => {
    const filtered = aggregatedCruxes?.filter(c => c.linked_node_ids.includes(nodeId)) ?? [];
    return mode === 'full' ? [...filtered].sort((a, b) => b.frequency - a.frequency) : filtered;
  }, [aggregatedCruxes, nodeId, mode]);
  const [expanded, setExpanded] = useState(mode === 'full' || related.length <= 5);

  if (mode === 'compact' && (!aggregatedCruxes || related.length === 0)) return null;

  const handleCruxClick = (cruxId: string) => {
    const isPovTab = (POV_KEYS as readonly string[]).includes(activeTab);
    if (isPovTab) {
      showCruxDetail(cruxId);
    } else {
      const pov = nodePovFromId(nodeId);
      if (pov && (POV_KEYS as readonly string[]).includes(pov)) {
        const store = useTaxonomyStore.getState();
        store.navigateToNode(pov as TabId, nodeId);
        useTaxonomyStore.setState({ toolbarPanel: null });
        setTimeout(() => useTaxonomyStore.getState().showCruxDetail(cruxId), 0);
      } else {
        showCruxDetail(cruxId);
      }
    }
  };

  if (mode === 'full') {
    if (related.length === 0) {
      return <div className="related-cruxes-empty">No cruxes pivot on this node yet.</div>;
    }
    return (
      <div className="related-cruxes related-cruxes-full">
        {related.map(crux => (
          <CruxChip key={crux.id} crux={crux} onClick={() => handleCruxClick(crux.id)} showDetail />
        ))}
      </div>
    );
  }

  return (
    <div className="related-cruxes">
      <div
        className="related-cruxes-header"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        <span className="related-cruxes-chevron">{expanded ? '▾' : '▸'}</span>
        Related Cruxes ({related.length})
      </div>
      {expanded && (
        <div className="related-cruxes-list">
          {related.map(crux => (
            <CruxChip key={crux.id} crux={crux} onClick={() => handleCruxClick(crux.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CruxChip({ crux, onClick, showDetail }: { crux: AggregatedCrux; onClick: () => void; showDetail?: boolean }) {
  const rs = crux.resolution_summary;
  const dominant = rs.resolved > 0 && rs.active === 0 ? 'resolved' : rs.irreducible > 0 && rs.active === 0 ? 'irreducible' : 'active';

  return (
    <button
      className={`btn btn-sm btn-ghost crux-chip${showDetail ? ' crux-chip-detail' : ''}`}
      onClick={onClick}
      title={`${crux.statement}\n\nType: ${crux.type} | Status: ${dominant}`}
    >
      <span
        className="crux-chip-dot"
        style={{ backgroundColor: CRUX_TYPE_COLORS[crux.type] ?? 'var(--text-muted)' }}
      />
      <span className="crux-chip-label">
        {showDetail ? (crux.question_form ?? crux.statement) : crux.statement}
      </span>
      <span className={`crux-chip-status crux-chip-status-${dominant}`}>
        {dominant}
      </span>
      {showDetail && (
        <span className="crux-chip-meta">
          {crux.type} · {crux.frequency}×
        </span>
      )}
    </button>
  );
}

// ── Source Document Viewer (shown in Facts tab bottom pane) ──

function highlightClaim(markdown: string, claim: string | undefined): string {
  if (!claim || !claim.trim()) return markdown;
  const escaped = claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return markdown.replace(new RegExp(`(${escaped})`, 'gi'), '**==$1==**');
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'source-doc-viewer', level: 'warn',
      message: 'Claim highlight regex failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
    return markdown;
  }
}

function SourceDocumentViewer({ doc, claimText }: { doc: SourceDocumentResolution; claimText?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      const mark = contentRef.current.querySelector('.claim-highlight');
      mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [doc, claimText]);

  if (doc.type === 'pdf' && doc.path) {
    return (
      <iframe
        className="facts-doc-iframe"
        src={doc.path}
        title="Source document (PDF)"
        onError={() => {
          getGlobalRecorder()?.record({
            type: 'embed.load-failure',
            component: 'source-doc-viewer',
            level: 'warn',
            message: 'PDF iframe failed to load',
            data: { src: doc.path },
          });
        }}
      />
    );
  }

  if (doc.type === 'markdown' && doc.content) {
    const highlighted = highlightClaim(doc.content, claimText);
    const parts = highlighted.split(/\*\*==(.*?)==\*\*/g);
    return (
      <div className="facts-doc-markdown" ref={contentRef}>
        {parts.map((part, i) =>
          i % 2 === 1
            ? <mark key={i} className="claim-highlight">{part}</mark>
            : <span key={i}>{part}</span>
        )}
      </div>
    );
  }

  return <div className="facts-doc-empty">Unable to render this document type.</div>;
}

// ── Evidence QBAF Graph (shown in Research tab) ──

interface EvidenceItem {
  id: string;
  source_doc_id: string;
  text: string;
  relation: 'support' | 'contradict';
  similarity: number;
}

interface EvidenceGraphData {
  evidence_items: EvidenceItem[];
  computed_strength: number;
  qbaf_iterations: number;
}

function EvidenceGraphSection({ nodeId }: { nodeId: string }) {
  const activeDebate = useDebateStore(s => s.activeDebate);

  const evidenceNodes = useMemo(() => {
    const an = activeDebate?.argument_network;
    if (!an) return [];
    return an.nodes.filter(
      n => n.taxonomy_refs?.includes(nodeId) && n.evidence_graph
    );
  }, [activeDebate, nodeId]);

  if (evidenceNodes.length === 0) return null;

  return (
    <div className="evidence-graph">
      <div className="evidence-graph-title">
        Evidence Graph ({evidenceNodes.length} claim{evidenceNodes.length !== 1 ? 's' : ''})
      </div>
      {evidenceNodes.map(node => {
        const eg = node.evidence_graph as EvidenceGraphData;
        const sorted = [...eg.evidence_items].sort((a, b) => {
          if (a.relation !== b.relation) return a.relation === 'contradict' ? -1 : 1;
          return b.similarity - a.similarity;
        });
        const supports = sorted.filter(e => e.relation === 'support');
        const contradicts = sorted.filter(e => e.relation === 'contradict');
        const barPct = Math.round(eg.computed_strength * 100);
        const barColor = eg.computed_strength >= 0.7 ? '#22c55e' : eg.computed_strength >= 0.4 ? '#f59e0b' : '#ef4444';
        return (
          <div key={node.id} className="evidence-claim-card">
            <div className="evidence-claim-text">
              {node.text}
              {node.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{node.attribution_text_genus}</div>}
            </div>
            <div className="evidence-strength-row">
              <div className="evidence-strength-track">
                <div className="evidence-strength-fill" style={{ width: `${barPct}%`, background: barColor }} />
              </div>
              <span className="evidence-strength-value" style={{ color: barColor }}>
                {(eg.computed_strength ?? 0).toFixed(2)}
              </span>
              <span className="evidence-strength-iter">
                {eg.qbaf_iterations} iter
              </span>
            </div>
            {sorted.map(item => (
              <div key={item.id} className={`evidence-item ${item.relation === 'support' ? 'evidence-item-support' : 'evidence-item-contradict'}`}>
                <div className="evidence-item-header">
                  <span className={`evidence-item-badge ${item.relation === 'support' ? 'evidence-item-badge-support' : 'evidence-item-badge-contradict'}`}>
                    {item.relation === 'support' ? 'SUPPORTS' : 'CONTRADICTS'}
                  </span>
                  <span className="evidence-item-sim">
                    {(item.similarity * 100).toFixed(0)}% sim
                  </span>
                  <span className="evidence-item-source">
                    {item.source_doc_id}
                  </span>
                </div>
                <div className="evidence-item-text">
                  {item.text}
                </div>
              </div>
            ))}
            <div className="evidence-summary">
              {supports.length} supporting, {contradicts.length} contradicting
            </div>
          </div>
        );
      })}
    </div>
  );
}

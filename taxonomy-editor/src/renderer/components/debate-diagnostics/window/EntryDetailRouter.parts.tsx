// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * EntryDetailRouter.parts — presentational sub-components for EntryDetailRouter.
 *
 * Behavior-preserving extraction (ADR-007 line-slice split, t/1877). Each JSX body
 * below is moved verbatim from EntryDetailRouter.tsx; only the component wrappers and
 * the top-of-body destructuring (from `p` = props, `m` = derived model) are
 * hand-authored so the JSX itself stays byte-identical. No DOM/routing/logic changes.
 */

import React from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { speakerLabel } from './helpers';
import { api } from '@bridge';
import type { EntryTab } from './types';
import { ModeratorTab, OverflowMenu } from './shared';
import type { OverflowItem } from './shared/OverflowMenu';
import {
  DraftTab, ClaimsTab, EvidenceTab, CitationsTab,
  TaxRefsTab, DetailsTab, BriefTab, PlanTab, LookaheadTab, CiteTab,
  ExclusionGuardTab, AffectTab,
} from './entry-tabs';
import type { EntryDetailRouterProps } from './EntryDetailRouter';
import {
  isTabEnabled,
  type EntryDetailRouterModel,
  type EntryTabDescriptor,
} from './EntryDetailRouter.model';

const VISIBLE_TAB_IDS: Set<EntryTab> = new Set(['details', 'brief', 'plan', 'evidence', 'claims', 'draft']);

interface PartProps {
  p: EntryDetailRouterProps;
  m: EntryDetailRouterModel;
}

type IntMeta = EntryDetailRouterProps['entry']['intervention_metadata'];
type TopicAlignment = NonNullable<NonNullable<EntryDetailRouterProps['diag']>['topic_alignment']>;

// Pure branch selection for the scope badge — extracted from EntryHeader's
// topic-alignment IIFE (ADR-007) so both the component and this chain stay ≤15.
function scopeBadgeState(
  ta: TopicAlignment,
  modRedirect: unknown,
  modDrift: boolean,
  hasDemotedRef: boolean,
  intMeta: IntMeta,
): { state: 'green' | 'amber' | 'red'; label: string; tip: string } {
  let state: 'green' | 'amber' | 'red';
  let label: string;
  let tip: string;
  if (!ta.topic_aligned || modRedirect) {
    state = 'red'; label = modRedirect ? 'drift redirect' : 'off-scope'; tip = modRedirect ? `Moderator ${intMeta!.move} for drift` : 'Topic alignment failed after all retries';
  } else if (ta.repaired) {
    state = 'amber'; label = 'repaired'; tip = 'Off-scope draft repaired on retry';
  } else if (modDrift || hasDemotedRef) {
    state = 'amber'; label = 'drift noted'; tip = modDrift ? 'Moderator flagged drift concern' : 'References demoted taxonomy node';
  } else {
    state = 'green'; label = 'on-scope'; tip = 'All topic alignment checks passed';
  }
  return { state, label, tip };
}

// Scope/topic-alignment badge — extracted verbatim from EntryHeader's IIFE.
function TopicAlignmentBadge({ entry, diag, meta }: Pick<EntryDetailRouterProps, 'entry' | 'diag' | 'meta'>) {
  if (!diag?.topic_alignment) return null;
  const ta = diag.topic_alignment;
  const sft = (meta?.injection_manifest as Record<string, unknown> | undefined)?.scope_filter_trace as
    { demoted?: { nodeId: string }[] } | undefined;
  const demotedIds = new Set((sft?.demoted ?? []).map(d => d.nodeId));
  const hasDemotedRef = (entry.taxonomy_refs ?? []).some(r => demotedIds.has(r.node_id));
  const modTrace = meta?.moderator_trace as Record<string, unknown> | undefined;
  const modDrift = modTrace?.drift_detected === true;
  const intMeta = entry.intervention_metadata;
  const modRedirect = modDrift && intMeta && ['REDIRECT', 'CHALLENGE'].includes(intMeta.move);
  const { state, label, tip } = scopeBadgeState(ta, modRedirect, modDrift, hasDemotedRef, intMeta);
  const colors = { green: 'var(--success)', amber: 'var(--warning, var(--warning))', red: 'var(--danger)' };
  const bgs = { green: 'color-mix(in srgb, var(--success) 15%, transparent)', amber: 'color-mix(in srgb, var(--warning, var(--warning)) 15%, transparent)', red: 'color-mix(in srgb, var(--danger) 15%, transparent)' };
  return (
    <span title={tip} className="edr-scope-badge" style={{
      background: bgs[state], color: colors[state],
    }}>{label}</span>
  );
}

// ---------------------------------------------------------------------------
// Entry header (statement badge, speaker, scope/repair badges, nav)
// ---------------------------------------------------------------------------

export function EntryHeader({ p, m }: PartProps) {
  const { entry, diag, meta, proxiedModeratorTrace, entryIdx, debate, setSelectedEntry, setLocalOverride, setOverviewTab } = p;
  const { stmtId, totalEntries, pipelineError } = m;
  const goToIdx = (i: number) => {
    if (i < 0 || i >= totalEntries) return;
    setSelectedEntry(debate.transcript[i].id);
    setLocalOverride(true);
  };
  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '2px 8px', fontSize: 'var(--text-2xs)', fontWeight: 600,
    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
    background: disabled ? 'transparent' : 'color-mix(in srgb, var(--accent, var(--color-acc)) 10%, transparent)',
    color: disabled ? 'var(--text-muted)' : 'var(--accent, var(--color-acc))',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div className="edr-header">
      {stmtId && (
        <span
          title={`Statement ${stmtId}`}
          className="edr-stmt-badge"
        >{stmtId}</span>
      )}
      <strong className="edr-speaker">{speakerLabel(entry.speaker)}</strong>
      <span className="edr-entry-type">{entry.type}</span>
      <button
        onClick={() => { void api.clipboardWriteText(entry.id); }}
        className="edr-copy-id-btn"
        title={`Copy turn_id for flight recorder correlation: ${entry.id}`}
      >{entry.id.slice(0, 8)}</button>
      {diag?.topic_alignment && <TopicAlignmentBadge entry={entry} diag={diag} meta={meta} />}
      {diag?.entailment_repairs && diag.entailment_repairs.some(r => r.verdict !== 'entailed') && (() => {
        const repaired = diag.entailment_repairs!.filter(r => r.verdict !== 'entailed');
        return (
          <span title={`${repaired.length} claim${repaired.length !== 1 ? 's' : ''} repaired by entailment verification`} className="edr-scope-badge" style={{
            background: 'color-mix(in srgb, var(--warning, var(--warning)) 15%, transparent)', color: 'var(--warning, var(--warning))',
          }}>{repaired.length} repaired</span>
        );
      })()}
      {pipelineError && (
        <span title="Pipeline stages completed but post-pipeline processing (claim extraction, evidence, AN update) failed — check flight recorder" className="edr-scope-badge" style={{
          background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)',
        }}>pipeline error</span>
      )}
      {!diag && !proxiedModeratorTrace && entry.type !== 'intervention' && <span className="edr-no-diag-note">(no diagnostic capture &mdash; turn was generated before diagnostics was always-on)</span>}
      <span className="edr-spacer" />
      <button
        onClick={() => { setSelectedEntry(null); setLocalOverride(true); }}
        title="Back to overview"
        className="edr-back-btn"
      >{'◀'} Back</button>
      <button
        onClick={() => goToIdx(entryIdx - 1)}
        disabled={entryIdx <= 0}
        title="Previous statement"
        style={navBtnStyle(entryIdx <= 0)}
      >{'◀'} Prev</button>
      <button
        onClick={() => goToIdx(entryIdx + 1)}
        disabled={entryIdx >= totalEntries - 1}
        title="Next statement"
        style={navBtnStyle(entryIdx >= totalEntries - 1)}
      >Next {'▶'}</button>
      <span className="edr-counter">
        {entryIdx + 1} / {totalEntries}
      </span>
      {diag?.stage_diagnostics?.some(s => s.prompt) && debate && (
        <button
          onClick={() => { setSelectedEntry(entry.id); setOverviewTab('prompt-diff'); setLocalOverride(true); }}
          title="View Prompt Diff for this entry"
          className="edr-prompt-diff-btn"
        >Prompt Diff</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proxied moderator deliberation trace (system entries)
// ---------------------------------------------------------------------------

export function ProxiedModeratorTrace({ trace }: { trace: Record<string, unknown> }) {
  const t = trace as {
    selected?: string; focus_point?: string; selection_reason?: string;
    excluded_last_speaker?: string | null; recent_scheme?: string | null;
    convergence_score?: number | null; convergence_triggered?: boolean;
    candidates?: { debater: string; computed_strength: number | null; claim_count?: number; scored_count?: number; rank: number }[];
    argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
    commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
  };
  return (
    <div className="edr-mod-trace">
      <div className="edr-mod-trace-header">
        Moderator Deliberation
      </div>
      {t.selected && (
        <div className="edr-mod-trace-row">
          <strong>Selected:</strong> {t.selected}
          {t.selection_reason && <span className="edr-mod-trace-reason">{t.selection_reason.replace(/_/g, ' ')}</span>}
          {t.excluded_last_speaker && <span className="edr-mod-trace-excluded">(excluded last speaker: {t.excluded_last_speaker})</span>}
        </div>
      )}
      {t.focus_point && <div className="edr-mod-trace-row"><strong>Focus:</strong> {t.focus_point}</div>}
      {t.candidates && t.candidates.length > 0 && (
        <div className="edr-mod-trace-row">
          <strong>Candidates:</strong>{' '}
          {t.candidates.map((c, i) => (
            <span key={i} style={{ marginRight: 8, fontWeight: c.debater === t.selected ? 700 : 400, opacity: c.debater === t.selected ? 1 : 0.7 }}
              title={[
                `CANDIDATE RANKING — ${c.debater}`,
                ``,
                `QBAF Score: ${c.computed_strength != null ? c.computed_strength.toFixed(2) : 'n/a (no scored claims)'}`,
                `Claims in argument network: ${c.claim_count ?? '?'}`,
                `Claims with QBAF scores: ${c.scored_count ?? '?'}`,
                ``,
                `The QBAF score is the average computed_strength across all`,
                `of this debater's claims in the argument network.`,
                ``,
                `computed_strength uses Quantitative Bipolar Argumentation`,
                `Framework (QBAF) propagation: each claim starts with a`,
                `base_strength (0-1), then attack/support edges from other`,
                `claims raise or lower it. The final score reflects how well`,
                `a claim survives challenges and gains support.`,
                ``,
                `Interpretation:`,
                `  0.0-0.3  Weak — claims are heavily attacked or unsupported`,
                `  0.3-0.5  Below average — more attacks than support`,
                `  0.5       Neutral — balanced or unengaged`,
                `  0.5-0.7  Above average — net support from other claims`,
                `  0.7-1.0  Strong — well-supported, surviving challenges`,
                ``,
                `Lower-ranked candidates are selected first, as they have`,
                `weaker argumentation positions and greater need to respond.`,
              ].join('\n')}
            >
              #{c.rank} {c.debater}{c.computed_strength != null ? ` (QBAF: ${c.computed_strength.toFixed(2)})` : ''}
            </span>
          ))}
        </div>
      )}
      {t.convergence_score != null && (
        <div className="edr-mod-trace-row">
          <strong>Convergence:</strong> {(t.convergence_score * 100).toFixed(0)}%
          {t.convergence_triggered && <span className="edr-mod-trace-convergence-triggered">triggered</span>}
        </div>
      )}
      {t.recent_scheme && <div className="edr-mod-trace-row"><strong>Recent scheme:</strong> {t.recent_scheme}</div>}
      {t.argument_network_snapshot && (
        <div className="edr-mod-trace-row">
          <strong>AN snapshot:</strong> {t.argument_network_snapshot.total_claims} claims, {t.argument_network_snapshot.total_edges} edges, {t.argument_network_snapshot.unaddressed_claims} unaddressed
        </div>
      )}
      {t.commitment_snapshot && (
        <div className="edr-mod-trace-commitments">
          {Object.entries(t.commitment_snapshot).map(([name, c]) => (
            <span key={name} className="edr-mod-trace-commitment-entry">{name}: {c.asserted}A {c.conceded}C {c.challenged}Ch</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar (visible tabs + overflow menu + copy button)
// ---------------------------------------------------------------------------

export function EntryTabBar({ p, m }: PartProps) {
  const { setEntryTab } = p;
  const { tabs, activeTab, active, pipelineError } = m;
  const tabEnabled = isTabEnabled;
  const handleCopy = () => { if (active.copy) navigator.clipboard?.writeText(active.copy).catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-entry-detail', level: 'warn', message: 'Clipboard write failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); }); };

  const tabBtnStyle = (t: EntryTabDescriptor): React.CSSProperties => {
    const enabled = tabEnabled(t);
    return {
      padding: '6px 12px',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      border: '1px solid var(--border)',
      borderBottom: t.id === activeTab ? '1px solid var(--bg-primary)' : '1px solid var(--border)',
      background: t.id === activeTab ? 'var(--bg-primary)' : 'transparent',
      color: !enabled ? 'var(--text-muted)' : t.ranEmpty ? 'var(--warning, var(--warning))' : (t.id === activeTab ? 'var(--accent, var(--color-acc))' : 'var(--text-primary)'),
      cursor: enabled ? 'pointer' : 'not-allowed',
      opacity: enabled ? 1 : 0.5,
      borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
      marginRight: 2,
      marginBottom: -1,
      position: 'relative',
      zIndex: t.id === activeTab ? 2 : 1,
    };
  };

  return (
    <div className="edr-tab-bar">
      {tabs.filter(t => VISIBLE_TAB_IDS.has(t.id)).map(t => (
        <button
          key={t.id}
          onClick={() => tabEnabled(t) && setEntryTab(t.id)}
          disabled={!tabEnabled(t)}
          style={tabBtnStyle(t)}
          title={t.has ? t.label : t.ranEmpty ? `${t.label} — stage ran, no output` : `${t.label} (no data)`}
        >
          {t.ranEmpty && <span className="edr-tab-ran-empty-marker">∅</span>}
          {t.label}
          {!t.has && !t.ranEmpty && pipelineError && (t.id === 'claims' || t.id === 'evidence' || t.id === 'citations') && (
            <span title="Skipped — pipeline error" className="edr-tab-pipeline-warn">⚠</span>
          )}
          {t.count != null && <span className="edr-tab-count">({t.count})</span>}
        </button>
      ))}
      <OverflowMenu
        items={tabs.filter(t => !VISIBLE_TAB_IDS.has(t.id)).map((t): OverflowItem => ({
          id: t.id,
          label: t.label,
          enabled: tabEnabled(t),
          count: t.count,
          ranEmpty: t.ranEmpty,
          tooltip: t.has ? t.label : t.ranEmpty ? `${t.label} — stage ran, no output` : `${t.label} (no data)`,
        }))}
        activeId={!VISIBLE_TAB_IDS.has(activeTab) ? activeTab : null}
        onSelect={(id) => setEntryTab(id as EntryTab)}
      />
      <div className="edr-spacer" />
      {active.has && active.id !== 'tax-refs' && (
        <button
          onClick={handleCopy}
          className="edr-tab-copy-btn"
          title="Copy tab content"
        >Copy</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content router (per-activeTab pane)
// ---------------------------------------------------------------------------

// Tab panes are split into three cohesive groups (ADR-007) so each rendering
// function stays ≤15 complexity. Only one branch renders at a time; the fragments
// carry no wrapper DOM, so grouping is behavior-preserving.
function EntryTabPanesPrimary({ p, m }: PartProps) {
  const {
    entry, entryIdx, diag, meta, debate, an, turnValTrail, perTurnUtilities,
    taxNodeMap, policyMap, allEdges, nodeWeights, nodeLabels,
    selectedTaxRefId, setSelectedTaxRefId, setOverviewTab,
  } = p;
  const {
    activeTab, taxRefCount, precedingIntervention, interventionResponseField,
    suppressedIntervention, entryErrors, modTrace, briefStage, briefAttempts,
  } = m;

  return (
    <>
      {/* ══════════════ TAX-REFS TAB ══════════════ */}
      {activeTab === 'tax-refs' && (
        <TaxRefsTab
          entry={entry}
          meta={meta}
          debate={debate}
          taxRefCount={taxRefCount}
          nodeWeights={nodeWeights}
          taxNodeMap={taxNodeMap}
          allEdges={allEdges}
          selectedTaxRefId={selectedTaxRefId}
          setSelectedTaxRefId={setSelectedTaxRefId}
          setOverviewTab={setOverviewTab}
        />
      )}

      {/* ══════════════ DETAILS (OVERVIEW) TAB ══════════════ */}
      {activeTab === 'details' && (
        <DetailsTab
          entry={entry}
          entryIdx={entryIdx}
          diag={diag}
          meta={meta}
          debate={debate}
          an={an}
          turnValTrail={turnValTrail}
          perTurnUtilities={perTurnUtilities}
          precedingIntervention={precedingIntervention}
          interventionResponseField={interventionResponseField}
          suppressedIntervention={suppressedIntervention}
          policyMap={policyMap}
          allEdges={allEdges}
          taxNodeMap={taxNodeMap}
          nodeWeights={nodeWeights}
          nodeLabels={nodeLabels}
          selectedTaxRefId={selectedTaxRefId}
          setSelectedTaxRefId={setSelectedTaxRefId}
          entryErrors={entryErrors}
        />
      )}

      {/* ══════════════ MODERATOR TAB ══════════════ */}
      {activeTab === 'moderator' && modTrace && (
        <div className="edr-tab-pane">
          <ModeratorTab trace={modTrace} />
        </div>
      )}

      {/* ══════════════ BRIEF TAB ══════════════ */}
      {activeTab === 'brief' && briefStage && (
        <BriefTab
          entry={entry}
          briefStage={briefStage}
          briefAttempts={briefAttempts}
          turnValTrail={turnValTrail}
          nodeWeights={nodeWeights}
          taxNodeMap={taxNodeMap}
          allEdges={allEdges}
          selectedTaxRefId={selectedTaxRefId}
          setSelectedTaxRefId={setSelectedTaxRefId}
        />
      )}
    </>
  );
}

function EntryTabPanesSecondary({ p, m }: PartProps) {
  const {
    entry, diag, meta, debate, an, turnValTrail,
    taxNodeMap, policyMap, allEdges, nodeWeights,
    selectedTaxRefId, setSelectedTaxRefId, selectedPolicyId, setSelectedPolicyId,
  } = p;
  const {
    activeTab, planStage, planAttempts, draftStage, lookaheadDiag, citeStage, citeAttempts, briefStage,
  } = m;

  return (
    <>
      {/* ══════════════ PLAN TAB ══════════════ */}
      {activeTab === 'plan' && planStage && (
        <PlanTab
          planStage={planStage}
          planAttempts={planAttempts}
          taxNodeMap={taxNodeMap}
          allEdges={allEdges}
          selectedTaxRefId={selectedTaxRefId}
          setSelectedTaxRefId={setSelectedTaxRefId}
        />
      )}

      {/* ══════════════ DRAFT TAB (delegated) ══════════════ */}
      {activeTab === 'draft' && (draftStage || entry.content) && (
        <div className="edr-tab-pane">
          <DraftTab
            entry={entry as any}
            diag={diag}
            meta={meta}
            debate={debate as any}
            turnValTrail={turnValTrail}
            an={an}
            selectedTaxRefId={selectedTaxRefId}
            setSelectedTaxRefId={setSelectedTaxRefId}
            nodeWeights={nodeWeights as any}
            taxNodeMap={taxNodeMap}
            allEdges={allEdges}
          />
        </div>
      )}

      {/* ══════════════ LOOKAHEAD TAB ══════════════ */}
      {activeTab === 'lookahead' && lookaheadDiag && (
        <LookaheadTab
          lookaheadDiag={lookaheadDiag}
        />
      )}

      {/* ══════════════ CITE TAB ══════════════ */}
      {activeTab === 'cite' && citeStage && (
        <CiteTab
          entry={entry}
          debate={debate}
          citeStage={citeStage}
          citeAttempts={citeAttempts}
          briefStage={briefStage}
          turnValTrail={turnValTrail}
          taxNodeMap={taxNodeMap}
          allEdges={allEdges}
          policyMap={policyMap}
          selectedTaxRefId={selectedTaxRefId}
          setSelectedTaxRefId={setSelectedTaxRefId}
          selectedPolicyId={selectedPolicyId}
          setSelectedPolicyId={setSelectedPolicyId}
        />
      )}
    </>
  );
}

function EntryTabPanesTertiary({ p, m }: PartProps) {
  const { entry, entryIdx, diag, meta, debate, an, nodeWeights, searchQuery } = p;
  const { activeTab, tabs } = m;

  return (
    <>
      {/* ══════════════ CLAIMS TAB (delegated) ══════════════ */}
      {activeTab === 'claims' && (
        <div className="edr-tab-pane">
          {tabs.find(t => t.id === 'claims')?.ranEmpty && (
            <div className="edr-ran-empty-notice">
              <div className="edr-ran-empty-label">Stage ran — no output</div>
              <div className="edr-ran-empty-desc">The pipeline completed but claim extraction produced no claims for this entry. This may indicate the entry content was too short or off-topic for extraction.</div>
            </div>
          )}
          <ClaimsTab
            entry={entry as any}
            diag={diag}
            meta={meta}
            debate={debate as any}
            an={an}
            nodeWeights={nodeWeights as any}
            searchQuery={searchQuery}
          />
        </div>
      )}

      {/* ══════════════ EXCLUSION GUARD TAB ══════════════ */}
      {activeTab === 'exclusion' && (
        <ExclusionGuardTab diag={diag} />
      )}

      {/* ══════════════ AFFECT TAB ══════════════ */}
      {activeTab === 'affect' && (
        <AffectTab entry={entry} debate={debate} entryIdx={entryIdx} />
      )}

      {/* ══════════════ EVIDENCE TAB (delegated) ══════════════ */}
      {activeTab === 'evidence' && (
        <div className="edr-tab-pane">
          {tabs.find(t => t.id === 'evidence')?.ranEmpty && (
            <div className="edr-ran-empty-notice">
              <div className="edr-ran-empty-label">Stage ran — no output</div>
              <div className="edr-ran-empty-desc">The pipeline completed but the evidence stage produced no facts or key points for this entry.</div>
            </div>
          )}
          <EvidenceTab
            entry={entry as any}
            diag={diag}
            an={an}
            searchQuery={searchQuery}
          />
        </div>
      )}

      {/* ══════════════ CITATIONS TAB (delegated) ══════════════ */}
      {activeTab === 'citations' && (
        <div className="edr-tab-pane">
          {tabs.find(t => t.id === 'citations')?.ranEmpty && (
            <div className="edr-ran-empty-notice">
              <div className="edr-ran-empty-label">Stage ran — no output</div>
              <div className="edr-ran-empty-desc">The draft stage completed but produced no citation resolution data. The cite stage may have been skipped or the entry contained no references to verify.</div>
            </div>
          )}
          <CitationsTab
            diag={diag}
            searchQuery={searchQuery}
          />
        </div>
      )}
    </>
  );
}

export function EntryTabContent({ p, m }: PartProps) {
  const { setTextCopyMenu, tabContentRef } = p;
  const { activeTab } = m;

  return (
    <div ref={tabContentRef} tabIndex={0} onContextMenu={(e) => {
      const sel = window.getSelection()?.toString();
      if (sel && sel.trim().length > 0) {
        e.preventDefault();
        setTextCopyMenu({ x: e.clientX, y: e.clientY, text: sel });
      }
    }} className="edr-tab-content" style={activeTab === 'tax-refs' ? { padding: '8px 10px' } : { padding: 0 }}>
      <EntryTabPanesPrimary p={p} m={m} />
      <EntryTabPanesSecondary p={p} m={m} />
      <EntryTabPanesTertiary p={p} m={m} />
    </div>
  );
}

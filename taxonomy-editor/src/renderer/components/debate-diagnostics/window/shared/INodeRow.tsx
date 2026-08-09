// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './INodeRow.css';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useFlag } from '../../../../hooks/useFeatureFlags';
import { resolveSpeaker } from '../../../shared/SpeakerIdentity';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import { POVER_INFO } from '../../../../types/debate';
import type { SpeakerId } from '../../../../types/debate';
import { explainNodeStrength } from '../../../../utils/qbafExplain';
import { SUB_SCORE_TIPS, BELIEF_KEYS } from './constants';
import { ScoreBadge } from './ScoreBadge';
import { BookmarkLink } from '../../../shared/BookmarkLink';

// NOTE: speakerLabel stays in DiagnosticsWindow.tsx (parent). A local copy is provided here
// for self-contained compilation. When integrating, pass speakerLabel as a prop or import
// from a shared utility module.
// NOTE: AifBadge stays in DiagnosticsWindow.tsx (parent) — not used directly in INodeRow.
// NOTE: Highlight stays in DiagnosticsWindow.tsx (parent). A local context-free version is
// provided here. When integrating, thread the search query via props or context.

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'You';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
}

/** Local context-free highlight component. Renders plain text when no query provided. */
function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query || !text) return <>{text}</>;
  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  while (idx >= 0) {
    if (idx > lastIdx) parts.push({ text: text.slice(lastIdx, idx), match: false });
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    lastIdx = idx + q.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), match: false });
  return <>{parts.map((p, i) => p.match ? <mark key={i} data-search-match="" className="inr-hl-mark">{p.text}</mark> : p.text)}</>;
}

/** Returns a verbose tooltip for a BDI sub-score key+value. */
export function subScoreTip(key: string, val: number): string {
  const band = val >= 0.7 ? 'Strong' : val >= 0.4 ? 'Moderate' : 'Weak';
  const base: Record<string, string> = {
    evidence_quality: `Evidence Quality: ${val.toFixed(2)} (${band})\n\nHow well-supported is this claim by cited evidence?\n\nScoring: Scores default to 0.5 for all Belief claims (human adjusts later via slider). Beliefs have low scoring reliability (Q-0 calibration r = -0.12 to 0.20).\n≥0.7 = strong evidence cited\n0.4–0.69 = partial or indirect evidence\n<0.4 = unsupported or speculative`,
    source_reliability: `Source Reliability: ${val.toFixed(2)} (${band})\n\nHow credible and authoritative are the sources cited?\n\nScoring: Scores default to 0.5 for all Belief claims (human adjusts later via slider). Beliefs have low scoring reliability (Q-0 calibration r = -0.12 to 0.20).\n≥0.7 = authoritative, peer-reviewed, or official sources\n0.4–0.69 = mixed or secondary sources\n<0.4 = no sources or unreliable ones`,
    falsifiability: `Falsifiability: ${val.toFixed(2)} (${band})\n\nCan this claim be tested or disproven with observable evidence?\n\nScoring: Scores default to 0.5 for all Belief claims (human adjusts later via slider). Beliefs have low scoring reliability (Q-0 calibration r = -0.12 to 0.20).\n≥0.7 = clearly testable with specific criteria\n0.4–0.69 = partially testable\n<0.4 = unfalsifiable or purely theoretical`,
    values_grounding: `Values Grounding: ${val.toFixed(2)} (${band})\n\nIs this value claim explicitly grounded in stated values or principles?\n\nScoring: Rated 0–1 independently for Desire claims (Q-0 calibration r = 0.65). base_strength = average of all 3 Desire sub-scores.\n≥0.7 = explicitly ties to named values, ethical frameworks, or stated principles\n0.4–0.69 = implicitly value-laden but not explicitly grounded\n<0.4 = value claim without clear normative basis`,
    tradeoff_acknowledgment: `Tradeoff Acknowledgment: ${val.toFixed(2)} (${band})\n\nDoes the claim acknowledge competing tradeoffs or costs?\n\nScoring: Rated 0–1 independently for Desire claims (Q-0 calibration r = 0.65). base_strength = average of all 3 Desire sub-scores.\n≥0.7 = explicitly names costs, risks, or competing values\n0.4–0.69 = mentions tradeoffs in passing\n<0.4 = presents the position as cost-free or ignores downsides`,
    precedent_citation: `Precedent Citation: ${val.toFixed(2)} (${band})\n\nDoes the claim cite relevant precedent, norms, or established practice?\n\nScoring: Rated 0–1 independently for Desire claims (Q-0 calibration r = 0.65). base_strength = average of all 3 Desire sub-scores.\n≥0.7 = cites specific precedents, case law, or established norms\n0.4–0.69 = references general precedent without specifics\n<0.4 = no precedent cited, purely aspirational`,
    mechanism_specificity: `Mechanism Specificity: ${val.toFixed(2)} (${band})\n\nHow specific is the proposed mechanism, action, or implementation path?\n\nScoring: Rated 0–1 independently for Intention claims (Q-0 calibration r = 0.71). base_strength = average of all 3 Intention sub-scores.\n≥0.7 = concrete steps, named actors, defined timelines\n0.4–0.69 = general approach without implementation detail\n<0.4 = vague aspiration with no actionable mechanism`,
    scope_bounding: `Scope Bounding: ${val.toFixed(2)} (${band})\n\nAre the boundaries, limitations, and applicability conditions defined?\n\nScoring: Rated 0–1 independently for Intention claims (Q-0 calibration r = 0.71). base_strength = average of all 3 Intention sub-scores.\n≥0.7 = explicitly defines where the proposal applies and where it doesn't\n0.4–0.69 = some boundaries mentioned but incomplete\n<0.4 = unbounded claim with no defined limits`,
    failure_mode_addressing: `Failure Mode Addressing: ${val.toFixed(2)} (${band})\n\nDoes the claim address what could go wrong or how failures would be handled?\n\nScoring: Rated 0–1 independently for Intention claims (Q-0 calibration r = 0.71). base_strength = average of all 3 Intention sub-scores.\n≥0.7 = explicitly names failure scenarios and mitigations\n0.4–0.69 = acknowledges risk without specific mitigation\n<0.4 = no consideration of failure modes`,
  };
  return base[key] || key;
}

function SubScoreRow({ node, onUpdateSubScore }: { node: ArgumentNetworkNode; onUpdateSubScore: (nodeId: string, key: string, value: number) => void }) {
  if (!node.bdi_sub_scores) return null;
  const isBelief = node.bdi_category === 'belief';

  return (
    <div className="inr-subscore-row">
      {Object.entries(node.bdi_sub_scores).filter(([, v]) => v != null).map(([key, val]) => {
        const v = val as number;
        const editable = isBelief && BELIEF_KEYS.has(key);

        if (!editable) {
          return (
            <ScoreBadge key={key} value={v} label={key} tooltip={subScoreTip(key, v)} />
          );
        }

        const accentColor = v >= 0.7 ? 'var(--success)' : v >= 0.4 ? 'var(--warning)' : 'var(--danger)';
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return (
          <span key={key} title={subScoreTip(key, v)} className="inr-subscore-item">
            <span className="inr-text-secondary">{label}:</span>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={v ?? 0}
              onChange={(e) => onUpdateSubScore(node.id, key, parseFloat(e.target.value))}
              // eslint-disable-next-line local/no-inline-style -- data-driven accentColor
              style={{ width: 48, height: 10, accentColor, cursor: 'pointer' }}
            />
            <span className="inr-subscore-val">{(v ?? 0).toFixed(2)}</span>
          </span>
        );
      })}
      <BookmarkLink docPath="docs/bdi-sub-score-calibration.md" size="xs" />
    </div>
  );
}

// SUB_SCORE_TIPS is re-exported here so callers that import from this module can also access it.
export { SUB_SCORE_TIPS, BELIEF_KEYS };

const ATTACK_TYPE_WEIGHTS: Record<string, number> = { rebut: 1.0, undercut: 1.05, undermine: 1.1 };

const STRENGTH_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  decisive:    { label: 'decisive',    color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 12%, transparent)' },
  substantial: { label: 'substantial', color: 'var(--text-secondary)', bg: 'var(--bg-hover)' },
  tangential:  { label: 'tangential',  color: 'var(--text-muted)', bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)' },
};

function deriveStrength(edge: { strength?: string; weight?: number }): string {
  if (edge.strength) return edge.strength;
  if (edge.weight == null) return 'substantial';
  if (edge.weight > 0.85) return 'decisive';
  if (edge.weight > 0.5) return 'substantial';
  return 'tangential';
}

function truncateText(t: string, n: number): string {
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** Strongest attacker of a node by contribution (source strength × weight × attack-type multiplier). */
function strongestAttacker(attacks: ArgumentNetworkEdge[], strengthMap: Map<string, number> | undefined, allNodes: ArgumentNetworkNode[]): { text: string; contribution: number } | null {
  let strongestAtk: { text: string; contribution: number } | null = null;
  for (const a of attacks) {
    const src = strengthMap?.get(a.source);
    if (src == null) continue;
    const w = a.weight ?? 0.5;
    const mult = ATTACK_TYPE_WEIGHTS[a.attack_type ?? 'rebut'] ?? 1.0;
    const contrib = src * w * mult;
    if (!strongestAtk || contrib > strongestAtk.contribution) {
      const srcNode = allNodes.find(n => n.id === a.source);
      strongestAtk = { text: srcNode ? truncateText(srcNode.text, 60) : a.source, contribution: contrib };
    }
  }
  return strongestAtk;
}

/** Strongest supporter of a node by contribution (source strength × weight). */
function strongestSupporter(supports: ArgumentNetworkEdge[], strengthMap: Map<string, number> | undefined, allNodes: ArgumentNetworkNode[]): { text: string; contribution: number } | null {
  let strongestSup: { text: string; contribution: number } | null = null;
  for (const s of supports) {
    const src = strengthMap?.get(s.source);
    if (src == null) continue;
    const w = s.weight ?? 0.5;
    const contrib = src * w;
    if (!strongestSup || contrib > strongestSup.contribution) {
      const srcNode = allNodes.find(n => n.id === s.source);
      strongestSup = { text: srcNode ? truncateText(srcNode.text, 60) : s.source, contribution: contrib };
    }
  }
  return strongestSup;
}

/** Col 1: Argument-network node id + originating statement id. */
function IdStatementCell({ node, statementId, searchQuery, onGotoEntry }: {
  node: ArgumentNetworkNode;
  statementId?: string;
  searchQuery?: string;
  onGotoEntry?: (entryId: string) => void;
}) {
  return (
    <span className="inr-flex-center-g2">
      <strong title={`Argument Network node ${node.id.replace('AN-', '')}${statementId ? `, extracted from debate statement ${statementId}` : ''}`} className="inr-accent"><Highlight text={node.id} query={searchQuery} /></strong>
      {statementId && (
        <span
          title={`Claim extracted from debate turn ${statementId} by ${speakerLabel(node.speaker)}${onGotoEntry ? ' — click to go to statement' : ''}`}
          onClick={onGotoEntry && node.source_entry_id ? (e) => { e.stopPropagation(); onGotoEntry(node.source_entry_id); } : undefined}
          // eslint-disable-next-line local/no-inline-style -- clickability-driven cursor/textDecoration
          style={{
            cursor: onGotoEntry && node.source_entry_id ? 'pointer' : 'default',
            textDecoration: onGotoEntry && node.source_entry_id ? 'underline' : 'none',
          }}
        >{statementId}</span>
      )}
    </span>
  );
}

/** Col 2: Speaker label with descriptive tooltip. */
function SpeakerCell({ node }: { node: ArgumentNetworkNode }) {
  const chatRedesign = useFlag('DEBATE_CHAT_REDESIGN');
  const label = chatRedesign ? resolveSpeaker(node.speaker).label : speakerLabel(node.speaker);
  const desc: Record<string, string> = {
    Accelerationist: 'Accelerationist — advocates rapid AI development',
    Safetyist: 'Safetyist — prioritizes AI safety and alignment',
    Skeptic: 'Skeptic — questions assumptions from all sides',
    Moderator: 'Moderator — neutral facilitator',
  };
  return <span title={desc[label] ?? label}>{label}</span>;
}

/** Col 3: BDI category badge. */
function BdiCategoryCell({ node }: { node: ArgumentNetworkNode }) {
  if (!node.bdi_category) return null;
  const bdiLabel = node.bdi_category === 'belief' ? 'Belief' : node.bdi_category === 'desire' ? 'Desire' : 'Intention';
  return <span title={`${bdiLabel} (confidence: ${node.bdi_confidence?.toFixed(2) ?? '?'})`}>{bdiLabel}</span>;
}

/** Col 4: Taxonomy attribution badge (attributed ref or unattributed reason). */
function TaxonomyAttributionCell({ node, nodeLabels }: { node: ArgumentNetworkNode; nodeLabels?: Map<string, string> }) {
  const attr = node.claim_taxonomy_attribution;
  if (!attr) return null;
  if (attr.unattributed_reason) {
    const reasonLabel = attr.unattributed_reason === 'novel_argument' ? 'novel' : 'no embedding';
    return (
      <span
        title={`Unattributed: ${attr.unattributed_reason === 'novel_argument' ? 'claim is a novel argument not closely matching any taxonomy Belief node (best similarity < 0.35)' : 'missing embedding — cannot compute similarity'}`}
        className="inr-attr-badge"
      ><span className="inr-attr-dot-danger">●</span>{reasonLabel}</span>
    );
  }
  const conf = attr.attribution_confidence;
  const confColor = conf >= 0.7 ? 'var(--success)' : conf >= 0.5 ? 'var(--text-muted)' : 'var(--warning)';
  const secCount = attr.secondary_refs?.length ?? 0;
  const primaryLabel = nodeLabels?.get(attr.primary_ref);
  const primaryTitle = primaryLabel ? `${primaryLabel} (${attr.primary_ref})` : attr.primary_ref;
  return (
    <span
      title={`Attributed to ${primaryTitle} (confidence: ${conf.toFixed(2)})${secCount > 0 ? `\n${secCount} secondary ref${secCount !== 1 ? 's' : ''}: ${attr.secondary_refs!.map(s => { const l = nodeLabels?.get(s.node_id); return `${l ? `${l} (${s.node_id})` : s.node_id} (${s.similarity.toFixed(2)})`; }).join(', ')}` : ''}`}
      className="inr-attr-badge"
    >
      {/* eslint-disable-next-line local/no-inline-style -- confidence-driven dot color */}
      <span style={{ color: confColor, fontSize: '0.9rem', marginRight: 3 }}>●</span>{attr.primary_ref} {conf.toFixed(2)}</span>
  );
}

/** Col 5: Strength score badge (computed vs base). */
function StrengthBadgeCell({ node, computedStrength }: { node: ArgumentNetworkNode; computedStrength?: number }) {
  const base = node.base_strength ?? 0.5;
  const computed = computedStrength ?? node.computed_strength ?? base;
  const delta = computed - base;
  return (
    <ScoreBadge
      value={computed}
      label="strength"
      tooltip={`Strength: ${computed.toFixed(2)} (base: ${base.toFixed(2)}, delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`}
    />
  );
}

/** Col 6: Attack/support edge count. */
function EdgeCountCell({ attacks, supports, hasChildren }: { attacks: ArgumentNetworkEdge[]; supports: ArgumentNetworkEdge[]; hasChildren: boolean }) {
  return (
    <span className="inr-edgecount" title={hasChildren ? `${attacks.length + supports.length} attack/support relationship${attacks.length + supports.length !== 1 ? 's' : ''} connected to this claim` : undefined}>
      {hasChildren ? `${attacks.length + supports.length} edge${attacks.length + supports.length !== 1 ? 's' : ''}` : ''}
    </span>
  );
}

/** NL strength explanation (B2) — rendered only when expanded with at least one edge. */
function StrengthExplanation({ node, attacks, supports, allNodes, strengthMap, computedStrength, expanded }: {
  node: ArgumentNetworkNode;
  attacks: ArgumentNetworkEdge[];
  supports: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  strengthMap?: Map<string, number>;
  computedStrength?: number;
  expanded: boolean;
}) {
  if (!expanded) return null;
  if (!(attacks.length > 0 || supports.length > 0)) return null;
  const base = node.base_strength ?? 0.5;
  const computed = computedStrength ?? node.computed_strength ?? base;
  const band = computed >= 0.8 ? 'accepted' : computed >= 0.5 ? 'moderate' : computed >= 0.3 ? 'weak' : 'rejected';
  const strongestAtk = strongestAttacker(attacks, strengthMap, allNodes);
  const strongestSup = strongestSupporter(supports, strengthMap, allNodes);
  // Build explanation
  let explanation = `${band} (${computed.toFixed(2)})`;
  if (strongestSup && strongestAtk) {
    explanation += ` because "${strongestSup.text}" (+${strongestSup.contribution.toFixed(2)}) even though "${strongestAtk.text}" (−${strongestAtk.contribution.toFixed(2)})`;
  } else if (strongestSup) {
    explanation += ` because "${strongestSup.text}" (+${strongestSup.contribution.toFixed(2)})`;
  } else if (strongestAtk) {
    explanation += ` despite "${strongestAtk.text}" (−${strongestAtk.contribution.toFixed(2)})`;
  }
  return (
    <div className="inr-explanation">
      {explanation}
    </div>
  );
}

/** Strength-band pill for an edge. */
function StrengthBandBadge({ edge }: { edge: { strength?: string; weight?: number } }) {
  const s = deriveStrength(edge);
  const st = STRENGTH_STYLES[s] ?? STRENGTH_STYLES.substantial;
  return (
    // eslint-disable-next-line local/no-inline-style -- strength-band-driven background/color
    <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
  );
}

/** Attack contribution figure with breakdown tooltip. */
function AttackContribution({ contribution, srcStr, edgeWeight, hasWeight, atkMult, attackType }: {
  contribution?: number;
  srcStr?: number;
  edgeWeight: number;
  hasWeight: boolean;
  atkMult: number;
  attackType?: string;
}) {
  if (contribution == null) return <span />;
  return (
    // eslint-disable-next-line local/no-inline-style -- weight-presence-driven opacity
    <span title={`Attack contribution = (source strength (${(srcStr ?? 0).toFixed(2)}) × edge weight (${edgeWeight.toFixed(1)}${hasWeight ? '' : ' — default, no AI weight'})) × attack type multiplier (${attackType}: ${atkMult.toFixed(1)}).\nRebut=1.0, Undercut=1.1 (denies inference), Undermine=1.2 (attacks premise).`} style={{ color: 'var(--danger)', cursor: 'default', opacity: hasWeight ? 1 : 0.5 }}>
      −{contribution.toFixed(2)} <span className="inr-text-muted">({(srcStr ?? 0).toFixed(2)}×{edgeWeight.toFixed(1)}{hasWeight ? '' : '?'}×{atkMult.toFixed(1)})</span>
    </span>
  );
}

/** Support contribution figure with breakdown tooltip. */
function SupportContribution({ contributionS, srcStrS, edgeWeightS, hasWeightS }: {
  contributionS?: number;
  srcStrS?: number;
  edgeWeightS: number;
  hasWeightS: boolean;
}) {
  if (contributionS == null) return <span />;
  return (
    // eslint-disable-next-line local/no-inline-style -- weight-presence-driven opacity
    <span title={`Support contribution = source strength (${(srcStrS ?? 0).toFixed(2)}) × edge weight (${edgeWeightS.toFixed(1)}${hasWeightS ? '' : ' — default, no AI weight'}). No type multiplier for supports — all support relationships are weighted equally.`} style={{ color: 'var(--success)', cursor: 'default', opacity: hasWeightS ? 1 : 0.5 }}>
      +{contributionS.toFixed(2)} <span className="inr-text-muted">({(srcStrS ?? 0).toFixed(2)}×{edgeWeightS.toFixed(1)}{hasWeightS ? '' : '?'})</span>
    </span>
  );
}

/** Inline "go to statement" button for an edge source, or an empty placeholder. */
function EdgeGotoButton({ onGotoEntry, sourceNode, stmtIdByEntry, className }: {
  onGotoEntry?: (entryId: string) => void;
  sourceNode?: ArgumentNetworkNode;
  stmtIdByEntry?: Map<string, string>;
  className: string;
}) {
  if (!(onGotoEntry && sourceNode?.source_entry_id)) return <span />;
  return (
    <button
      onClick={(ev) => { ev.stopPropagation(); onGotoEntry(sourceNode.source_entry_id); }}
      title={`Go to ${stmtIdByEntry?.get(sourceNode.source_entry_id) || sourceNode.source_entry_id}`}
      className={className}
    >{stmtIdByEntry?.get(sourceNode.source_entry_id) || 'goto'}</button>
  );
}

/** Expanded debater block for an edge source (speaker, goto, source text). */
function DebaterBlock({ expanded, sourceNode, onGotoEntry, stmtIdByEntry, searchQuery, gotoClassName }: {
  expanded: boolean;
  sourceNode?: ArgumentNetworkNode;
  onGotoEntry?: (entryId: string) => void;
  stmtIdByEntry?: Map<string, string>;
  searchQuery?: string;
  gotoClassName: string;
}) {
  const chatRedesign = useFlag('DEBATE_CHAT_REDESIGN');
  if (!(expanded && sourceNode)) return null;
  return (
    <div className="inr-debater-block">
      <span className="inr-text-muted">Debater:</span> <strong>{chatRedesign ? resolveSpeaker(sourceNode.speaker).label : speakerLabel(sourceNode.speaker)}</strong>
      {onGotoEntry && sourceNode.source_entry_id && (
        <button
          onClick={() => onGotoEntry(sourceNode.source_entry_id)}
          title={`Go to ${stmtIdByEntry?.get(sourceNode.source_entry_id) || sourceNode.source_entry_id}`}
          className={gotoClassName}
        >{stmtIdByEntry?.get(sourceNode.source_entry_id) || 'goto'}</button>
      )}
      <div className="inr-mt2"><Highlight text={sourceNode.text} query={searchQuery} /></div>
    </div>
  );
}

/** A single attack edge row. */
function AttackEdgeRow({ a, allNodes, strengthMap, onGotoEntry, stmtIdByEntry, expanded, searchQuery }: {
  a: ArgumentNetworkEdge;
  allNodes: ArgumentNetworkNode[];
  strengthMap?: Map<string, number>;
  onGotoEntry?: (entryId: string) => void;
  stmtIdByEntry?: Map<string, string>;
  expanded: boolean;
  searchQuery?: string;
}) {
  const sourceNode = allNodes.find(n => n.id === a.source);
  const srcStr = strengthMap?.get(a.source);
  const atkMult = ATTACK_TYPE_WEIGHTS[a.attack_type ?? 'rebut'] ?? 1.0;
  const hasWeight = a.weight != null;
  const edgeWeight = a.weight ?? 0.5;
  const contribution = srcStr != null ? srcStr * edgeWeight * atkMult : undefined;
  return (
    <div className="inr-atk-edge">
      <div className="diag-edge-row inr-edge-grid">
        <span className="inr-ca-node">CA-node</span>
        <span>← {a.source}</span>
        <strong>{a.attack_type}</strong>
        <StrengthBandBadge edge={a} />
        <span className="inr-text-muted">{a.scheme ? `via ${a.scheme}` : ''}</span>
        <AttackContribution contribution={contribution} srcStr={srcStr} edgeWeight={edgeWeight} hasWeight={hasWeight} atkMult={atkMult} attackType={a.attack_type} />
        <EdgeGotoButton onGotoEntry={onGotoEntry} sourceNode={sourceNode} stmtIdByEntry={stmtIdByEntry} className="inr-goto-btn-danger" />
      </div>
      {a.warrant && <div className="inr-warrant">Warrant: <Highlight text={a.warrant} query={searchQuery} /></div>}
      <DebaterBlock expanded={expanded} sourceNode={sourceNode} onGotoEntry={onGotoEntry} stmtIdByEntry={stmtIdByEntry} searchQuery={searchQuery} gotoClassName="inr-goto-btn-acc" />
    </div>
  );
}

/** A single support edge row. */
function SupportEdgeRow({ s, allNodes, strengthMap, onGotoEntry, stmtIdByEntry, expanded, searchQuery }: {
  s: ArgumentNetworkEdge;
  allNodes: ArgumentNetworkNode[];
  strengthMap?: Map<string, number>;
  onGotoEntry?: (entryId: string) => void;
  stmtIdByEntry?: Map<string, string>;
  expanded: boolean;
  searchQuery?: string;
}) {
  const sourceNode = allNodes.find(n => n.id === s.source);
  const srcStrS = strengthMap?.get(s.source);
  const hasWeightS = s.weight != null;
  const edgeWeightS = s.weight ?? 0.5;
  const contributionS = srcStrS != null ? srcStrS * edgeWeightS : undefined;
  return (
    <div className="inr-sup-edge">
      <div className="diag-edge-row inr-edge-grid">
        <span className="inr-ra-node">RA-node</span>
        <span>← {s.source}</span>
        <strong>supports</strong>
        <StrengthBandBadge edge={s} />
        <span className="inr-text-muted">{s.scheme ? `via ${s.scheme}` : ''}</span>
        <SupportContribution contributionS={contributionS} srcStrS={srcStrS} edgeWeightS={edgeWeightS} hasWeightS={hasWeightS} />
        <EdgeGotoButton onGotoEntry={onGotoEntry} sourceNode={sourceNode} stmtIdByEntry={stmtIdByEntry} className="inr-goto-btn-success" />
      </div>
      {s.warrant && <div className="inr-warrant">Warrant: {s.warrant}</div>}
      <DebaterBlock expanded={expanded} sourceNode={sourceNode} onGotoEntry={onGotoEntry} stmtIdByEntry={stmtIdByEntry} searchQuery={searchQuery} gotoClassName="inr-goto-btn-success-ml" />
    </div>
  );
}

/** Leave-one-out QBAF attribution list. */
function LooAttribution({ attribution }: { attribution: ReturnType<typeof explainNodeStrength> | null }) {
  if (!attribution || attribution.attributions.length === 0) return null;
  return (
    <div className="inr-loo-container">
      <div className="inr-loo-heading">QBAF Attribution (leave-one-out)</div>
      <div className="inr-loo-summary">{attribution.summary}</div>
      {attribution.attributions.slice(0, 6).map((a, i) => (
        <div key={i} className="inr-loo-row">
          {/* eslint-disable-next-line local/no-inline-style -- influence-sign-driven color */}
          <span style={{ color: a.influence >= 0 ? 'var(--success)' : 'var(--danger)', textAlign: 'right' }}>
            {a.influence >= 0 ? '+' : ''}{a.influence.toFixed(3)}
          </span>
          {/* eslint-disable-next-line local/no-inline-style -- edge-type-driven color */}
          <span style={{ color: a.edgeType === 'attacks' ? 'var(--danger)' : 'var(--success)' }}>
            {a.edgeType}{a.attackType ? ` (${a.attackType})` : ''}
          </span>
          <span className="inr-text-muted">from {a.sourceId}</span>
          <span className="inr-text-muted-italic">{a.scheme ? `via ${a.scheme}` : ''}</span>
        </div>
      ))}
      {attribution.attributions.length > 6 && (
        <div className="inr-loo-more">...and {attribution.attributions.length - 6} more</div>
      )}
    </div>
  );
}

/** Expandable I-node row — collapsed by default showing ID, speaker, strength. Expand reveals claim text, edges, sub-scores. */
export function INodeRow({ node, attacks, supports, allNodes, allEdges, isSource, computedStrength, statementId, strengthMap, onGotoEntry, stmtIdByEntry, focused, onUpdateSubScore, searchQuery, nodeLabels, defaultExpanded = false }: {
  node: ArgumentNetworkNode;
  attacks: ArgumentNetworkEdge[];
  supports: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  allEdges?: ArgumentNetworkEdge[];
  isSource: boolean;
  computedStrength?: number;
  statementId?: string;
  strengthMap?: Map<string, number>;
  onGotoEntry?: (entryId: string) => void;
  stmtIdByEntry?: Map<string, string>;
  focused?: boolean;
  onUpdateSubScore: (nodeId: string, key: string, value: number) => void;
  /** Optional search query for highlighting matched text. */
  searchQuery?: string;
  /** Optional taxonomy node-id → human-readable label map, used to lead attribution tooltips with the node's title. */
  nodeLabels?: Map<string, string>;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { setExpanded(defaultExpanded); }, [defaultExpanded]);
  const responded = attacks.length > 0 || supports.length > 0;
  const hasChildren = attacks.length > 0 || supports.length > 0;
  // isSource is kept in the signature for API compatibility — future callers may use it.
  void responded;
  void isSource;
  const rowRef = useRef<HTMLDivElement>(null);
  const attribution = useMemo(() => {
    if (!expanded || !allEdges || allEdges.length === 0) return null;
    return explainNodeStrength(allNodes, allEdges, node.id);
  }, [expanded, allEdges, allNodes, node.id]);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);

  return (
    <div
      ref={rowRef}
      // eslint-disable-next-line local/no-inline-style -- focus-driven outline/borderRadius
      style={{ margin: '6px 0', paddingBottom: 6, borderBottom: '1px solid var(--border)', outline: focused ? '2px solid var(--warning)' : 'none', borderRadius: focused ? 4 : 0, fontSize: '0.85rem' }}
    >
      <div className="inr-header-row">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inr-expand-btn"
        >
          {expanded ? '▼' : '▶'}
        </button>
        <div className="diag-claim-row inr-claim-grid">
          {/* Col 1: AN ID + Statement ID */}
          <IdStatementCell node={node} statementId={statementId} searchQuery={searchQuery} onGotoEntry={onGotoEntry} />
          {/* Col 2: Speaker */}
          <SpeakerCell node={node} />
          {/* Col 3: BDI category + status */}
          <span>
            <BdiCategoryCell node={node} />
          </span>
          {/* Col 4: Taxonomy attribution badge */}
          <span>
            <TaxonomyAttributionCell node={node} nodeLabels={nodeLabels} />
          </span>
          {/* Col 5: Strength badge */}
          <StrengthBadgeCell node={node} computedStrength={computedStrength} />
          {/* Col 6: Edge count */}
          <EdgeCountCell attacks={attacks} supports={supports} hasChildren={hasChildren} />
        </div>
      </div>
      <div className="inr-claim-text"><Highlight text={node.text} query={searchQuery} /></div>
      {expanded && node.attribution_text_genus && <div className="claim-attribution-text inr-pl18"><span className="claim-attribution-label">Attribution:</span>{node.attribution_text_genus}</div>}
      {/* NL strength explanation (B2) */}
      <StrengthExplanation node={node} attacks={attacks} supports={supports} allNodes={allNodes} strengthMap={strengthMap} computedStrength={computedStrength} expanded={expanded} />
      {expanded && node.bdi_sub_scores && <SubScoreRow node={node} onUpdateSubScore={onUpdateSubScore} />}

      {/* Edges — shown when expanded */}
      {hasChildren && expanded && (
        <div className="inr-edges-container">
          {attacks.map(a => (
            <AttackEdgeRow key={a.id} a={a} allNodes={allNodes} strengthMap={strengthMap} onGotoEntry={onGotoEntry} stmtIdByEntry={stmtIdByEntry} expanded={expanded} searchQuery={searchQuery} />
          ))}
          {supports.map(s => (
            <SupportEdgeRow key={s.id} s={s} allNodes={allNodes} strengthMap={strengthMap} onGotoEntry={onGotoEntry} stmtIdByEntry={stmtIdByEntry} expanded={expanded} searchQuery={searchQuery} />
          ))}
          {/* Leave-one-out QBAF attribution */}
          <LooAttribution attribution={attribution} />
        </div>
      )}
    </div>
  );
}

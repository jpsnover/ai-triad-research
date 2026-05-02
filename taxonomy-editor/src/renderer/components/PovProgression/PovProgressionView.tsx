// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * POV Progression view — timeline showing how each POV's taxonomy context
 * and citations evolve as the debate progresses, with an AN substrate lane
 * showing what claims debaters are responding to.
 *
 * Layout: scrubber + mini-map (compact change ribbon) + selected-turn detail.
 */

import { useEffect, useMemo, useState } from 'react';
import type { DebateSession, TranscriptEntry, ArgumentNetworkNode, ArgumentNetworkEdge, PoverId } from '../../types/debate';
import { POVER_INFO } from '../../types/debate';
import { AI_POVERS } from '@lib/debate/types';

// ── Local view types ──────────────────────────────────────

type Pover = Exclude<PoverId, 'user'>;
const POVS = AI_POVERS;

type Mode = 'snapshot' | 'diff' | 'since-opening';

interface InjectionManifest {
  povNodeIds?: string[];
  povPrimaryIds?: string[];
  situationNodeIds?: string[];
}

interface PovTurnState {
  pov: Pover;
  entry: TranscriptEntry | null;
  contextIds: Set<string>;
  primaryIds: Set<string>;
  citedIds: Set<string>;
}

interface AnTargeting {
  fromEntryId: string;
  fromSpeaker: Pover | 'system' | 'document';
  targetNodeId: string;
  targetSpeaker: Pover | 'system' | 'document';
  edgeType: ArgumentNetworkEdge['type'];
  attackType?: ArgumentNetworkEdge['attack_type'];
}

interface TurnSnapshot {
  turnIndex: number;
  label: string;
  byPov: Record<Pover, PovTurnState>;
  anIntroduced: ArgumentNetworkNode[];
  anTargeted: AnTargeting[];
}

interface TurnDiff {
  contextAdded: string[];
  contextDropped: string[];
  citationsAdded: string[];
  citationsDropped: string[];
  contextChange: number;
  citationChange: number;
}

// ── Helpers ──────────────────────────────────────────────

function manifestOf(entry: TranscriptEntry | null): InjectionManifest {
  if (!entry) return {};
  const meta = entry.metadata as Record<string, unknown> | undefined;
  return (meta?.injection_manifest as InjectionManifest | undefined) ?? {};
}

function emptyPovState(pov: Pover): PovTurnState {
  return {
    pov, entry: null,
    contextIds: new Set(), primaryIds: new Set(), citedIds: new Set(),
  };
}

function buildPovState(pov: Pover, entry: TranscriptEntry | null): PovTurnState {
  if (!entry) return emptyPovState(pov);
  const m = manifestOf(entry);
  const ctx = new Set<string>();
  for (const id of m.povNodeIds ?? []) ctx.add(id);
  for (const id of m.situationNodeIds ?? []) ctx.add(id);
  const cited = new Set(entry.taxonomy_refs.map(r => r.node_id));
  return {
    pov, entry,
    contextIds: ctx,
    primaryIds: new Set(m.povPrimaryIds ?? []),
    citedIds: cited,
  };
}

function diffOf(prev: PovTurnState, curr: PovTurnState): TurnDiff {
  const contextAdded: string[] = [];
  const contextDropped: string[] = [];
  for (const id of curr.contextIds) if (!prev.contextIds.has(id)) contextAdded.push(id);
  for (const id of prev.contextIds) if (!curr.contextIds.has(id)) contextDropped.push(id);
  const citationsAdded: string[] = [];
  const citationsDropped: string[] = [];
  for (const id of curr.citedIds) if (!prev.citedIds.has(id)) citationsAdded.push(id);
  for (const id of prev.citedIds) if (!curr.citedIds.has(id)) citationsDropped.push(id);
  return {
    contextAdded, contextDropped, citationsAdded, citationsDropped,
    contextChange: contextAdded.length + contextDropped.length,
    citationChange: citationsAdded.length + citationsDropped.length,
  };
}

/**
 * Group the transcript into turns. Turn 0 = all openings; each subsequent
 * cross-respond round = one turn (entries with the same round number);
 * synthesis = its own turn at the end.
 */
function buildTimeline(session: DebateSession): TurnSnapshot[] {
  const transcript = session.transcript ?? [];
  const an = session.argument_network;
  const anNodes = an?.nodes ?? [];
  const anEdges = an?.edges ?? [];

  // Index AN nodes by source_entry_id and id
  const anByEntry = new Map<string, ArgumentNetworkNode[]>();
  const anById = new Map<string, ArgumentNetworkNode>();
  for (const n of anNodes) {
    anById.set(n.id, n);
    const list = anByEntry.get(n.source_entry_id) ?? [];
    list.push(n);
    anByEntry.set(n.source_entry_id, list);
  }
  // Index edges by source-node entry id (i.e. the entry whose extraction created this edge)
  const edgesByEntry = new Map<string, ArgumentNetworkEdge[]>();
  for (const e of anEdges) {
    const srcNode = anById.get(e.source);
    if (!srcNode) continue;
    const list = edgesByEntry.get(srcNode.source_entry_id) ?? [];
    list.push(e);
    edgesByEntry.set(srcNode.source_entry_id, list);
  }

  const turns: TurnSnapshot[] = [];

  // Turn 0: openings
  const openings = transcript.filter(e => e.type === 'opening');
  if (openings.length > 0) {
    turns.push(makeTurn(0, 'Opening', openings, anByEntry, edgesByEntry, anById));
  }

  // Cross-respond rounds — group by metadata.round if present, else by speaker triplets
  const debateEntries = transcript.filter(
    e => e.type === 'statement' || e.type === 'question' || e.type === 'probing',
  );
  const byRound = new Map<number, TranscriptEntry[]>();
  for (const e of debateEntries) {
    const meta = e.metadata as Record<string, unknown> | undefined;
    const round = (meta?.round as number | undefined) ?? -1;
    const list = byRound.get(round) ?? [];
    list.push(e);
    byRound.set(round, list);
  }
  const sortedRounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  for (const r of sortedRounds) {
    const entries = byRound.get(r)!;
    const label = r >= 0 ? `Round ${r}` : 'Debate';
    turns.push(makeTurn(turns.length, label, entries, anByEntry, edgesByEntry, anById));
  }

  // Synthesis
  const synthesis = transcript.find(e => e.type === 'synthesis');
  if (synthesis) {
    turns.push(makeTurn(turns.length, 'Synthesis', [synthesis], anByEntry, edgesByEntry, anById));
  }

  return turns;
}

function makeTurn(
  turnIndex: number,
  label: string,
  entries: TranscriptEntry[],
  anByEntry: Map<string, ArgumentNetworkNode[]>,
  edgesByEntry: Map<string, ArgumentNetworkEdge[]>,
  anById: Map<string, ArgumentNetworkNode>,
): TurnSnapshot {
  const byPov: Record<Pover, PovTurnState> = {
    prometheus: emptyPovState('prometheus'),
    sentinel: emptyPovState('sentinel'),
    cassandra: emptyPovState('cassandra'),
  };
  for (const entry of entries) {
    const sp = entry.speaker;
    if (sp === 'prometheus' || sp === 'sentinel' || sp === 'cassandra') {
      byPov[sp] = buildPovState(sp, entry);
    }
  }
  const anIntroduced: ArgumentNetworkNode[] = [];
  const anTargeted: AnTargeting[] = [];
  for (const entry of entries) {
    const introduced = anByEntry.get(entry.id) ?? [];
    anIntroduced.push(...introduced);
    const edges = edgesByEntry.get(entry.id) ?? [];
    for (const e of edges) {
      const target = anById.get(e.target);
      if (!target) continue;
      anTargeted.push({
        fromEntryId: entry.id,
        fromSpeaker: entry.speaker as Pover,
        targetNodeId: e.target,
        targetSpeaker: target.speaker as Pover,
        edgeType: e.type,
        attackType: e.attack_type,
      });
    }
  }
  return { turnIndex, label, byPov, anIntroduced, anTargeted };
}

// ── BDI palette ──────────────────────────────────────────

function bdiOf(nodeId: string): 'B' | 'D' | 'I' | '?' {
  // POV node ids: {pov}-{B|D|I}-{NNN}
  const m = /^(?:acc|saf|skp|cc)-([BDI])-/.exec(nodeId);
  if (m) return m[1] as 'B' | 'D' | 'I';
  if (nodeId.startsWith('sit-')) return '?';
  return '?';
}

const BDI_COLORS: Record<'B' | 'D' | 'I' | '?', { bg: string; fg: string; tag: string }> = {
  B: { bg: 'rgba(59,130,246,0.15)',  fg: '#3b82f6', tag: 'B' },
  D: { bg: 'rgba(34,197,94,0.15)',   fg: '#16a34a', tag: 'D' },
  I: { bg: 'rgba(245,158,11,0.18)',  fg: '#b45309', tag: 'I' },
  '?': { bg: 'rgba(148,163,184,0.18)', fg: '#475569', tag: 'S' },
};

// ── Components ───────────────────────────────────────────

interface NodeChipProps {
  id: string;
  label?: string;
  primary?: boolean;
  diff?: 'added' | 'dropped' | 'newly-cited' | 'dropped-cited' | 'unchanged';
  cited?: boolean;
  pinned?: boolean;
  onClick?: () => void;
}

function NodeChip({ id, label, primary, diff, cited, pinned, onClick }: NodeChipProps) {
  const bdi = bdiOf(id);
  const palette = BDI_COLORS[bdi];

  // Diff-based borders
  let border = '1px solid transparent';
  let textDecoration: string | undefined;
  let opacity = 1;
  if (diff === 'added' || diff === 'newly-cited') border = '1px solid #16a34a';
  if (diff === 'dropped' || diff === 'dropped-cited') {
    border = '1px solid #dc2626';
    textDecoration = 'line-through';
    opacity = 0.7;
  }
  if (pinned) border = '2px solid #8b5cf6';

  const star = primary ? '★ ' : '';
  const prefix = diff === 'added' ? '+ ' : diff === 'dropped' ? '− ' :
                 diff === 'newly-cited' ? '✓ ' : diff === 'dropped-cited' ? '✗ ' : '';

  return (
    <span
      onClick={onClick}
      title={`${id}${label ? ' — ' + label : ''}${primary ? ' (primary)' : ''}${cited ? ' [cited]' : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: palette.bg, color: palette.fg,
        padding: '2px 6px', borderRadius: 4,
        fontSize: '0.68rem',
        fontWeight: cited ? 700 : 500,
        margin: 2, cursor: onClick ? 'pointer' : 'default',
        border, textDecoration, opacity,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        fontSize: '0.55rem', marginRight: 4,
        background: 'rgba(0,0,0,0.12)', padding: '0 3px', borderRadius: 2,
      }}>{palette.tag}</span>
      {prefix}{star}{id}
      {label && <span style={{ marginLeft: 4, opacity: 0.75, fontWeight: 400 }}>{truncate(label, 30)}</span>}
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── PovLane ──────────────────────────────────────────────

interface PovLaneProps {
  pov: Pover;
  curr: PovTurnState;
  prev: PovTurnState | null;
  mode: Mode;
  pinnedNodes: Set<string>;
  togglePin: (id: string) => void;
  nodeLabels: Map<string, string>;
}

function PovLane({ pov, curr, prev, mode, pinnedNodes, togglePin, nodeLabels }: PovLaneProps) {
  const info = POVER_INFO[pov];

  // What to display for context
  const ctxItems = useMemo(() => {
    if (mode === 'snapshot' || !prev) {
      return [...curr.contextIds].map(id => ({
        id, diff: 'unchanged' as const, primary: curr.primaryIds.has(id), cited: curr.citedIds.has(id),
      }));
    }
    const items: Array<{ id: string; diff: NodeChipProps['diff']; primary: boolean; cited: boolean }> = [];
    for (const id of curr.contextIds) {
      const wasIn = prev.contextIds.has(id);
      items.push({
        id,
        diff: wasIn ? 'unchanged' : 'added',
        primary: curr.primaryIds.has(id),
        cited: curr.citedIds.has(id),
      });
    }
    for (const id of prev.contextIds) {
      if (!curr.contextIds.has(id)) {
        items.push({ id, diff: 'dropped', primary: false, cited: false });
      }
    }
    return items;
  }, [curr, prev, mode]);

  // Citations
  const citeItems = useMemo(() => {
    if (mode === 'snapshot' || !prev) {
      return [...curr.citedIds].map(id => ({ id, diff: 'unchanged' as const }));
    }
    const items: Array<{ id: string; diff: NodeChipProps['diff'] }> = [];
    for (const id of curr.citedIds) {
      items.push({ id, diff: prev.citedIds.has(id) ? 'unchanged' : 'newly-cited' });
    }
    for (const id of prev.citedIds) {
      if (!curr.citedIds.has(id)) items.push({ id, diff: 'dropped-cited' });
    }
    return items;
  }, [curr, prev, mode]);

  // Sort: primary first, then by diff status (added/changed first)
  const sortedCtx = [...ctxItems].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    const diffOrder = { 'added': 0, 'newly-cited': 0, 'dropped': 1, 'dropped-cited': 1, 'unchanged': 2 };
    return (diffOrder[a.diff ?? 'unchanged']) - (diffOrder[b.diff ?? 'unchanged']);
  });

  const supportingCount = sortedCtx.filter(i => !i.primary && i.diff === 'unchanged').length;
  const showAll = supportingCount <= 8;
  const visibleCtx = showAll ? sortedCtx : sortedCtx.filter(i => i.primary || i.diff !== 'unchanged');

  return (
    <div style={{
      borderLeft: `3px solid ${info.color}`,
      padding: '8px 10px', marginBottom: 10,
      background: 'var(--bg-subtle)', borderRadius: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <strong style={{ color: info.color }}>{info.label}</strong>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          ({info.pov}) — context: {curr.contextIds.size} • cited: {curr.citedIds.size}
        </span>
        {!curr.entry && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>— did not speak this turn</span>
        )}
      </div>

      {curr.entry && (
        <>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
            Context {mode === 'diff' && prev ? '(diff vs prior turn)' : ''}
          </div>
          <div style={{ marginBottom: 8 }}>
            {visibleCtx.map(item => (
              <NodeChip
                key={`ctx-${item.id}-${item.diff}`}
                id={item.id}
                label={nodeLabels.get(item.id)}
                primary={item.primary}
                diff={item.diff}
                cited={item.cited}
                pinned={pinnedNodes.has(item.id)}
                onClick={() => togglePin(item.id)}
              />
            ))}
            {!showAll && (
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                +{supportingCount} unchanged supporting nodes hidden
              </span>
            )}
          </div>

          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
            Citations in this turn
          </div>
          <div>
            {citeItems.length === 0 && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>none</span>
            )}
            {citeItems.map(item => (
              <NodeChip
                key={`cite-${item.id}-${item.diff}`}
                id={item.id}
                label={nodeLabels.get(item.id)}
                diff={item.diff}
                cited
                pinned={pinnedNodes.has(item.id)}
                onClick={() => togglePin(item.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── AN substrate lane ────────────────────────────────────

const VERIFICATION_OUTLINE: Record<string, string> = {
  verified: '#16a34a',
  disputed: '#dc2626',
  unverifiable: '#b45309',
  pending: '#94a3b8',
};

function AnSubstrateLane({ snapshot }: { snapshot: TurnSnapshot }) {
  const introduced = snapshot.anIntroduced;
  const targeted = snapshot.anTargeted;

  if (introduced.length === 0 && targeted.length === 0) {
    return (
      <div style={{
        padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 4,
        fontSize: '0.7rem', color: 'var(--text-muted)',
      }}>
        AN substrate: no new claims or response edges this turn.
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 4 }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        AN claims introduced this turn
      </div>
      <div style={{ marginBottom: 8 }}>
        {introduced.length === 0 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>none</span>
        )}
        {introduced.map(n => {
          const speakerInfo = (n.speaker === 'prometheus' || n.speaker === 'sentinel' || n.speaker === 'cassandra')
            ? POVER_INFO[n.speaker] : null;
          const color = speakerInfo?.color ?? 'var(--text-muted)';
          const outline = VERIFICATION_OUTLINE[n.verification_status ?? 'pending'];
          const strength = n.base_strength ?? 0.5;
          const size = 8 + Math.round(strength * 10);
          return (
            <span
              key={n.id}
              title={`${n.id}\n${n.text}\nspeaker: ${n.speaker}\nstrength: ${strength.toFixed(2)}\nverification: ${n.verification_status ?? 'pending'}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                margin: 3, padding: '3px 7px', borderRadius: 12,
                fontSize: '0.66rem',
                background: 'rgba(255,255,255,0.04)',
                border: `2px solid ${outline}`,
              }}
            >
              <span style={{
                width: size, height: size, borderRadius: '50%', background: color,
                display: 'inline-block', flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text-muted)' }}>{n.id}</span>
              <span style={{ opacity: 0.85 }}>{truncate(n.text, 60)}</span>
              {n.bdi_category && (
                <span style={{
                  fontSize: '0.55rem', padding: '0 3px', borderRadius: 2,
                  background: 'rgba(0,0,0,0.15)',
                }}>{n.bdi_category[0].toUpperCase()}</span>
              )}
            </span>
          );
        })}
      </div>

      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
        Response edges (who responded to what)
      </div>
      {targeted.length === 0 && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>none</span>
      )}
      <table style={{ fontSize: '0.68rem', borderCollapse: 'collapse' }}>
        <tbody>
          {targeted.map((t, i) => {
            const fromInfo = (t.fromSpeaker === 'prometheus' || t.fromSpeaker === 'sentinel' || t.fromSpeaker === 'cassandra')
              ? POVER_INFO[t.fromSpeaker] : null;
            const toInfo = (t.targetSpeaker === 'prometheus' || t.targetSpeaker === 'sentinel' || t.targetSpeaker === 'cassandra')
              ? POVER_INFO[t.targetSpeaker] : null;
            const isAttack = t.edgeType === 'attacks';
            return (
              <tr key={i}>
                <td style={{ color: fromInfo?.color, fontWeight: 600, padding: '1px 6px' }}>{fromInfo?.label ?? t.fromSpeaker}</td>
                <td style={{ padding: '1px 6px', color: isAttack ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                  {isAttack ? `⚔ ${t.attackType ?? 'attack'}` : '⊕ supports'}
                </td>
                <td style={{ color: toInfo?.color, padding: '1px 6px' }}>{toInfo?.label ?? t.targetSpeaker}'s</td>
                <td style={{ color: 'var(--text-muted)', padding: '1px 6px' }}>{t.targetNodeId}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Mini-map ─────────────────────────────────────────────

interface MiniMapProps {
  turns: TurnSnapshot[];
  selectedTurn: number;
  setSelectedTurn: (i: number) => void;
  pinnedNodes: Set<string>;
}

function MiniMap({ turns, selectedTurn, setSelectedTurn, pinnedNodes }: MiniMapProps) {
  // Compute change magnitude per turn per POV
  const rows = useMemo(() => {
    return POVS.map(pov => {
      const cells = turns.map((turn, i) => {
        if (i === 0) {
          return {
            ctx: turn.byPov[pov].contextIds.size,
            cite: turn.byPov[pov].citedIds.size,
          };
        }
        const d = diffOf(turns[i - 1].byPov[pov], turn.byPov[pov]);
        return { ctx: d.contextChange, cite: d.citationChange };
      });
      const max = Math.max(1, ...cells.flatMap(c => [c.ctx, c.cite]));
      return { pov, cells, max };
    });
  }, [turns]);

  // Pinned-node presence track
  const pinnedTrack = useMemo(() => {
    return [...pinnedNodes].slice(0, 5).map(nodeId => {
      const presence = turns.map(turn => {
        const states = POVS.map(p => turn.byPov[p]);
        const inContext = states.some(s => s.contextIds.has(nodeId));
        const cited = states.some(s => s.citedIds.has(nodeId));
        return { inContext, cited };
      });
      return { nodeId, presence };
    });
  }, [turns, pinnedNodes]);

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      padding: '8px 10px', marginBottom: 8,
    }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
        Change magnitude per turn (click to select)
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ width: 80, fontSize: '0.65rem', textAlign: 'right', paddingRight: 6 }}></th>
            {turns.map(t => (
              <th
                key={t.turnIndex}
                onClick={() => setSelectedTurn(t.turnIndex)}
                style={{
                  fontSize: '0.62rem', textAlign: 'center', padding: '2px 1px',
                  cursor: 'pointer',
                  background: t.turnIndex === selectedTurn ? 'rgba(139,92,246,0.2)' : 'transparent',
                  borderRadius: 3,
                }}
              >{t.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pov, cells, max }) => {
            const info = POVER_INFO[pov];
            return (
              <tr key={pov}>
                <td style={{ fontSize: '0.65rem', textAlign: 'right', paddingRight: 6, color: info.color, fontWeight: 600 }}>
                  {info.label}
                </td>
                {cells.map((c, i) => {
                  const ctxH = Math.round((c.ctx / max) * 18);
                  const citeH = Math.round((c.cite / max) * 18);
                  const sel = i === selectedTurn;
                  return (
                    <td
                      key={i}
                      onClick={() => setSelectedTurn(i)}
                      title={`${turns[i].label}\ncontext Δ: ${c.ctx}\ncitation Δ: ${c.cite}`}
                      style={{
                        cursor: 'pointer', padding: 1,
                        background: sel ? 'rgba(139,92,246,0.12)' : 'transparent',
                      }}
                    >
                      <div style={{
                        display: 'flex', alignItems: 'flex-end',
                        height: 22, gap: 1, justifyContent: 'center',
                      }}>
                        <div style={{
                          width: 6, height: ctxH, background: info.color, opacity: 0.6, borderRadius: 1,
                        }} />
                        <div style={{
                          width: 6, height: citeH, background: info.color, borderRadius: 1,
                          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 3px)',
                        }} />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {pinnedTrack.length > 0 && (
        <>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, marginTop: 8, color: 'var(--text-muted)' }}>
            Pinned nodes — presence across turns (line = in context, dot = cited)
          </div>
          {pinnedTrack.map(({ nodeId, presence }) => (
            <div key={nodeId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ width: 80, fontSize: '0.62rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                {nodeId}
              </span>
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 0 }}>
                {presence.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedTurn(i)}
                    style={{
                      flex: 1, height: 8, position: 'relative', cursor: 'pointer',
                      background: i === selectedTurn ? 'rgba(139,92,246,0.12)' : 'transparent',
                    }}
                  >
                    {p.inContext && (
                      <div style={{
                        position: 'absolute', top: 3, left: 0, right: 0, height: 2,
                        background: '#94a3b8',
                      }} />
                    )}
                    {p.cited && (
                      <div style={{
                        position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)',
                        width: 6, height: 6, borderRadius: '50%', background: '#8b5cf6',
                      }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────

interface PovProgressionViewProps {
  session: DebateSession | null;
  nodeLabels: Map<string, string>;
}

export function PovProgressionView({ session, nodeLabels }: PovProgressionViewProps) {
  const [selectedTurn, setSelectedTurn] = useState(0);
  const [mode, setMode] = useState<Mode>('diff');
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());

  const turns = useMemo(() => session ? buildTimeline(session) : [], [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in an input/textarea/contenteditable
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') {
        setSelectedTurn(i => Math.max(0, Math.min(i, turns.length - 1) - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        setSelectedTurn(i => Math.min(turns.length - 1, Math.min(i, turns.length - 1) + 1));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turns.length]);

  if (!session) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        No active debate. Open a debate in the main window to populate this view.
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Debate has no turns yet. Once openings begin, the timeline will populate.
      </div>
    );
  }

  const safeSelected = Math.min(selectedTurn, turns.length - 1);
  const curr = turns[safeSelected];
  const prevForDiff: TurnSnapshot | null =
    mode === 'snapshot' ? null :
    mode === 'since-opening' ? (turns[0] !== curr ? turns[0] : null) :
    safeSelected > 0 ? turns[safeSelected - 1] : null;

  const togglePin = (id: string) => {
    setPinnedNodes(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header / scrubber */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>POV Progression</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {session.title} — {turns.length} turn{turns.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {(['diff', 'snapshot', 'since-opening'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="btn btn-sm"
              style={{
                fontSize: '0.65rem',
                background: mode === m ? 'var(--accent-color, #3b82f6)' : 'var(--bg-subtle)',
                color: mode === m ? '#fff' : 'var(--text)',
              }}
            >{m === 'since-opening' ? 'vs Opening' : m}</button>
          ))}
        </div>
      </div>

      {/* Turn buttons */}
      <div style={{
        padding: '6px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', gap: 4, flexWrap: 'wrap',
      }}>
        {turns.map(t => (
          <button
            key={t.turnIndex}
            onClick={() => setSelectedTurn(t.turnIndex)}
            className="btn btn-sm"
            style={{
              fontSize: '0.65rem',
              background: t.turnIndex === safeSelected ? 'var(--accent-color, #3b82f6)' : 'var(--bg-subtle)',
              color: t.turnIndex === safeSelected ? '#fff' : 'var(--text)',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Body: scrollable */}
      <div style={{ overflow: 'auto', flex: 1, padding: '8px 14px' }}>
        <MiniMap
          turns={turns}
          selectedTurn={safeSelected}
          setSelectedTurn={setSelectedTurn}
          pinnedNodes={pinnedNodes}
        />

        <div style={{ marginBottom: 6, fontSize: '0.85rem', fontWeight: 600 }}>
          {curr.label} — POV streams
        </div>
        {POVS.map(p => (
          <PovLane
            key={p}
            pov={p}
            curr={curr.byPov[p]}
            prev={prevForDiff?.byPov[p] ?? null}
            mode={mode}
            pinnedNodes={pinnedNodes}
            togglePin={togglePin}
            nodeLabels={nodeLabels}
          />
        ))}

        <div style={{ marginTop: 12, marginBottom: 6, fontSize: '0.85rem', fontWeight: 600 }}>
          AN substrate
        </div>
        <AnSubstrateLane snapshot={curr} />
      </div>
    </div>
  );
}

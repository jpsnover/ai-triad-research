// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import type { DebateSession } from '../../../../types/debate';
import { speakerLabel } from '../helpers';
import { UTILITY_WEIGHTS } from '../types';
import type { UtilitySnapshot } from '../types';
import { ScoreBadge } from '../shared';
import { BookmarkLink } from '../../../shared';

interface UtilityTabProps {
  debate: DebateSession;
  perTurnUtilities: UtilitySnapshot[];
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
}

export function UtilityTab({ debate, perTurnUtilities, setSelectedEntry, setLocalOverride }: UtilityTabProps) {
  if (perTurnUtilities.length === 0) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>No argument network data — utility requires at least one extracted claim.</div>;
  const latest = perTurnUtilities[perTurnUtilities.length - 1];
  const speakers = Object.keys(latest.byAgent);
  const maxComposite = Math.max(...perTurnUtilities.flatMap(s => Object.values(s.byAgent).map(a => a.composite)), 0.01);
  const speakerColors: Record<string, string> = { accelerationist: 'var(--color-acc)', safetyist: 'var(--color-saf)', skeptic: 'var(--color-skp)' };

  const getTrend = (speaker: string): { icon: string; color: string; label: string } => {
    if (perTurnUtilities.length < 2) return { icon: '—', color: 'var(--text-muted)', label: 'insufficient data' };
    const vals = perTurnUtilities.map(s => s.byAgent[speaker]?.composite ?? 0);
    const recent = vals.slice(-3);
    const delta = recent[recent.length - 1] - recent[0];
    if (delta > 0.03) return { icon: '↑', color: 'var(--success)', label: `rising (+${delta.toFixed(3)})` };
    if (delta < -0.03) return { icon: '↓', color: 'var(--danger)', label: `falling (${delta.toFixed(3)})` };
    return { icon: '→', color: 'var(--warning)', label: `flat (${delta.toFixed(3)})` };
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        Per-agent utility across {perTurnUtilities.length} turns. Composite = weighted sum of position strength, attack effectiveness, and crux engagement.
      </div>
      <BookmarkLink docPath="docs/utility-function-and-lookahead.md" size="xs" />

      {/* Per-speaker summary cards */}
      {speakers.map(speaker => {
        const u = latest.byAgent[speaker];
        const trend = getTrend(speaker);
        const color = speakerColors[speaker] ?? 'var(--text-muted)';
        const w = UTILITY_WEIGHTS[speaker];
        return (
          <div key={speaker} style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 6, background: 'var(--bg-primary)', borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: '0.8rem', color }}>{speakerLabel(speaker)}</strong>
              <ScoreBadge value={u.composite} label="composite" tooltip={`Composite utility: ${u.composite.toFixed(3)} — weighted sum of position strength, attack effectiveness, and crux engagement`} />
              <span title={trend.label} style={{ fontSize: '0.85rem', fontWeight: 700, color: trend.color }}>{trend.icon}</span>
              {w && <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>weights: pos={w.position} atk={w.attack} crux={w.crux}</span>}
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <ScoreBadge value={u.position_strength} label="position_strength" compact tooltip="Mean computed_strength of undefeated nodes (>= 0.3)" />
              <ScoreBadge value={u.attack_effectiveness} label="attack_effectiveness" compact tooltip="Fraction of opponent nodes weakened below 0.3" />
              <ScoreBadge value={u.crux_engagement} label="crux_engagement" compact tooltip="Fraction of cruxes this agent has addressed" />
            </div>
            {/* Sparkline — composite utility over turns */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 32 }}>
                {perTurnUtilities.map((snap, i) => {
                  const val = snap.byAgent[speaker]?.composite ?? 0;
                  const pctVal = maxComposite > 0 ? (val / maxComposite) * 100 : 0;
                  const isThisSpeaker = snap.speaker === speaker;
                  return (
                    <div
                      key={i}
                      title={`Turn ${snap.turn}: ${val.toFixed(3)}`}
                      style={{
                        flex: 1, minWidth: 3, maxWidth: 12,
                        height: `${Math.max(pctVal, 4)}%`,
                        background: isThisSpeaker ? color : `${color}40`,
                        borderRadius: '2px 2px 0 0',
                        cursor: 'pointer',
                      }}
                      onClick={() => { if (snap.entryId) { setSelectedEntry(snap.entryId); setLocalOverride(true); } }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                <span>{Math.min(...perTurnUtilities.map(s => s.byAgent[speaker]?.composite ?? 0)).toFixed(3)}</span>
                <span style={{ fontWeight: 600, color }}>{u.composite.toFixed(3)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

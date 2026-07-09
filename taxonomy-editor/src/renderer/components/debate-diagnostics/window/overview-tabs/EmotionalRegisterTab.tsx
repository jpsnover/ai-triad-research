// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useMemo } from 'react';
import type { DebateSession } from '../../../../types/debate';
import { speakerLabel } from '../helpers';
import {
  computeAffectProfile,
  computeAffectIntensity,
  computeAffectAppropriateness,
  AFFECT_CATEGORIES,
  AFFECT_PHASE_BASELINES,
  type AffectCategory,
  type AffectProfile,
} from '@lib/debate/affectSignals';
import { getDebatePhase } from '@lib/debate/types';

interface EmotionalRegisterTabProps {
  debate: DebateSession;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
}

const SPEAKER_COLORS: Record<string, string> = {
  accelerationist: '#f97316',
  safetyist: '#3b82f6',
  skeptic: '#a855f7',
};

const CATEGORY_COLORS: Record<AffectCategory, string> = {
  urgency: '#f59e0b',
  fear: '#ef4444',
  hope: '#22c55e',
  outrage: '#dc2626',
  empathy: '#3b82f6',
};

interface TurnAffect {
  entryId: string;
  speaker: string;
  turn: number;
  profile: AffectProfile;
  intensity: number;
  appropriateness: number | null;
  phase: string;
}

export function EmotionalRegisterTab({ debate, setSelectedEntry, setLocalOverride }: EmotionalRegisterTabProps) {
  const totalRounds = (debate.config as Record<string, unknown>)?.rounds as number ?? 5;

  const turnData = useMemo(() => {
    const results: TurnAffect[] = [];
    for (const entry of debate.transcript) {
      if (entry.type !== 'statement' && entry.type !== 'opening') continue;
      if (entry.speaker === 'system' || entry.speaker === 'moderator') continue;
      const content = typeof entry.content === 'string' ? entry.content : '';
      const profile = computeAffectProfile(content);
      if (!profile) continue;
      const intensity = computeAffectIntensity(content);
      if (intensity == null) continue;
      const round = (entry.metadata as Record<string, unknown>)?.round as number ?? 1;
      const phase = getDebatePhase(round, totalRounds);
      const appropriateness = phase !== 'terminated' ? computeAffectAppropriateness(profile, phase) : null;
      results.push({
        entryId: entry.id,
        speaker: entry.speaker,
        turn: results.length + 1,
        profile,
        intensity,
        appropriateness,
        phase,
      });
    }
    return results;
  }, [debate.transcript, totalRounds]);

  const speakers = useMemo(() => {
    const set = new Set<string>();
    for (const t of turnData) set.add(t.speaker);
    return Array.from(set);
  }, [turnData]);

  const perSpeaker = useMemo(() => {
    const map = new Map<string, TurnAffect[]>();
    for (const t of turnData) {
      const arr = map.get(t.speaker) ?? [];
      arr.push(t);
      map.set(t.speaker, arr);
    }
    return map;
  }, [turnData]);

  const warnings = useMemo(() =>
    turnData.filter(t =>
      t.phase === 'concluding' &&
      t.appropriateness != null &&
      t.appropriateness < 0.40 &&
      t.profile.outrage > 0.50
    ),
  [turnData]);

  if (turnData.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        No affect data — statements are too short or no transcript entries.
      </div>
    );
  }

  const allApprops = turnData.filter(t => t.appropriateness != null).map(t => t.appropriateness!);
  const meanApprop = allApprops.length > 0 ? allApprops.reduce((a, b) => a + b, 0) / allApprops.length : null;
  const varianceApprop = meanApprop != null && allApprops.length > 1
    ? allApprops.reduce((sum, v) => sum + (v - meanApprop) ** 2, 0) / allApprops.length
    : null;

  const maxIntensity = Math.max(...turnData.map(t => t.intensity), 0.01);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        Emotional register across {turnData.length} statements. Affect computed from lexical signals (Wachsmuth Emotional Appeal).
      </div>

      {/* Concluding-outrage warnings */}
      {warnings.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(220,38,38,0.08)', borderLeft: '3px solid #dc2626',
        }}>
          <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.72rem', marginBottom: 4 }}>
            Concluding-Phase Outrage Warning
          </div>
          {warnings.map(w => (
            <div
              key={w.entryId}
              style={{ fontSize: '0.7rem', marginBottom: 2, cursor: 'pointer' }}
              onClick={() => { setSelectedEntry(w.entryId); setLocalOverride(true); }}
            >
              <strong style={{ color: SPEAKER_COLORS[w.speaker] ?? '#6b7280' }}>{speakerLabel(w.speaker)}</strong>
              {' '}turn {w.turn}: appropriateness {w.appropriateness!.toFixed(2)}, outrage {w.profile.outrage.toFixed(2)}
            </div>
          ))}
        </div>
      )}

      {/* Mean appropriateness + variance */}
      {meanApprop != null && (
        <div style={{
          marginBottom: 14, padding: '10px 12px', borderRadius: 6,
          background: 'var(--bg-primary)',
          borderLeft: `3px solid ${meanApprop >= 0.7 ? '#22c55e' : meanApprop >= 0.4 ? '#f59e0b' : '#dc2626'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.72rem' }}>
            <span style={{ fontWeight: 600 }}>Mean Appropriateness</span>
            <span style={{
              fontWeight: 700, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums',
              color: meanApprop >= 0.7 ? '#22c55e' : meanApprop >= 0.4 ? '#f59e0b' : '#dc2626',
            }}>{meanApprop.toFixed(3)}</span>
            {varianceApprop != null && (
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                variance: {varianceApprop.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Per-speaker cards */}
      {speakers.map(speaker => {
        const turns = perSpeaker.get(speaker) ?? [];
        if (turns.length === 0) return null;
        const color = SPEAKER_COLORS[speaker] ?? '#6b7280';
        const meanProfile = {} as AffectProfile;
        for (const cat of AFFECT_CATEGORIES) {
          meanProfile[cat] = turns.reduce((sum, t) => sum + t.profile[cat], 0) / turns.length;
        }
        const meanIntensity = turns.reduce((sum, t) => sum + t.intensity, 0) / turns.length;

        return (
          <div key={speaker} style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 6, background: 'var(--bg-primary)', borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: '0.8rem', color }}>{speakerLabel(speaker)}</strong>
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{turns.length} statements</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                intensity: {meanIntensity.toFixed(3)}
              </span>
            </div>

            {/* Mean affect profile bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {AFFECT_CATEGORIES.map(cat => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, minWidth: 50, textAlign: 'right', color: CATEGORY_COLORS[cat] }}>
                    {cat}
                  </span>
                  <div style={{ flex: 1, height: 10, background: 'var(--bg-secondary, #222)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      width: `${meanProfile[cat] * 100}%`,
                      height: '100%',
                      background: CATEGORY_COLORS[cat],
                      opacity: 0.7,
                      borderRadius: 2,
                    }} />
                  </div>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {meanProfile[cat].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {/* Intensity sparkline */}
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Intensity trend</div>
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 28 }}>
                {turns.map((t, i) => {
                  const pctVal = maxIntensity > 0 ? (t.intensity / maxIntensity) * 100 : 0;
                  return (
                    <div
                      key={i}
                      title={`Turn ${t.turn}: intensity ${t.intensity.toFixed(3)}`}
                      style={{
                        flex: 1, minWidth: 3, maxWidth: 12,
                        height: `${Math.max(pctVal, 4)}%`,
                        background: color,
                        opacity: 0.7,
                        borderRadius: '2px 2px 0 0',
                        cursor: 'pointer',
                      }}
                      onClick={() => { setSelectedEntry(t.entryId); setLocalOverride(true); }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                <span>{Math.min(...turns.map(t => t.intensity)).toFixed(3)}</span>
                <span style={{ fontWeight: 600, color }}>{turns[turns.length - 1].intensity.toFixed(3)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useMemo } from 'react';
import type { DebateSession } from '../../../../types/debate';
import {
  computeAffectProfile,
  computeAffectIntensity,
  computeAffectAppropriateness,
  computeAffectEvidence,
  AFFECT_CATEGORIES,
  AFFECT_PHASE_BASELINES,
  type AffectCategory,
} from '@lib/debate/affectSignals';
import { getDebatePhase } from '@lib/debate/types';

export interface AffectTabProps {
  entry: DebateSession['transcript'][number];
  debate: DebateSession;
  entryIdx: number;
}

const CATEGORY_COLORS: Record<AffectCategory, string> = {
  urgency: 'var(--warning)',
  fear: 'var(--danger)',
  hope: 'var(--success)',
  outrage: 'var(--danger)',
  empathy: 'var(--color-saf)',
};

const CATEGORY_LABELS: Record<AffectCategory, string> = {
  urgency: 'Urgency',
  fear: 'Fear',
  hope: 'Hope',
  outrage: 'Outrage',
  empathy: 'Empathy',
};

export function AffectTab({ entry, debate, entryIdx }: AffectTabProps) {
  const content = typeof entry.content === 'string' ? entry.content : '';

  const { profile, intensity, phase, appropriateness, baseline, evidence } = useMemo(() => {
    const p = computeAffectProfile(content);
    const i = computeAffectIntensity(content);
    const ev = computeAffectEvidence(content);
    const entryRound = (entry.metadata as Record<string, unknown>)?.round as number ?? 1;
    const totalRounds = (debate.config as Record<string, unknown>)?.rounds as number ?? 5;
    const ph = getDebatePhase(entryRound, totalRounds);
    const a = p && ph !== 'terminated' ? computeAffectAppropriateness(p, ph) : null;
    const bl = ph !== 'terminated' ? AFFECT_PHASE_BASELINES[ph] : null;
    return { profile: p, intensity: i, phase: ph, appropriateness: a, baseline: bl, evidence: ev };
  }, [content, entry.metadata, debate.config]);

  if (!profile) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        n/a — too short (fewer than 20 words)
      </div>
    );
  }

  const approColor = appropriateness == null ? 'var(--text-muted)'
    : appropriateness >= 0.7 ? 'var(--success)'
    : appropriateness >= 0.4 ? 'var(--warning)'
    : 'var(--danger)';

  return (
    <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-skp) 20%, transparent)', color: 'var(--color-skp)', fontWeight: 600 }}>AFFECT</span>
        <span>phase: {phase}</span>
      </div>

      {/* Affect Profile Bars */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: '0.72rem', marginBottom: 6 }}>Affect Profile</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {AFFECT_CATEGORIES.map(cat => {
            const val = profile[cat];
            const baseVal = baseline?.[cat];
            const terms = evidence[cat];
            return (
              <div key={cat} style={{ marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, minWidth: 60, textAlign: 'right', color: CATEGORY_COLORS[cat] }}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <div style={{ flex: 1, height: 16, background: 'var(--bg-secondary, #222)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      width: `${val * 100}%`,
                      height: '100%',
                      background: CATEGORY_COLORS[cat],
                      borderRadius: 3,
                      opacity: 0.7,
                      transition: 'width 0.3s ease',
                    }} />
                    {baseVal != null && (
                      <div
                        title={`${phase} baseline: ${baseVal.toFixed(2)}`}
                        style={{
                          position: 'absolute',
                          left: `${baseVal * 100}%`,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background: 'var(--text-primary)',
                          opacity: 0.5,
                        }}
                      />
                    )}
                  </div>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {val.toFixed(2)}
                  </span>
                </div>
                <div style={{ marginLeft: 68, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.3 }}>
                  {terms.length > 0
                    ? <span>{'← '}{terms.map((t, i) => <React.Fragment key={t}>{i > 0 && ', '}<span style={{ color: CATEGORY_COLORS[cat], fontStyle: 'normal' }}>{t}</span></React.Fragment>)}</span>
                    : <span>no terms matched</span>
                  }
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4 }}>
          Vertical markers show the {phase}-phase baseline for comparison.
        </div>
      </div>

      {/* Intensity Gauge */}
      <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 6, background: 'var(--bg-primary)', borderLeft: '3px solid var(--color-skp)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.72rem' }}>Intensity</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {intensity != null ? intensity.toFixed(3) : 'n/a'}
          </span>
        </div>
        {intensity != null && (
          <div style={{ height: 8, background: 'var(--bg-secondary, #222)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${intensity * 100}%`,
              height: '100%',
              background: intensity > 0.6 ? 'var(--danger)' : intensity > 0.3 ? 'var(--warning)' : 'var(--success)',
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>
        )}
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4 }}>
          Weighted: fear/outrage 0.30, urgency 0.20, hope/empathy 0.10
        </div>
      </div>

      {/* Appropriateness */}
      <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--bg-primary)', borderLeft: `3px solid ${approColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.72rem' }}>Phase Appropriateness</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: approColor }}>
            {appropriateness != null ? appropriateness.toFixed(3) : 'n/a'}
          </span>
          {appropriateness != null && appropriateness < 0.4 && profile.outrage > 0.5 && phase === 'concluding' && (
            <span style={{
              padding: '1px 6px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 600,
              background: 'rgba(220,38,38,0.15)', color: 'var(--danger)',
            }}>concluding outrage warning</span>
          )}
        </div>
        {appropriateness != null && (
          <div style={{ height: 8, background: 'var(--bg-secondary, #222)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${appropriateness * 100}%`,
              height: '100%',
              background: approColor,
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>
        )}
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 4 }}>
          1.0 = on-baseline, 0.0 = {'≥'}35% mean deviation from {phase}-phase expected profile.
        </div>
      </div>
    </div>
  );
}

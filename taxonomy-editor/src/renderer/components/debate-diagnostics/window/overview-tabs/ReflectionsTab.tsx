// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React from 'react';
import { POVER_INFO } from '../../../../types/debate';
import type { DebateSession } from '../../../../types/debate';
import { TheoryLink } from '../../../shared/TheoryLink';

interface ReflectionEdit {
  edit_type: string;
  node_id: string | null;
  category: string;
  current_label: string | null;
  proposed_label: string;
  current_description: string | null;
  proposed_description: string;
  rationale: string;
  confidence?: string;
  evidence_entries?: string[];
  status: string;
}

interface ReflectionResult {
  pover: string;
  label: string;
  reflection_summary: string;
  edits: ReflectionEdit[];
}

interface ReflectionsTabProps {
  debate: DebateSession;
}

export function ReflectionsTab({ debate }: ReflectionsTabProps) {
  const reflectionEntries = debate.transcript.filter(e => e.type === 'reflection');
  const allResults = reflectionEntries.flatMap(e => {
    const meta = e.metadata as Record<string, unknown> | undefined;
    return (meta?.reflection_results as ReflectionResult[]) || [];
  });
  const confColors: Record<string, string> = { high: 'var(--success)', medium: 'var(--warning)', low: 'var(--danger)' };
  const editTypeColors: Record<string, string> = { revise: 'var(--color-saf)', add: 'var(--success)', qualify: 'var(--warning)', deprecate: 'var(--danger)' };
  const totalEdits = allResults.reduce((s, r) => s + r.edits.length, 0);
  const approved = allResults.reduce((s, r) => s + r.edits.filter(e => e.status === 'approved').length, 0);

  return (
    <div style={{ fontSize: '0.75rem' }}>
      <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
        {allResults.length} debater{allResults.length !== 1 ? 's' : ''} reflected, {totalEdits} edit{totalEdits !== 1 ? 's' : ''} proposed{approved > 0 ? `, ${approved} applied` : ''}
      </div>
      <TheoryLink docPath="docs/debate-system-overview.md" anchor="reflections" size={12} />
      {allResults.map((r, ri) => {
        const poverInfo = Object.values(POVER_INFO).find(p => p.pov === r.pover);
        const color = poverInfo?.color || '#888';
        return (
          <div key={ri} style={{ marginBottom: 16 }}>
            <div style={{
              fontWeight: 700, fontSize: '0.8rem', color,
              borderBottom: `2px solid ${color}`, paddingBottom: 4, marginBottom: 6,
            }}>
              {r.label}
              <span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 8 }}>
                {r.edits.length} edit{r.edits.length !== 1 ? 's' : ''}
              </span>
            </div>
            {r.reflection_summary && (
              <div style={{
                padding: '6px 10px', marginBottom: 8, fontSize: '0.72rem', lineHeight: 1.5,
                background: `${color}10`, borderLeft: `3px solid ${color}`,
                borderRadius: '0 4px 4px 0',
              }}>
                {r.reflection_summary}
              </div>
            )}
            {r.edits.map((edit, ei) => (
              <div key={ei} style={{
                padding: '8px 10px', marginBottom: 6, borderRadius: 6,
                border: `1px solid ${edit.status === 'approved' ? 'var(--success)44' : 'var(--border)'}`,
                opacity: edit.status === 'dismissed' ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    padding: '1px 5px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                    background: `${editTypeColors[edit.edit_type] || '#888'}22`,
                    color: editTypeColors[edit.edit_type] || '#888',
                  }}>
                    {edit.edit_type.toUpperCase()}
                  </span>
                  {edit.node_id && <code style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{edit.node_id}</code>}
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{edit.category}</span>
                  {edit.confidence && (
                    <span style={{
                      padding: '1px 4px', borderRadius: 3, fontSize: 'var(--text-2xs)', fontWeight: 700,
                      border: `1px solid ${confColors[edit.confidence] || '#888'}44`,
                      color: confColors[edit.confidence] || '#888',
                    }}>
                      {edit.confidence}
                    </span>
                  )}
                  {edit.status !== 'pending' && (
                    <span style={{
                      marginLeft: 'auto', fontSize: 'var(--text-2xs)', fontWeight: 600,
                      color: edit.status === 'approved' ? 'var(--success)' : 'var(--text-muted)',
                    }}>
                      {edit.status === 'approved' ? 'Applied' : 'Dismissed'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', marginBottom: 3 }}>
                  {edit.current_label ? (
                    <>
                      <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{edit.current_label}</span>
                      {' → '}
                      <span style={{ fontWeight: 600 }}>{edit.proposed_label}</span>
                    </>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{edit.proposed_label}</span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 2 }}>
                  {edit.rationale}
                </div>
                {edit.evidence_entries && edit.evidence_entries.length > 0 && (
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    Evidence: {edit.evidence_entries.map((ev: string, evi: number) => (
                      <code key={evi} style={{ padding: '0 3px', marginRight: 2, borderRadius: 2, background: 'var(--bg-secondary)', fontSize: 'var(--text-2xs)' }}>{ev}</code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {allResults.length === 0 && (
        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>
          No reflections recorded yet.
        </div>
      )}
    </div>
  );
}

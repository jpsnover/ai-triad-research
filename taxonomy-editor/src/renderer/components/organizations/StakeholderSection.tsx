// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { api } from '@bridge';
import type { Organization, PovStance, PovAlignmentTier } from '../../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const TIER_TO_SCORE: Record<PovAlignmentTier, number> = {
  opposes: -1.0, leans_against: -0.5, mixed_or_silent: 0, leans_toward: 0.5, champions: 1.0,
};
function tierScore(stance: PovStance): number { return TIER_TO_SCORE[stance.tier] ?? 0; }

const POV_COLORS: Record<string, string> = {
  accelerationist: '#f97316',
  safetyist: '#22c55e',
  skeptic: '#a855f7',
};

function PovDots({ alignment }: { alignment?: Organization['pov_alignment'] }) {
  if (!alignment) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {(['accelerationist', 'safetyist', 'skeptic'] as const).map((pov) => {
        const stance = alignment[pov];
        if (!stance) return null;
        const score = tierScore(stance);
        const color = POV_COLORS[pov] ?? 'var(--text-muted)';
        return (
          <span
            key={pov}
            title={`${pov}: ${stance.tier.replace('_', ' ')}`}
            style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: color, opacity: Math.max(0.3, Math.abs(score)),
            }}
          />
        );
      })}
    </span>
  );
}

interface StakeholderSectionProps {
  nodeId: string;
  queryType: 'topic' | 'policy';
}

export function StakeholderSection({ nodeId, queryType }: StakeholderSectionProps) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetch = queryType === 'topic'
      ? api.getOrganizationsByTopic(nodeId)
      : api.getOrganizationsByPolicy(nodeId);
    void fetch.then((result) => {
      if (!cancelled) { setOrgs(result); setLoading(false); }
    }).catch((err) => {
      getGlobalRecorder()?.record({
        type: 'state.error', component: 'stakeholder-section', level: 'error',
        message: 'Failed to fetch stakeholder organizations',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      if (!cancelled) { setOrgs([]); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [nodeId, queryType]);

  if (loading || orgs.length === 0) return null;

  return (
    <div className="form-group">
      <label>Stakeholders</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {orgs.map((org) => (
          <div key={org.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
            <span style={{ flex: 1 }}>{org.name}</span>
            {org.type && (
              <span style={{
                padding: '1px 6px', borderRadius: 8, fontSize: 'var(--text-2xs)', fontWeight: 600,
                background: 'var(--bg-tertiary, #334155)', color: 'var(--text-primary)',
              }}>
                {org.type.replace('_', ' ')}
              </span>
            )}
            <PovDots alignment={org.pov_alignment} />
          </div>
        ))}
      </div>
    </div>
  );
}

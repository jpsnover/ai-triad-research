// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateTestedRecord, DebateTestedEntry } from '../../bridge/types';
import { DebateTestedChip } from './DebateTestedChip';
import './DebateTestedDrilldown.css';

const VERDICT_COLORS: Record<string, string> = {
  held: '#16a34a',
  weakened: '#dc2626',
  refined: '#2563eb',
  open: '#9ca3af',
  cited: '#6366f1',
};

interface DebateTestedDrilldownProps {
  record: DebateTestedRecord;
  description?: string;
  onClose: () => void;
}

function EntryRow({ entry }: { entry: DebateTestedEntry }) {
  const verdictColor = VERDICT_COLORS[entry.verdict] ?? 'var(--text-muted)';
  return (
    <div className="dt-drilldown-entry">
      <div className="dt-drilldown-entry-header">
        <span className="dt-drilldown-verdict" style={{ color: verdictColor }}>
          {entry.verdict}
        </span>
        <span className="dt-drilldown-date">{entry.date}</span>
      </div>
      <div className="dt-drilldown-entry-details">
        <span title="Debate ID">ID: {entry.debate_id.slice(0, 8)}…</span>
        <span title="Pipeline version">v{entry.pipeline_version}</span>
      </div>
      <div className="dt-drilldown-entry-stats">
        <span title="Claims that thrived">✓ {entry.claim_outcomes.thrived}</span>
        <span title="Claims that survived">≈ {entry.claim_outcomes.survived}</span>
        <span title="Claims that died">✗ {entry.claim_outcomes.died}</span>
      </div>
      {entry.strongest_attack_encountered && (
        <div className="dt-drilldown-attack">
          Strongest attack: {entry.strongest_attack_encountered.scheme}
          ({entry.strongest_attack_encountered.challenger_camp}, str {entry.strongest_attack_encountered.strength.toFixed(2)})
        </div>
      )}
      {entry.concession && (
        <div className="dt-drilldown-concession">
          Concession: {entry.concession.type}
        </div>
      )}
    </div>
  );
}

export function DebateTestedDrilldown({ record, description, onClose }: DebateTestedDrilldownProps) {
  return (
    <div className="dt-drilldown">
      <div className="dt-drilldown-header">
        <span className="dt-drilldown-title">Debate-Tested Record</span>
        <button className="btn btn-ghost dt-drilldown-close" onClick={onClose}>&times;</button>
      </div>

      <div className="dt-drilldown-summary">
        <DebateTestedChip record={record} description={description} />
        <div className="dt-drilldown-stats-row">
          <span>{record.engagements} engagements</span>
          <span>{record.challenges} challenges</span>
          <span>{record.held} held</span>
          <span>{record.weakened} weakened</span>
        </div>
        <div className="dt-drilldown-meta">
          Last tested: {record.last_tested}
          {record.revisions.length > 0 && (
            <span> · {record.revisions.length} revision{record.revisions.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        {record.revisions.filter(r => r.held_since).length > 0 && (
          <div className="dt-drilldown-held-since">
            Held since revision on {record.revisions.find(r => r.held_since)!.date}
          </div>
        )}
      </div>

      <div className="dt-drilldown-entries-title">
        Test History ({record.record.length} session{record.record.length !== 1 ? 's' : ''})
      </div>
      <div className="dt-drilldown-entries">
        {record.record.map((entry, i) => (
          <EntryRow key={entry.debate_id + i} entry={entry} />
        ))}
        {record.record.length === 0 && (
          <div className="dt-drilldown-empty">No test sessions recorded.</div>
        )}
      </div>
    </div>
  );
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * DebateFunnelChart (t/893) — hand-coded horizontal funnel showing where
 * debates stall across the lifecycle. Stage counts come from server-aggregated
 * event-type counts. Stages without an emitter event yet (turns / extractions)
 * render as "not yet tracked" rather than a misleading zero, and light up
 * automatically once those events land.
 */

import './analyticsCards.css';

interface Stage { label: string; count: number; instrumented: boolean }

export function DebateFunnelChart({ eventTypes }: { eventTypes?: Record<string, number> }) {
  const et = eventTypes ?? {};
  const complete = et['debate.complete'] ?? 0;
  const abandon = et['debate.abandon'] ?? 0;
  // "Started" has no dedicated event yet — fall back to complete + abandon.
  const started = et['debate.start'] ?? (complete + abandon);
  const taxonomyChanges = (et['node.create'] ?? 0) + (et['node.edit'] ?? 0);

  const stages: Stage[] = [
    { label: 'Started', count: started, instrumented: true },
    { label: 'Turns completed', count: et['debate.turn'] ?? 0, instrumented: 'debate.turn' in et },
    { label: 'Extractions made', count: et['debate.extraction'] ?? 0, instrumented: 'debate.extraction' in et },
    { label: 'Taxonomy changes', count: taxonomyChanges, instrumented: true },
    { label: 'Completed', count: complete, instrumented: true },
  ];

  if (started === 0 && complete === 0) {
    return (
      <div className="analytics-panel">
        <div className="analytics-card-label">Debate Funnel</div>
        <div className="analytics-card-empty">No debate data yet</div>
      </div>
    );
  }

  const max = Math.max(...stages.map(s => s.count), 1);

  // Biggest drop-off between consecutive instrumented stages.
  let dropIdx = -1, dropMax = 0;
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].instrumented && stages[i - 1].instrumented && stages[i - 1].count > 0) {
      const d = stages[i - 1].count - stages[i].count;
      if (d > dropMax) { dropMax = d; dropIdx = i; }
    }
  }

  return (
    <div className="analytics-panel">
      <div className="analytics-card-label">Debate Funnel</div>
      <div className="funnel">
        {stages.map((s, i) => (
          <div key={s.label} className="funnel-row">
            <span className="funnel-label">
              {s.label}{!s.instrumented && <span className="funnel-pending"> (not yet tracked)</span>}
            </span>
            <div className="funnel-bar-track">
              <div
                className="funnel-bar"
                /* eslint-disable-next-line local/no-inline-style -- dynamic: data-driven bar width/opacity/color */
                style={{
                  width: `${(s.count / max) * 100}%`,
                  opacity: s.instrumented ? 1 : 0.3,
                  background: i === dropIdx ? 'var(--danger, #ef4444)' : 'var(--color-acc, #3b82f6)',
                }}
              />
            </div>
            <span className="funnel-count">{s.instrumented ? s.count : '—'}</span>
          </div>
        ))}
      </div>
      {dropIdx > 0 && (
        <div className="funnel-note">
          Biggest drop-off: {stages[dropIdx - 1].label} → {stages[dropIdx].label} (−{dropMax})
        </div>
      )}
    </div>
  );
}

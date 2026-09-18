// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Steelman display (t/3514). Debaters must state the strongest version of an opponent's position
// before critiquing it; claim extraction tags those claims (`steelman_of`) and an NLI check grades
// each one against what the target camp actually asserted (`steelman_check`). These components
// make that visible: a verdict badge, a callout in the transcript card, and a debate-wide panel.

import { POVER_INFO } from '../../types/debate';
import type { DebateSession } from '../../types/debate';
import { normalizeSteelmanTarget, type CampId, type SteelmanCheck } from '@lib/debate/steelman';
import './Steelman.css';

type AnNode = NonNullable<DebateSession['argument_network']>['nodes'][number];

const campLabel = (camp: CampId): string => POVER_INFO[camp]?.label ?? camp;

/** Camp label for a node's steelman target (tolerates pre-t/3514 label values), or null. */
function targetOf(node: AnNode): CampId | null {
  return normalizeSteelmanTarget(node.steelman_of, '').target;
}

const VERDICT_TEXT: Record<SteelmanCheck['verdict'], string> = {
  faithful: 'matches what they said',
  diverges: 'misrepresents them',
  unchecked: 'not yet checked',
};

const VERDICT_ICON: Record<SteelmanCheck['verdict'], string> = { faithful: '✓', diverges: '✗', unchecked: '?' };

function verdictTitle(check: SteelmanCheck | undefined): string {
  if (!check) return 'Not checked (debate predates steelman verdicts)';
  if (check.verdict === 'unchecked') return `Not checked: ${check.reason ?? 'unknown reason'}`;
  const score = check.max_entailment != null ? ` (entailment ${check.max_entailment.toFixed(2)})` : '';
  return `${VERDICT_TEXT[check.verdict]}${score}`;
}

/** Compact pill: "Steelman of Safetyist ✓". Returns null when the node is not a usable steelman. */
export function SteelmanBadge({ node }: { node: AnNode }) {
  const target = targetOf(node);
  if (!target) return null;
  const verdict = node.steelman_check?.verdict ?? 'unchecked';
  return (
    <span className={`steelman-badge steelman-${verdict}`} title={verdictTitle(node.steelman_check)}>
      Steelman of {campLabel(target)} {VERDICT_ICON[verdict]}
    </span>
  );
}

/** One steelman, in full: the claim, the verdict, and what the target actually said. */
function SteelmanDetail({ node, showSpeaker }: { node: AnNode; showSpeaker?: boolean }) {
  const target = targetOf(node);
  if (!target) return null;
  const check = node.steelman_check;
  const verdict = check?.verdict ?? 'unchecked';
  const speakerLabel = POVER_INFO[node.speaker as CampId]?.label ?? String(node.speaker);
  return (
    <div className={`steelman-callout steelman-${verdict}`} data-testid="steelman-callout">
      <div className="steelman-callout-head">
        <span className="steelman-callout-title">
          {showSpeaker ? `${speakerLabel}'s steelman of the ${campLabel(target)}` : `Steelman of the ${campLabel(target)}`}
        </span>
        <span className="steelman-verdict">{VERDICT_ICON[verdict]} {check ? VERDICT_TEXT[verdict] : 'not checked'}</span>
        <span className="steelman-claim-id">{node.id}</span>
      </div>
      <blockquote className="steelman-text">{node.text}</blockquote>
      {check?.best_match && (
        <div className="steelman-evidence">
          Closest thing the {campLabel(target)} actually said
          {check.max_entailment != null && <> (entailment {check.max_entailment.toFixed(2)})</>}:
          <q>{check.best_match}</q>
        </div>
      )}
      {check?.verdict === 'unchecked' && check.reason && <div className="steelman-evidence">{check.reason}</div>}
    </div>
  );
}

/** Steelmans made in one transcript entry — rendered in the statement card. */
export function StatementSteelmans({ entryId, debate }: { entryId: string; debate: DebateSession | null | undefined }) {
  const nodes = (debate?.argument_network?.nodes ?? []).filter(n => n.source_entry_id === entryId && targetOf(n));
  if (nodes.length === 0) return null;
  return (
    <div className="steelman-list">
      {nodes.map(n => <SteelmanDetail key={n.id} node={n} />)}
    </div>
  );
}

/** Number of usable steelmans in a debate — drives the diagnostics tab's visibility and label. */
export function steelmanCount(debate: DebateSession): number {
  return (debate.argument_network?.nodes ?? []).filter(n => targetOf(n)).length;
}

/** Every steelman in the debate, with a verdict summary — the diagnostics overview tab. */
export function SteelmansPanel({ debate }: { debate: DebateSession }) {
  const nodes = (debate.argument_network?.nodes ?? []).filter(n => targetOf(n));
  if (nodes.length === 0) {
    return <div className="steelman-empty">No steelmans were recorded in this debate.</div>;
  }
  const counts = { faithful: 0, diverges: 0, unchecked: 0 };
  for (const n of nodes) counts[n.steelman_check?.verdict ?? 'unchecked']++;
  return (
    <div className="steelman-panel">
      <div className="steelman-summary">
        {nodes.length} steelman{nodes.length !== 1 ? 's' : ''}:{' '}
        <span className="steelman-faithful-text">{counts.faithful} faithful</span>,{' '}
        <span className="steelman-diverges-text">{counts.diverges} misrepresent the target</span>,{' '}
        {counts.unchecked} not checked
      </div>
      {nodes.map(n => <SteelmanDetail key={n.id} node={n} showSpeaker />)}
    </div>
  );
}

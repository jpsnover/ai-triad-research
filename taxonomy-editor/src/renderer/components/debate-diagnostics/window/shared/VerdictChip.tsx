// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './VerdictChip.css';

export type Verdict = 'pass' | 'flag' | 'fail';

interface VerdictChipProps {
  verdict: Verdict;
  label?: string;
  tooltip?: string;
}

const VERDICT_LABELS: Record<Verdict, string> = {
  pass: 'PASS',
  flag: 'FLAG',
  fail: 'FAIL',
};

export function VerdictChip({ verdict, label, tooltip }: VerdictChipProps) {
  return (
    <span
      className={`verdict-chip verdict-chip--${verdict}`}
      title={tooltip}
    >
      {label ?? VERDICT_LABELS[verdict]}
    </span>
  );
}

export function mapOutcomeToVerdict(outcome: string): Verdict {
  switch (outcome) {
    case 'pass': return 'pass';
    case 'accept_with_flag': return 'flag';
    case 'retry':
    case 'skipped':
    default: return 'fail';
  }
}

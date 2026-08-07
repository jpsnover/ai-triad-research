// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { CampGlyph, povToCamp } from './CampGlyph';
import type { CampKey } from './CampGlyph';
import './SpeakerIdentity.css';

// ── Identity resolution ───────────────────────────────────

const ALIAS_TO_CAMP: Record<string, CampKey> = {
  accelerationist: 'acc',
  safetyist: 'saf',
  skeptic: 'skp',
  // Legacy persona aliases (DebateExchangeRich segmentation source)
  prometheus: 'acc',
  sentinel: 'saf',
  cassandra: 'skp',
};

const CAMP_LABEL: Record<CampKey, string> = {
  acc: 'Accelerationist',
  saf: 'Safetyist',
  skp: 'Skeptic',
};

const CAMP_COLOR: Record<CampKey, string> = {
  acc: 'var(--color-acc)',
  saf: 'var(--color-saf)',
  skp: 'var(--color-skp)',
};

const FIXED: Record<string, { label: string; color?: string }> = {
  user:      { label: 'You' },
  moderator: { label: 'Moderator', color: 'var(--color-moderator, #8b5cf6)' },
  system:    { label: 'System' },
  document:  { label: 'Document' },
};

export interface ResolvedSpeaker {
  label: string;
  camp: CampKey | undefined;
  color: string | undefined;
}

/**
 * Canonical speaker resolver. Accepts any of:
 *   - Debate engine IDs ('accelerationist', 'safetyist', 'skeptic', 'user')
 *   - Legacy persona aliases ('Prometheus', 'Sentinel', 'Cassandra') — case-insensitive
 *   - Fixed roles ('moderator', 'system', 'document')
 *
 * Returns label + camp + CSS color. This is the single lookup replacing all
 * per-surface speaker maps and regex fallbacks (t/2242).
 */
export function resolveSpeaker(nameOrId: string): ResolvedSpeaker {
  const lower = nameOrId.toLowerCase();
  const camp = ALIAS_TO_CAMP[lower] ?? povToCamp(lower);
  if (camp) {
    return { label: CAMP_LABEL[camp], camp, color: CAMP_COLOR[camp] };
  }
  const fixed = FIXED[lower];
  if (fixed) return { label: fixed.label, camp: undefined, color: fixed.color };
  return { label: nameOrId, camp: undefined, color: undefined };
}

// ── Component ─────────────────────────────────────────────

export interface SpeakerIdentityProps {
  /** Speaker ID, full name, or legacy alias (Prometheus / Sentinel / Cassandra). */
  speaker: string;
  /**
   * Rendering mode:
   * - 'inline'  — glyph + colored label with 3px left-border accent (transcript)
   * - 'avatar'  — circular glyph container (chat bubbles)
   * - 'badge'   — colored pill with white text (diagnostics exchange)
   */
  variant?: 'inline' | 'avatar' | 'badge';
  /** Glyph size in px. Defaults: inline=16, avatar=14, badge=12. */
  size?: number;
  className?: string;
}

export function SpeakerIdentity({ speaker, variant = 'inline', size, className }: SpeakerIdentityProps) {
  const { label, camp, color } = resolveSpeaker(speaker);
  const cls = (base: string) => `${base}${camp ? ` si-camp-${camp}` : ''}${className ? ` ${className}` : ''}`;

  if (variant === 'avatar') {
    const sz = size ?? 14;
    return (
      <div
        className={cls('si-avatar')}
        style={{ color: color ?? 'var(--text-secondary)', width: sz, height: sz }}
        aria-label={label}
      >
        {camp && <CampGlyph camp={camp} size={sz} />}
      </div>
    );
  }

  if (variant === 'badge') {
    const sz = size ?? 12;
    return (
      <span
        className={cls('si-badge')}
        style={{ background: color ?? 'var(--text-secondary)' }}
      >
        {camp && <CampGlyph camp={camp} size={sz} />}
        {label}
      </span>
    );
  }

  // inline (default)
  const sz = size ?? 16;
  return (
    <span
      className={cls('si-inline')}
      style={{ color: color ?? undefined, borderLeftColor: color ?? 'transparent' }}
    >
      {camp && <CampGlyph camp={camp} size={sz} />}
      {label}
    </span>
  );
}

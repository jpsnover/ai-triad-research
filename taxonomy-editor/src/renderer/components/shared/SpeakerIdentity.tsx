// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * One "who is speaking" surface for the whole app (t/2242).
 *
 * Three independent systems used to answer this question for the same four-camp
 * taxonomy: the transcript's glyph + colored label, the diagnostics exchange
 * renderer's solid pill (colored through its own lowercase map with an `#888`
 * fallback), and chat's circular avatar — plus 3+ copies of the label/color
 * lookup scattered across components.
 *
 * `resolveSpeaker` is the single lookup, and per TL (e/67#4) it is the source of
 * truth for the persona aliases: `Prometheus`/`Sentinel`/`Cassandra` existed
 * ONLY inside the `DebateExchangeRich` segmentation regex, with no canonical map
 * anywhere. Everything else composes existing foundations rather than
 * re-authoring them — labels and colors come from `POVER_INFO` (the soul docs),
 * camps from `povToCamp` + `CampGlyph`, and the POV key type from
 * `@lib/debate/types`.
 */

import { POVER_INFO } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import { CampGlyph, povToCamp } from './CampGlyph';
import type { CampKey } from './CampGlyph';
import './SpeakerIdentity.css';

/** Every speaker the UI can render, including the non-POV participants. */
export type AnySpeaker = SpeakerId | 'system' | 'document' | 'moderator';

export type SpeakerVariant = 'inline' | 'avatar' | 'badge';

export interface ResolvedSpeaker {
  /** Canonical id — the POV key, or the non-POV participant name. */
  id: AnySpeaker;
  /** Display label ("Accelerationist", "You", "Moderator", …). */
  label: string;
  /** Accent color, or undefined for participants that carry no camp color. */
  color?: string;
  /** Camp key for glyph rendering; undefined for non-POV participants. */
  camp?: CampKey;
}

/**
 * Persona aliases → POV key. New table by necessity: TL confirmed (e/67#4) no
 * canonical alias map exists anywhere in the tree, and Rosetta verified against
 * the soul docs (e/67#5) that their `.label`s are the plain camp names, not the
 * personas. Add future aliases HERE, not in a consumer's regex.
 */
const SPEAKER_ALIASES: Record<string, SpeakerId> = {
  prometheus: 'accelerationist',
  sentinel: 'safetyist',
  cassandra: 'skeptic',
};

/** Non-POV participants. Mirrors the labels `debate-workspace/utils.ts` has always used. */
const NON_POV_LABELS: Record<'system' | 'document' | 'moderator' | 'user', string> = {
  system: 'System',
  document: 'Document',
  moderator: 'Moderator',
  user: 'You',
};

const MODERATOR_COLOR = 'var(--color-moderator, #8b5cf6)';

/**
 * Resolve any speaker reference — canonical id, display label, or persona alias,
 * in any case — to its identity. Unknown input degrades to a titlecased label
 * with no color rather than the old `#888` fallback, so an unrecognized speaker
 * reads as "unstyled", never as a real camp.
 */
export function resolveSpeaker(nameOrId: string): ResolvedSpeaker {
  const key = nameOrId.trim().toLowerCase();
  const id = (SPEAKER_ALIASES[key] ?? key) as AnySpeaker;

  if (id === 'system' || id === 'document' || id === 'moderator' || id === 'user') {
    return {
      id,
      label: NON_POV_LABELS[id],
      color: id === 'moderator' ? MODERATOR_COLOR : undefined,
    };
  }

  const info = POVER_INFO[id as Exclude<SpeakerId, 'user'>];
  if (info) {
    return { id, label: info.label, color: info.color, camp: povToCamp(id) };
  }

  return { id, label: nameOrId.charAt(0).toUpperCase() + nameOrId.slice(1) };
}

/**
 * Speaker identity in one of three shapes:
 * - `inline` — glyph + colored label (transcript header)
 * - `avatar` — circular glyph chip + label (chat bubble)
 * - `badge`  — solid-fill pill (diagnostics exchange)
 *
 * Pass `showLabel={false}` for glyph-only, or a speaker with no camp to get a
 * label-only render (which is what `INodeRow` needs).
 */
export function SpeakerIdentity({
  speaker,
  variant = 'inline',
  size = 16,
  showLabel = true,
  className,
  title,
}: {
  speaker: string;
  variant?: SpeakerVariant;
  size?: number;
  showLabel?: boolean;
  className?: string;
  title?: string;
}) {
  const resolved = resolveSpeaker(speaker);
  const props = { resolved, size, showLabel, title, rootClass: rootClassFor(resolved.camp, variant, className) };
  return variant === 'badge' ? <SpeakerBadge {...props} /> : <SpeakerGlyphAndLabel {...props} />;
}

function rootClassFor(camp: CampKey | undefined, variant: SpeakerVariant, className?: string): string {
  return [`speaker-identity speaker-identity-${variant}`, camp && `camp-${camp}`, className]
    .filter(Boolean)
    .join(' ');
}

interface VariantProps {
  resolved: ResolvedSpeaker;
  rootClass: string;
  size: number;
  showLabel: boolean;
  title?: string;
}

/**
 * Solid-fill pill (diagnostics exchange). The accent travels as a background
 * rather than `currentColor` because the label reverses out to white on top.
 */
function SpeakerBadge({ resolved: { label, color, camp }, rootClass, size, showLabel, title }: VariantProps) {
  return (
    /* eslint-disable-next-line local/no-inline-style -- accent is per-speaker data (POVER_INFO), not a static token */
    <span className={rootClass} style={color ? { background: color } : undefined} title={title ?? label}>
      {camp && <CampGlyph camp={camp} size={size} className="speaker-identity-glyph" />}
      {showLabel && <span className="speaker-identity-label">{label}</span>}
    </span>
  );
}

/** Glyph + colored label — the `inline` (transcript) and `avatar` (chat) shapes. */
function SpeakerGlyphAndLabel({ resolved: { label, color, camp }, rootClass, size, showLabel, title }: VariantProps) {
  const accent = color ? { color } : undefined;
  return (
    <span className={rootClass} title={title ?? label}>
      {camp && (
        /* eslint-disable-next-line local/no-inline-style -- accent is per-speaker data; CampGlyph strokes currentColor */
        <span className="speaker-identity-glyph-wrap" style={accent}>
          <CampGlyph camp={camp} size={size} className="speaker-identity-glyph" />
        </span>
      )}
      {/* eslint-disable-next-line local/no-inline-style -- accent is per-speaker data (POVER_INFO), not a static token */}
      {showLabel && <span className="speaker-identity-label" style={accent}>{label}</span>}
    </span>
  );
}

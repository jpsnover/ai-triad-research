// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import './TranscriptOutline.css';

/**
 * Minimal structural shape of a transcript entry the outline needs. Kept local
 * so the outline stays decoupled from the store's full entry type (t/2239).
 */
export interface OutlineTranscriptEntry {
  id: string;
  type: string;
  speaker?: string | null;
}

type OutlineItem = {
  key: string;
  label: string;
  targetEntryId: string;
  kind: 'section' | 'round';
};

const DEBATE_TYPES = new Set(['statement', 'cross_respond']);
const SYNTHESIS_TYPES = new Set(['synthesis', 'concluding']);

/**
 * Derives a phase → round outline from the transcript. Sections mirror the
 * in-transcript phase hairlines (Opening Statements / Cross-Examination /
 * Synthesis). Rounds within the debate section use a speaker-cycle heuristic:
 * a new round begins when a speaker repeats within the current cycle.
 */
function buildOutline(transcript: readonly OutlineTranscriptEntry[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  let section: 'opening' | 'debate' | 'synthesis' | null = null;
  let roundSpeakers = new Set<string>();
  let roundNum = 0;

  for (const entry of transcript) {
    const t = entry.type;
    if (t === 'opening') {
      if (section !== 'opening') {
        section = 'opening';
        items.push({ key: `sec-opening-${entry.id}`, label: 'Opening Statements', targetEntryId: entry.id, kind: 'section' });
      }
    } else if (DEBATE_TYPES.has(t)) {
      if (section !== 'debate') {
        section = 'debate';
        roundSpeakers = new Set();
        roundNum = 0;
        items.push({ key: `sec-debate-${entry.id}`, label: 'Cross-Examination', targetEntryId: entry.id, kind: 'section' });
      }
      const speaker = entry.speaker ?? '';
      if (speaker && roundSpeakers.has(speaker)) {
        roundSpeakers = new Set();
      }
      if (roundSpeakers.size === 0) {
        roundNum += 1;
        items.push({ key: `round-${roundNum}-${entry.id}`, label: `Round ${roundNum}`, targetEntryId: entry.id, kind: 'round' });
      }
      if (speaker) roundSpeakers.add(speaker);
    } else if (SYNTHESIS_TYPES.has(t)) {
      if (section !== 'synthesis') {
        section = 'synthesis';
        items.push({ key: `sec-synthesis-${entry.id}`, label: 'Synthesis', targetEntryId: entry.id, kind: 'section' });
      }
    }
    // Other types (probing, fact-check, clarification, system, question) are
    // not outline anchors; they stay inline in the transcript.
  }
  return items;
}

function scrollToEntry(entryId: string): void {
  document.getElementById(`debate-entry-${entryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Read-only structural navigator for the transcript (t/2239). Derived entirely
 * from the transcript prop — no new store/server state. Rendered only when the
 * DEBATE_CHAT_REDESIGN flag is on; phase hairlines remain the secondary markers.
 */
export function TranscriptOutline({ transcript }: { transcript: readonly OutlineTranscriptEntry[] }) {
  const items = useMemo(() => buildOutline(transcript), [transcript]);
  if (items.length === 0) return null;

  return (
    <nav className="transcript-outline" aria-label="Transcript outline">
      <div className="transcript-outline-title">Outline</div>
      <ul className="transcript-outline-list">
        {items.map(item => (
          <li key={item.key} className={`transcript-outline-item transcript-outline-${item.kind}`}>
            <button
              type="button"
              className="transcript-outline-link"
              onClick={() => scrollToEntry(item.targetEntryId)}
              title={item.label}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

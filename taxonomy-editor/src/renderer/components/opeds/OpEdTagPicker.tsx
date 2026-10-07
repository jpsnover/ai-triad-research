// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// POV tag for ONE op-ed member (t/3992, t/3960; TL t/3960#3, SO e/254#6). The tagged member gets the tag
// soul and the tag filter; every other member runs untagged. Reuses SeatTagPicker for the tag/mode
// controls and its setup-time refusal (TL t/3957#7 B(a): refuse before start, never throw mid-run).

import type { PovNode } from '@lib/debate/taxonomyTypes';
import type { SeatTag } from '@lib/debate/types';
import type { PovTagRegistry, TagSelection } from '@lib/schema/povTags';
import { POV_META } from '@lib/electron-shared/povMeta';
import type { PovKey } from '../../../../../lib/oped/types';
import { SeatTagPicker, seatTagRefusal, type PovName } from '../debate/SeatTagPicker';

/** The dialog's tag choice: which voice, and (once picked) its tag and mode. */
export interface OpEdTagChoice {
  pov: PovKey;
  seatTag?: SeatTag;
}

/** Selected voices that have at least one registry tag, in voice order. */
export function taggableVoices(voices: PovKey[], registry: PovTagRegistry | null): PovKey[] {
  return voices.filter(v => (registry?.povs[v as PovName] ?? []).length > 0);
}

/** The request's params.tagSelection, or undefined. A choice for a voice no longer selected, or with no
 *  tag picked yet, sends nothing, so a stale choice can never tag a member that isn't in the set. */
export function opEdTagSelection(choice: OpEdTagChoice | undefined, voices: PovKey[]): TagSelection | undefined {
  if (!choice?.seatTag || !voices.includes(choice.pov)) return undefined;
  return { pov: choice.pov, tag: choice.seatTag.pov_tag, mode: choice.seatTag.tag_mode };
}

/** Whether the choice blocks Start (Scope below the minimum, or Prioritize with no tagged nodes). */
export function opEdTagBlocksStart(choice: OpEdTagChoice | undefined, voices: PovKey[], nodesFor: (pov: PovKey) => PovNode[]): boolean {
  if (!opEdTagSelection(choice, voices)) return false;
  return seatTagRefusal(nodesFor(choice!.pov), choice!.seatTag) !== undefined;
}

export function OpEdTagPicker({ voices, registry, choice, onChange, nodesFor }: {
  voices: PovKey[];
  registry: PovTagRegistry | null;
  choice: OpEdTagChoice | undefined;
  onChange: (choice: OpEdTagChoice | undefined) => void;
  nodesFor: (pov: PovKey) => PovNode[];
}) {
  const candidates = taggableVoices(voices, registry);
  const activePov = choice && candidates.includes(choice.pov) ? choice.pov : undefined;

  return (
    <div className="oped-tag-picker">
      <label className="oped-field-label" htmlFor="oped-tag-voice">POV wing (optional)</label>
      {candidates.length === 0 ? (
        <p className="oped-field-hint">No POV tags yet for the selected voices.</p>
      ) : (
        <>
          <select
            id="oped-tag-voice"
            className="oped-select"
            value={activePov ?? ''}
            onChange={e => onChange(e.target.value ? { pov: e.target.value as PovKey } : undefined)}
          >
            <option value="">Whole camp (no wing)</option>
            {candidates.map(v => <option key={v} value={v}>{POV_META[v].label}</option>)}
          </select>
          {activePov && (
            <SeatTagPicker
              pov={activePov as PovName}
              povNodes={nodesFor(activePov)}
              registry={registry}
              seatTag={choice?.seatTag}
              onChange={seatTag => onChange({ pov: activePov, seatTag })}
            />
          )}
          <p className="oped-field-hint">Applies to one voice; the others write for their whole camp.</p>
        </>
      )}
    </div>
  );
}

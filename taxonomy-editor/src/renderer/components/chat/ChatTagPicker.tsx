// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { checkTagScope } from '@lib/debate/relevanceSelection';
import type { SeatTag, TagMode } from '@lib/debate/types/session';
import { loadPovTagRegistry, type PovTagRegistry } from '@lib/schema/povTags';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { SpeakerId } from '../../types/debate';
import './ChatTagPicker.css';

type ChatPov = Exclude<SpeakerId, 'user'>;

/** Registry label for a POV's tag, or `undefined` if the tag isn't registered for that POV. */
export function seatTagLabel(pov: ChatPov, tag: string | undefined, registry: PovTagRegistry): string | undefined {
  if (!tag) return undefined;
  return registry.povs[pov]?.find((t) => t.id === tag)?.label;
}

interface ChatTagPickerProps {
  pov: ChatPov;
  seatTag: SeatTag | undefined;
  onChange: (tag: SeatTag | undefined) => void;
}

/** POV tag + Scope/Prioritize picker for chat setup (t/3959; spec §4). Renders nothing when the
 *  registry has no tags for `pov` — tag souls ship per-POV, so an untagged POV shows no picker. */
export function ChatTagPicker({ pov, seatTag, onChange }: ChatTagPickerProps) {
  const entries = loadPovTagRegistry().povs[pov] ?? [];
  if (entries.length === 0) return null;

  const povNodes = useTaxonomyStore.getState()[pov]?.nodes ?? [];
  const scope = seatTag ? checkTagScope(povNodes, { tag: seatTag.pov_tag, mode: seatTag.tag_mode }) : null;

  const handleTagChange = (tagId: string) => {
    if (!tagId) { onChange(undefined); return; }
    onChange({ pov_tag: tagId, tag_mode: seatTag?.tag_mode ?? 'scope' });
  };

  const handleModeChange = (mode: TagMode) => {
    if (!seatTag) return;
    onChange({ ...seatTag, tag_mode: mode });
  };

  return (
    <div className="chat-tag-picker">
      <select
        className="chat-tag-picker-select"
        value={seatTag?.pov_tag ?? ''}
        onChange={(e) => handleTagChange(e.target.value)}
        aria-label={`${pov} tag`}
      >
        <option value="">None</option>
        {entries.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      {seatTag && (
        <div className="chat-tag-picker-mode">
          <label>
            <input
              type="radio"
              name={`${pov}-tag-mode`}
              checked={seatTag.tag_mode === 'scope'}
              onChange={() => handleModeChange('scope')}
            />
            Scope
          </label>
          <label>
            <input
              type="radio"
              name={`${pov}-tag-mode`}
              checked={seatTag.tag_mode === 'prioritize'}
              onChange={() => handleModeChange('prioritize')}
            />
            Prioritize
          </label>
        </div>
      )}
      {scope && seatTag?.tag_mode === 'scope' && (
        <div className={`chat-tag-picker-scope${scope.sufficient ? '' : ' insufficient'}`}>
          {scope.inScope.length} in scope, {scope.excluded.length} untagged
          {!scope.sufficient && ' — below the minimum (5); pick a different tag or use Prioritize'}
        </div>
      )}
    </div>
  );
}

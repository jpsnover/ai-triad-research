// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { loadPovTagRegistry, type PovTagRegistry } from '@lib/schema/povTags';
import './PovTagEditor.css';

/** A node's tags as a list. Absent means untagged; a PowerShell-unrolled scalar is read as its one tag, so
 *  editing writes it back as a proper array. */
function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string');
  return typeof value === 'string' ? [value] : [];
}

/**
 * POV tags on a node (t/3961; PI decision 6: editors add/remove tags; tags themselves are configuration,
 * so the picker offers only registry tags and there is no "create tag"). A tag the registry no longer has
 * shows as an orphan chip that can be removed. Writes go through the normal save path, whose gate blocks
 * only an unregistered tag being ADDED (utils/povTagGate.ts).
 */
export function PovTagEditor({ pov, tags, readOnly, error, onChange, registry = loadPovTagRegistry() }: {
  pov: string;
  tags: unknown;
  readOnly: boolean;
  error?: string;
  /** The new tag list; undefined when the last tag is removed (absent = untagged, the smallest diff). */
  onChange: (next: string[] | undefined) => void;
  registry?: PovTagRegistry;
}) {
  const registered = registry.povs[pov as keyof PovTagRegistry['povs']] ?? [];
  const current = tagsOf(tags);
  if (registered.length === 0 && current.length === 0) return null;

  const labelOf = (id: string) => registered.find(t => t.id === id)?.label;
  const addable = registered.filter(t => !current.includes(t.id));
  const remove = (id: string) => {
    const next = current.filter(t => t !== id);
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div className="pov-tag-editor" aria-label="POV tags">
      <span className="pov-tag-editor-title">POV tags</span>
      <div className="pov-tag-editor-chips">
        {current.length === 0 && <span className="pov-tag-editor-empty">Untagged</span>}
        {current.map(id => {
          const label = labelOf(id);
          return (
            <span key={id} className={label ? 'pov-tag-chip' : 'pov-tag-chip pov-tag-chip-orphan'} title={label ? id : 'Not in the tag registry'}>
              {label ?? `${id} (not in registry)`}
              {!readOnly && (
                <button type="button" className="pov-tag-chip-remove" onClick={() => remove(id)} aria-label={`Remove tag ${label ?? id}`}>×</button>
              )}
            </span>
          );
        })}
        {!readOnly && addable.length > 0 && (
          <select
            className="pov-tag-editor-add"
            value=""
            onChange={(e) => { if (e.target.value) onChange([...current, e.target.value]); }}
            aria-label="Add POV tag"
          >
            <option value="">Add tag…</option>
            {addable.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
      </div>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

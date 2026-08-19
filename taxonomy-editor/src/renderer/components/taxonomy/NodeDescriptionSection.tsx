// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// DescriptionSection — the Content tab's Description block, extracted verbatim from
// NodeDetail.tsx (ADR-007 file-size ceiling; t/2811/t/2812). Pure move: identical props,
// exports, and behavior. Owns the search-highlight + Formal/Plain tab logic for the
// node description field.

import type { Pov, PovNode, Category } from '../../types/taxonomy';
import type { MentionSegment } from '../shared/mentionText';
import type { EntityRef } from '@lib/entities/types';
import { usePreferencesStore } from '../../store/preferencesStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { buildSearchRegex } from '../../utils/searchRegex';
import { FieldHelp } from '../shared/FieldHelp';
import { DescriptionToggle } from '../shared/DescriptionToggle';
import { HighlightedTextarea } from '../shared/HighlightedField';
import { triggerPovNodeRegeneration } from '../../utils/regeneratePlainDescription';

const CATEGORY_SINGULAR: Record<Category, string> = {
  'Beliefs': 'A Belief',
  'Desires': 'A Desire',
  'Intentions': 'An Intention',
};

/** Entity-mention render segments for the read-only `description` field + their click handler (t/1908). */
export interface DescriptionMention {
  segments: readonly MentionSegment[];
  onSelectRef: (ref: EntityRef) => void;
}

export interface DescriptionSectionProps {
  pov: Pov;
  node: PovNode;
  readOnly?: boolean;
  err: (field: string) => string | undefined;
  descMode: 'formal' | 'plain';
  setDescMode: (mode: 'formal' | 'plain') => void;
  maybeRegenAphorism: () => void;
  update: (updates: Partial<PovNode>) => void;
  updatePovNode: (pov: Pov, id: string, updates: Partial<PovNode>) => void;
  /** Mention segments for the formal `description` HighlightedTextarea (t/1908); undefined = no links. */
  descriptionMention?: DescriptionMention;
  /** t/2811: mention segments for the plain_description read-only highlight path; undefined = no links. */
  plainDescriptionMention?: DescriptionMention;
}

export function DescriptionSection({ pov, node, readOnly, err, descMode, setDescMode, maybeRegenAphorism, update, updatePovNode, descriptionMention, plainDescriptionMention }: DescriptionSectionProps) {
  const viewMode = usePreferencesStore(state => state.viewMode);
  const { findQuery, findMode, findCaseSensitive } = useTaxonomyStore();
  // t/2812: a search match in Formal-but-not-Plain surfaces the Formal tab (even under Simple
  // View); empty query restores the global pref. Fresh regex per test → no /g lastIndex carry.
  const matchIn = (t: string) => !!findQuery && (buildSearchRegex(findQuery, findMode, findCaseSensitive)?.test(t) ?? false);
  const baseDescMode: 'formal' | 'plain' = viewMode === 'simple' ? 'plain' : descMode;
  const effectiveDescMode: 'formal' | 'plain' =
    baseDescMode === 'plain' && matchIn(node.description ?? '') && !matchIn(node.plain_description ?? '') ? 'formal' : baseDescMode;
  return (
    <div className={`form-group ${err('description') ? 'has-error' : ''}`}>
      <div className="description-header">
        <label>
          Description
          <FieldHelp text={`Genus-differentia format:\n"${CATEGORY_SINGULAR[node.category]} within [POV] discourse that [differentia].\nEncompasses: ...\nExcludes: ..."\nEncompasses and Excludes must each start on a new line.`} />
        </label>
        {viewMode === 'advanced' && <DescriptionToggle mode={descMode} onToggle={setDescMode} hasPlainDescription={!!node.plain_description} />}
      </div>
      {effectiveDescMode === 'formal' ? (
        <div className="prose" onBlur={maybeRegenAphorism}>
          <HighlightedTextarea
            value={node.description}
            onChange={(v) => update({ description: v })}
            rows={6}
            readOnly={readOnly}
            mentionSegments={descriptionMention?.segments}
            onSelectRef={descriptionMention?.onSelectRef}
          />
          {err('description') && <div className="error-text">{err('description')}</div>}
        </div>
      ) : (
        <>
          {node.plain_description === null ? (
            <div className="plain-description-box plain-description-generating">Regenerating…</div>
          ) : (
            <div className="plain-description-box">
              {/* t/2811: readOnly view highlights search matches + keeps mention links (Formal
                  already did via HighlightedTextarea). Segments follow the shown field. */}
              {readOnly ? (
                <HighlightedTextarea
                  value={node.plain_description ?? node.description}
                  readOnly
                  mentionSegments={(node.plain_description ? plainDescriptionMention : descriptionMention)?.segments}
                  onSelectRef={(node.plain_description ? plainDescriptionMention : descriptionMention)?.onSelectRef}
                />
              ) : (node.plain_description ?? node.description)}
            </div>
          )}
          {!readOnly && (
            <button
              type="button"
              className="plain-description-regen"
              disabled={node.plain_description === null}
              onClick={() => triggerPovNodeRegeneration(pov, node.id, node.description, updatePovNode)}
            >
              ↻ Regenerate
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// POV-tag filter for the taxonomy node list (t/3961; spec §2 and §7). Pure; the registry is injectable
// for tests (the committed one is empty until t/3956).

import { loadPovTagRegistry, type PovTagRegistry } from '@lib/schema/povTags';

/** 'all', 'untagged', or `tag:<id>` (a tag registered for this POV). */
export type PovTagFilter = 'all' | 'untagged' | `tag:${string}`;

export interface PovTagFilterOption {
  value: PovTagFilter;
  label: string;
}

/** True when a node's pov_tags (absent or [] means untagged) contains the tag. Tolerates a malformed scalar. */
function tagsOf(node: { pov_tags?: unknown }): string[] {
  const t = node.pov_tags;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : typeof t === 'string' ? [t] : [];
}

export function filterByPovTag<T extends { pov_tags?: unknown }>(nodes: readonly T[], filter: PovTagFilter): T[] {
  if (filter === 'all') return [...nodes];
  if (filter === 'untagged') return nodes.filter(n => tagsOf(n).length === 0);
  const tag = filter.slice('tag:'.length);
  return nodes.filter(n => tagsOf(n).includes(tag));
}

/** Filter options for a POV: All, Untagged, then each registry tag. Empty when the POV has no tags, so
 *  the control can hide itself (every POV until t/3956 lands the first tags). */
export function povTagFilterOptions(pov: string, registry: PovTagRegistry = loadPovTagRegistry()): PovTagFilterOption[] {
  const tags = registry.povs[pov as keyof PovTagRegistry['povs']] ?? [];
  if (tags.length === 0) return [];
  return [
    { value: 'all', label: 'Tags: All' },
    { value: 'untagged', label: 'Tags: Untagged' },
    ...tags.map(t => ({ value: `tag:${t.id}` as PovTagFilter, label: `Tag: ${t.label}` })),
  ];
}

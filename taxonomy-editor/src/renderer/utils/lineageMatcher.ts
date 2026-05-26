// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Lineage name matcher — detects intellectual lineage references in debate text
// and replaces them with styled React elements showing L1/L2 category tooltips.
//
// Performance: builds a single compiled regex from ~1000 lineage names (sorted
// longest-first). The regex and lookup table are cached — lineage names don't
// change during a debate session.

import React from 'react';
import { getLineageMapping, getL2Categories, isLineageDataLoaded } from '../data/lineageCategories';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

let cachedRegex: RegExp | null = null;
let cachedLookup: Map<string, { name: string; l1: string; l2: string; l2Label: string }> | null = null;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function invalidateLineageMatcherCache(): void {
  cachedRegex = null;
  cachedLookup = null;
}

function getMatcher(): { regex: RegExp; lookup: Map<string, { name: string; l1: string; l2: string; l2Label: string }> } | null {
  if (cachedRegex && cachedLookup) return { regex: cachedRegex, lookup: cachedLookup };
  if (!isLineageDataLoaded()) return null;

  const mapping = getLineageMapping();
  const l2Cats = getL2Categories();
  const l2LabelMap = new Map(l2Cats.map(c => [c.id, c.label]));

  // Filter to matchable names: 4-60 chars, no parens/commas (those are disambiguation qualifiers)
  const names = Object.keys(mapping)
    .filter(k => k.length >= 4 && k.length <= 60 && !k.includes('(') && !k.includes(','));

  if (names.length === 0) return null;

  // Build case-insensitive lookup
  const lookup = new Map<string, { name: string; l1: string; l2: string; l2Label: string }>();
  for (const name of names) {
    const info = mapping[name];
    lookup.set(name.toLowerCase(), {
      name,
      l1: info.l1,
      l2: info.l2,
      l2Label: l2LabelMap.get(info.l2) ?? info.l2,
    });
  }

  // Sort longest-first — prevents shorter matches eating longer ones in regex alternation
  names.sort((a, b) => b.length - a.length);

  const pattern = names.map(n => `\\b${escapeRegex(n)}\\b`).join('|');
  cachedRegex = new RegExp(pattern, 'gi');
  cachedLookup = lookup;
  return { regex: cachedRegex, lookup: cachedLookup };
}

/**
 * Replace lineage name matches in a plain text string with styled React elements.
 */
function linkifyText(text: string, keyPrefix: string): React.ReactNode {
  const matcher = getMatcher();
  if (!matcher) return text;

  const { regex, lookup } = matcher;
  regex.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchCount = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const matchedText = match[0];
    const info = lookup.get(matchedText.toLowerCase());

    const lineageName = info?.name ?? matchedText;
    // Show L2 qualifier for short/common terms to disambiguate
    const showQualifier = info?.l2Label && matchedText.length <= 20;
    const displayContent = showQualifier
      ? [matchedText, React.createElement('span', { key: 'q', className: 'lineage-link-qualifier' }, ` (${info!.l2Label})`)]
      : matchedText;
    parts.push(
      React.createElement('a', {
        key: `${keyPrefix}-${matchCount++}`,
        className: 'lineage-link',
        href: '#',
        'data-lineage-name': lineageName,
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          useTaxonomyStore.getState().navigateToLineage(lineageName);
        },
      }, ...(Array.isArray(displayContent) ? displayContent : [displayContent])),
    );
    lastIndex = regex.lastIndex;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return React.createElement(React.Fragment, null, ...parts);
}

// Elements whose children should NOT be processed (already interactive or literal)
const SKIP_ELEMENTS = new Set(['code', 'pre', 'a', 'script', 'style']);

/**
 * Recursively process React children, replacing text nodes with lineage-linked versions.
 * Call this inside react-markdown's `components` prop overrides.
 */
export function injectLineageLinks(children: React.ReactNode, keyPrefix = 'lg'): React.ReactNode {
  if (!isLineageDataLoaded()) return children;

  return React.Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      return linkifyText(child, `${keyPrefix}-${i}`);
    }
    if (typeof child === 'number') {
      return linkifyText(String(child), `${keyPrefix}-${i}`);
    }
    if (!React.isValidElement(child)) return child;

    // Skip processing inside code/pre/a elements
    const elementType = typeof child.type === 'string' ? child.type : '';
    if (SKIP_ELEMENTS.has(elementType)) return child;

    // Recursively process children of this element
    const props = child.props as Record<string, unknown>;
    if (props.children != null) {
      return React.cloneElement(
        child,
        {},
        injectLineageLinks(props.children as React.ReactNode, `${keyPrefix}-${i}`),
      );
    }
    return child;
  });
}

/**
 * react-markdown `components` overrides that inject lineage links into block elements.
 * Defined as a stable object — safe to pass directly without useMemo.
 */
export const lineageMarkdownComponents: Record<string, React.ComponentType<{ children?: React.ReactNode; node?: unknown }>> = {
  p: ({ children, node: _, ...props }) => React.createElement('p', props, injectLineageLinks(children)),
  li: ({ children, node: _, ...props }) => React.createElement('li', props, injectLineageLinks(children)),
  td: ({ children, node: _, ...props }) => React.createElement('td', props, injectLineageLinks(children)),
  blockquote: ({ children, node: _, ...props }) => React.createElement('blockquote', props, injectLineageLinks(children)),
};

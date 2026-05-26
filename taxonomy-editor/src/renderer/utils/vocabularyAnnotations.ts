// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Vocabulary term annotation — detects disambiguated colloquial terms in debate
// text and wraps them with styled React elements showing canonical form tooltips.
//
// Pattern mirrors lineageMatcher.ts: process React children from react-markdown,
// replace text node matches with annotated spans.

import React from 'react';
import { injectLineageLinks } from './lineageMatcher';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

export interface VocabResolution {
  colloquial: string;
  canonical: string;
  confidence: string;
  offset?: number;
}

/**
 * Build a matcher for vocabulary terms from resolution data.
 * Groups by colloquial term (deduplicates — same term always resolves to same canonical per speaker).
 */
function buildVocabMatcher(resolutions: VocabResolution[]): {
  regex: RegExp;
  lookup: Map<string, { colloquial: string; canonical: string; confidence: string }>;
} | null {
  if (resolutions.length === 0) return null;

  // Deduplicate by colloquial term (all occurrences resolve the same way per speaker)
  const lookup = new Map<string, { colloquial: string; canonical: string; confidence: string }>();
  for (const r of resolutions) {
    const key = r.colloquial.toLowerCase();
    if (!lookup.has(key)) {
      lookup.set(key, { colloquial: r.colloquial, canonical: r.canonical, confidence: r.confidence });
    }
  }

  // Build regex — sort longest-first to prevent partial matches
  const terms = [...lookup.keys()].sort((a, b) => b.length - a.length);
  const pattern = terms.map(t => `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).join('|');
  return { regex: new RegExp(pattern, 'gi'), lookup };
}

// Elements whose children should NOT be processed
const SKIP_ELEMENTS = new Set(['code', 'pre', 'a', 'script', 'style']);

function linkifyVocabText(
  text: string,
  matcher: { regex: RegExp; lookup: Map<string, { colloquial: string; canonical: string; confidence: string }> },
  keyPrefix: string,
): React.ReactNode {
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

    const canonical = info?.canonical;
    parts.push(
      React.createElement('a', {
        key: `${keyPrefix}-v${matchCount++}`,
        className: `vocab-term vocab-confidence-${info?.confidence ?? 'medium'}`,
        href: '#',
        'data-vocab-colloquial': info?.colloquial ?? matchedText,
        'data-vocab-canonical': canonical,
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          if (canonical) {
            useTaxonomyStore.getState().navigateToLineage(canonical);
          }
        },
      }, matchedText),
    );
    lastIndex = regex.lastIndex;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return React.createElement(React.Fragment, null, ...parts);
}

/**
 * Recursively process React children, replacing text nodes with vocabulary-annotated versions.
 */
function injectVocabLinks(
  children: React.ReactNode,
  matcher: { regex: RegExp; lookup: Map<string, { colloquial: string; canonical: string; confidence: string }> },
  keyPrefix = 'vb',
): React.ReactNode {
  return React.Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      return linkifyVocabText(child, matcher, `${keyPrefix}-${i}`);
    }
    if (typeof child === 'number') {
      return linkifyVocabText(String(child), matcher, `${keyPrefix}-${i}`);
    }
    if (!React.isValidElement(child)) return child;

    const elementType = typeof child.type === 'string' ? child.type : '';
    if (SKIP_ELEMENTS.has(elementType)) return child;

    const props = child.props as Record<string, unknown>;
    if (props.children != null) {
      return React.cloneElement(
        child,
        {},
        injectVocabLinks(props.children as React.ReactNode, matcher, `${keyPrefix}-${i}`),
      );
    }
    return child;
  });
}

/**
 * Create react-markdown `components` overrides that inject both vocabulary
 * annotations and lineage links. Vocabulary runs first (inner), lineage second (outer).
 *
 * Returns the static lineageMarkdownComponents if no vocab resolutions provided.
 */
export function getDebateMarkdownComponents(
  vocabResolutions: VocabResolution[] | null | undefined,
): Record<string, React.ComponentType<{ children?: React.ReactNode; node?: unknown }>> {
  const matcher = vocabResolutions && vocabResolutions.length > 0
    ? buildVocabMatcher(vocabResolutions)
    : null;

  if (!matcher) {
    // No vocab data — import and return static lineage-only components
    // (inline to avoid circular dependency at module level)
    return {
      p: ({ children, node: _, ...props }) => React.createElement('p', props, injectLineageLinks(children)),
      li: ({ children, node: _, ...props }) => React.createElement('li', props, injectLineageLinks(children)),
      td: ({ children, node: _, ...props }) => React.createElement('td', props, injectLineageLinks(children)),
      blockquote: ({ children, node: _, ...props }) => React.createElement('blockquote', props, injectLineageLinks(children)),
    };
  }

  // Chain: vocab first, then lineage
  const inject = (children: React.ReactNode) => injectLineageLinks(injectVocabLinks(children, matcher));

  return {
    p: ({ children, node: _, ...props }) => React.createElement('p', props, inject(children)),
    li: ({ children, node: _, ...props }) => React.createElement('li', props, inject(children)),
    td: ({ children, node: _, ...props }) => React.createElement('td', props, inject(children)),
    blockquote: ({ children, node: _, ...props }) => React.createElement('blockquote', props, inject(children)),
  };
}

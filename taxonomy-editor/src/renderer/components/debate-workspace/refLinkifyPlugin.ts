// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Parent } from 'mdast';
import type { Plugin } from 'unified';
import { scanRefs } from '@lib/entities/scanRefs';
import type { EntityRefKind } from '@lib/entities/types';

/**
 * v1 render-boundary kind filter (t/1776): the shared `scanRefs` detects ALL six
 * EntityRef kinds, but only these are linkifiable in the transcript today —
 * `entity`/`organization`/`term` are the t/1767 entity/vocab layer (not resolvable
 * as ID tokens here). Widening later is a filter change, not a scanner change.
 */
const LINKABLE_KINDS: ReadonlySet<EntityRefKind> = new Set(['node', 'situation', 'policy']);

/** Marker class the StatementCard `span` md-component keys on to render a clickable ref. */
export const REF_LINK_CLASS = 'ref-link';

/**
 * Remark plugin: detects ID-token references (`{pov}-{cat}-NNN`, `sit-*`/`cc-*`,
 * `pol-*`) in markdown text via the shared `scanRefs` util and wraps each hit in a
 * `<span class="ref-link" data-ref-kind="…">` node — the display text is the raw
 * source token (no rewrite). A `span` md-component turns these into selectable
 * buttons that open the shared DetailPane.
 *
 * Sibling to `utils/colorizePovPlugin`'s `remarkColorizePov`; composes into the same
 * `remarkPlugins` pipeline. Visits `text` nodes only, so code / inline-code (whose
 * content isn't a child text node) is never linkified. Text already inside a link
 * is skipped to avoid nested anchors.
 */
export const remarkLinkifyRefs: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'text', (node, index, parent) => {
    if (index == null || !parent) return;
    // Never linkify inside an existing link → no nested interactive elements.
    if ((parent as { type?: string }).type === 'link') return;

    const value = (node as Text).value;
    // scanRefs returns non-overlapping, leftmost, maximal spans (t/1814 contract).
    const spans = scanRefs(value).filter(s => LINKABLE_KINDS.has(s.ref.kind));
    if (spans.length === 0) return;

    const parts: object[] = [];
    let last = 0;
    for (const span of spans) {
      if (span.start > last) parts.push({ type: 'text', value: value.slice(last, span.start) });
      parts.push({
        type: 'refLink',
        data: {
          hName: 'span',
          hProperties: { className: REF_LINK_CLASS, 'data-ref-kind': span.ref.kind },
        },
        // Display text = the raw source token, verbatim (fidelity).
        children: [{ type: 'text', value: span.raw }],
      });
      last = span.end;
    }
    if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });

    (parent as unknown as Parent).children.splice(index, 1, ...(parts as Parameters<typeof Array.prototype.splice>[2][]));
    return [SKIP, index + parts.length] as const;
  });
};

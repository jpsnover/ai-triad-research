// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Parent } from 'mdast';
import type { Plugin } from 'unified';
import { scanRefs } from '@lib/entities/scanRefs';
import type { EntityRefKind } from '@lib/entities/types';
import './refLinkifyPlugin.css'; // single home for `.ref-link` (t/1907) — any plugin surface gets the styling automatically

/**
 * Render-boundary kind filter: the shared `scanRefs` detects ALL six EntityRef kinds,
 * and all six now linkify — the entity/vocab layer (`entity`/`organization`/`term`)
 * resolves through the DetailPane's `EntityDetail` / org / term branches (t/1882 §4.1).
 * `term` opens a Phase-1.5 fallback until its rich renderer lands (§6). The set is kept
 * explicit so a future non-linkable kind can be excluded without a scanner change.
 */
const LINKABLE_KINDS: ReadonlySet<EntityRefKind> = new Set(['node', 'situation', 'policy', 'entity', 'organization', 'term']);

/** Marker class the consuming surface's `span` md-component keys on to render a clickable ref. */
export const REF_LINK_CLASS = 'ref-link';

/**
 * Remark plugin: detects ID-token references (`{pov}-{cat}-NNN`, `sit-*`/`cc-*`,
 * `pol-*`) in markdown text via the shared `scanRefs` util and wraps each hit in a
 * `<span class="ref-link" data-ref-kind="…">` node — the display text is the raw
 * source token (no rewrite). A `span` md-component turns these into selectable
 * buttons that open the shared DetailPane.
 *
 * Surface-agnostic (t/1870): no store, handler, or debate coupling — each consuming
 * surface (debate transcript, chat) supplies only its own `span` md-component that
 * wires the marker's click to that surface's selection handler.
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

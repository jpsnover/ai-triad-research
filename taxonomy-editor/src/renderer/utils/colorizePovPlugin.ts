// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './colorizePov.css';
import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Parent } from 'mdast';
import type { Plugin } from 'unified';

const POV_CLASSES: Record<string, string> = {
  accelerationist: 'pov-acc',
  safetyist: 'pov-saf',
  skeptic: 'pov-skp',
};

const POV_RE = /(Accelerationist|Safetyist|Skeptic)/gi;

/**
 * Remark plugin: wraps POV camp names in <span class="pov-name pov-{acc|saf|skp}">
 * wherever they appear in markdown text. CSS in styles.css applies the camp colors.
 * Skips code blocks and inline code.
 */
export const remarkColorizePov: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'text', (node, index, parent) => {
    if (index == null || !parent) return;

    POV_RE.lastIndex = 0;
    if (!POV_RE.test((node as Text).value)) return;
    POV_RE.lastIndex = 0;

    // Walk up to skip text inside code blocks — parent types 'code' and 'inlineCode'
    // are not 'text', so this visitor is never called inside them.

    const value = (node as Text).value;
    const parts: object[] = [];
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = POV_RE.exec(value)) !== null) {
      if (m.index > last) {
        parts.push({ type: 'text', value: value.slice(last, m.index) });
      }
      const cssClass = POV_CLASSES[m[0].toLowerCase()];
      parts.push({
        type: 'povName',
        data: {
          hName: 'span',
          hProperties: { className: `pov-name ${cssClass}` },
        },
        children: [{ type: 'text', value: m[0] }],
      });
      last = m.index + m[0].length;
    }
    if (last < value.length) {
      parts.push({ type: 'text', value: value.slice(last) });
    }

    (parent as unknown as Parent).children.splice(index, 1, ...(parts as Parameters<typeof Array.prototype.splice>[2][]));
    return [SKIP, index + parts.length] as const;
  });
};

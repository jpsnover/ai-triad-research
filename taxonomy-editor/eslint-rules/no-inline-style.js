// Custom ESLint rule: warn on JSX `style` prop usage.
// Inline styles bypass the theme system and design tokens. New code should use
// CSS classes with token variables. Existing violations are not auto-fixed —
// they get hoisted per-file as later design-elevation phases touch each file.

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Discourage inline style={{}} on JSX elements — use CSS classes with design tokens instead',
    },
    messages: {
      noInlineStyle:
        'Inline `style` prop bypasses design tokens and theming. ' +
        'Use a CSS class with token variables instead, or disable with ' +
        '/* eslint-disable-next-line local/no-inline-style -- reason */.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === 'style'
        ) {
          context.report({ node, messageId: 'noInlineStyle' });
        }
      },
    };
  },
};

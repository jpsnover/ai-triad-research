// Custom ESLint rule: every catch block must call getGlobalRecorder()?.record()
// or have an explicit silence comment: /* telemetry — silent by design */
// or /* flight recorder init */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require flight recorder instrumentation in catch blocks',
    },
    messages: {
      missingRecorder:
        'Catch block missing flight recorder call. Add getGlobalRecorder()?.record({...}) or /* telemetry — silent by design */ comment.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        const source = context.sourceCode.getText(node.body);
        if (source.includes('getGlobalRecorder')) return;
        if (source.includes('silent by design')) return;
        if (source.includes('flight recorder init')) return;
        context.report({ node, messageId: 'missingRecorder' });
      },
    };
  },
};

// Custom ESLint rule: every catch block must record errors.
// Renderer: getGlobalRecorder()?.record(...)
// Server/main: log.*.warn/error(...) (structured logger)
// Explicit silence: /* telemetry — silent by design */ or /* flight recorder init */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require error recording in catch blocks (flight recorder or structured logger)',
    },
    messages: {
      missingRecorder:
        'Catch block missing error recording. Use getGlobalRecorder()?.record({...}) (renderer) or log.*.warn/error() (server/main), or add /* telemetry — silent by design */ comment.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        const source = context.sourceCode.getText(node.body);
        if (source.includes('getGlobalRecorder')) return;
        if (/\blog\.\w+\.\w+/.test(source)) return;
        if (source.includes('silent by design')) return;
        if (source.includes('flight recorder init')) return;
        context.report({ node, messageId: 'missingRecorder' });
      },
    };
  },
};

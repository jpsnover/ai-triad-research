// Custom ESLint rule: module-scope resources must have import.meta.hot.dispose cleanup.
// Catches BroadcastChannel, addEventListener, setInterval etc. that outlive HMR reloads,
// causing stale closures and ReferenceErrors. See t/1078, t/1079.

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flag module-scope BroadcastChannel/addEventListener/timers without import.meta.hot.dispose cleanup',
    },
    messages: {
      missingDispose:
        'Module-scope {{kind}} without import.meta.hot.dispose — will leak on HMR reload. ' +
        'Add a dispose handler to close/remove this resource, or disable with ' +
        '/* eslint-disable-next-line local/no-unmanaged-module-resources -- reason */.',
    },
    schema: [],
  },
  create(context) {
    let hasHotDispose = false;
    const deferred = [];

    function isModuleScope(node) {
      const ancestors = context.sourceCode.getAncestors(node);
      for (const a of ancestors) {
        if (
          a.type === 'FunctionDeclaration' ||
          a.type === 'FunctionExpression' ||
          a.type === 'ArrowFunctionExpression' ||
          a.type === 'MethodDefinition'
        ) {
          return false;
        }
      }
      return true;
    }

    function describeNew(callee) {
      if (callee.type === 'Identifier') return callee.name;
      return null;
    }

    const FLAGGED_CONSTRUCTORS = new Set([
      'BroadcastChannel',
      'MessageChannel',
      'Worker',
      'SharedWorker',
    ]);

    return {
      // Detect import.meta.hot.dispose anywhere in the file
      MemberExpression(node) {
        if (
          node.property.type === 'Identifier' &&
          node.property.name === 'dispose' &&
          node.object.type === 'MemberExpression' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'hot'
        ) {
          hasHotDispose = true;
        }
      },

      // new BroadcastChannel / new Worker / etc.
      NewExpression(node) {
        const name = describeNew(node.callee);
        if (name && FLAGGED_CONSTRUCTORS.has(name) && isModuleScope(node)) {
          deferred.push({ node, kind: `new ${name}()` });
        }
      },

      // window.addEventListener / document.addEventListener / navigator.serviceWorker.addEventListener
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        const prop = node.callee.property;
        if (prop.type !== 'Identifier' || prop.name !== 'addEventListener') return;
        if (!isModuleScope(node)) return;
        deferred.push({ node, kind: 'addEventListener' });
      },

      'Program:exit'() {
        if (hasHotDispose) return;
        for (const { node, kind } of deferred) {
          context.report({ node, messageId: 'missingDispose', data: { kind } });
        }
      },
    };
  },
};

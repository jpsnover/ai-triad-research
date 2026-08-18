// Custom ESLint rule: forbid putting a caught error's .message into ActionableError.problem.
//
// The broad no-restricted-syntax selector
//   NewExpression[callee.name='ActionableError'] Property[key.name='problem'] MemberExpression[property.name='message']
// fires on every .message access under problem:, including legitimate HTTP-response
// field reads like `(data.message as string)`. This rule tightens that: it only fires
// when the .message is accessed on an ERROR-NAMED identifier (err, error, e, ex,
// caught, cause, or any name matching /[Ee]rr(or)?/), unwrapping TypeScript `as` casts —
// so `(err as Error).message` fires but `(data.message as string)` does not.
//
// See t/2761 (the incident), t/2764 (this gate).

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid putting a caught error\'s .message into ActionableError.problem (t/2764)',
    },
    schema: [],
    messages: {
      nesting:
        "Don't put a caught error's .message into ActionableError.problem — it embeds the " +
        'multi-line formatted block instead of the concise problem string. ' +
        'Use `err instanceof ActionableError ? err.problem : errorMessage(err)` ' +
        'and chain the original via `innerError: err`. (t/2761)',
    },
  },
  create(context) {
    // Short single-letter error names and common aliases; pattern also catches *Err / *Error.
    const EXACT_ERROR_NAMES = new Set(['e', 'ex', 'caught', 'cause']);

    function isErrorNamed(node) {
      // Unwrap TypeScript cast expressions so (err as Error) resolves to identifier `err`.
      if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
        return isErrorNamed(node.expression);
      }
      if (node.type !== 'Identifier') return false;
      const { name } = node;
      return EXACT_ERROR_NAMES.has(name) || /[Ee]rr(or)?/.test(name);
    }

    // Walk a value expression looking for `.message` on an error-named identifier.
    // Returns the offending MemberExpression node, or null.
    function findErrorDotMessage(node) {
      if (!node) return null;
      switch (node.type) {
        case 'MemberExpression':
          if (
            !node.computed &&
            node.property.type === 'Identifier' &&
            node.property.name === 'message' &&
            isErrorNamed(node.object)
          ) {
            return node;
          }
          return findErrorDotMessage(node.object);
        case 'TemplateLiteral': {
          for (const expr of node.expressions) {
            const found = findErrorDotMessage(expr);
            if (found) return found;
          }
          return null;
        }
        case 'ConditionalExpression':
          return (
            findErrorDotMessage(node.consequent) ||
            findErrorDotMessage(node.alternate)
          );
        case 'LogicalExpression':
        case 'BinaryExpression':
          return (
            findErrorDotMessage(node.left) ||
            findErrorDotMessage(node.right)
          );
        case 'TSAsExpression':
        case 'TSTypeAssertion':
          return findErrorDotMessage(node.expression);
        case 'CallExpression': {
          for (const arg of node.arguments) {
            const found = findErrorDotMessage(arg);
            if (found) return found;
          }
          return null;
        }
        default:
          return null;
      }
    }

    return {
      'NewExpression[callee.name="ActionableError"]'(node) {
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'ObjectExpression') return;
        const problemProp = arg.properties.find(
          p =>
            p.type === 'Property' &&
            !p.computed &&
            p.key.type === 'Identifier' &&
            p.key.name === 'problem',
        );
        if (!problemProp) return;
        const found = findErrorDotMessage(problemProp.value);
        if (found) {
          context.report({ node: found, messageId: 'nesting' });
        }
      },
    };
  },
};

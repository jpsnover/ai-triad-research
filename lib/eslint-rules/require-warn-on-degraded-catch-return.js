// Custom ESLint rule (t/3200, Fallback-Path Logging — follow-up to t/3169).
//
// A `catch` that returns a SILENT empty/no-data default (`[]` / `{}` / `null` / `undefined`) FROM A
// DATA/COMPUTE/IO PATH is a fallback by definition (the t/3165 genus: cache-miss→recompute,
// primary→secondary, retry-exhausted→default, ADR-001 graceful-empty), so it must record at WARN or
// ERROR stating what fell back and why. Info-level and the `/* silent by design */` escape-hatch do
// NOT satisfy it — those were the two gaps the base `require-flight-recorder-in-catch` rule left open
// (t/3169#2). The predicate is deliberately NARROW (TL t/3200 GV, p/342): boolean/number/string guard
// returns (`return false/0/''`) and NON-EMPTY / observable objects (`{ ok:false, reason }`, `{ error }`)
// are EXCLUDED — their failure is visible in the return shape, so it isn't silent. See isSilentEmptyReturn.
//
// This is a SEPARATE rule from the base one on purpose: ESLint severity is per-rule-id, so keeping
// the strict degraded-return check as its own rule lets it ship at `warn` (non-blocking visibility)
// while the base catch-recording gate stays at `error`, unchanged. Promotion to `error` is a
// separate, GV-gated step once the t/3169 cleanup lands the WARNs and the flagged count reaches zero
// (TL t/3200#2). The predicate is deliberately NARROW — a benign UI/local default (a synchronous
// `localStorage` miss → `[]` in a renderer hook) has no data/IO signal in its try block and is NOT
// flagged, which keeps the gate low-noise.

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
/**
 * Is this return argument a SILENT no-data/empty default — the ADR-001 graceful-empty class (TL
 * t/3200 GV predicate, p/342)? FLAG `[]` / `{}` / `null` / `undefined`: each is indistinguishable
 * from success-with-no-data, so a silent failure hides in an otherwise-normal return. EXCLUDE:
 *   - boolean/number/string guard returns (`return false` / `0` / `''`) — control-flow, not data;
 *   - NON-EMPTY / observable objects & arrays (`{ ok:false, reason }`, `{ error }`, `[x]`) — the
 *     failure is visible in the returned shape, so it is NOT silent.
 * Bare `return;` (implicit undefined) is deliberately NOT flagged: without type info it's
 * indistinguishable from a void function's early-exit control-flow (over-flag risk).
 */
function isSilentEmptyReturn(arg) {
  if (!arg) return false;                                          // bare `return;` — see above
  if (arg.type === 'ArrayExpression') return arg.elements.length === 0;    // [] only
  if (arg.type === 'ObjectExpression') return arg.properties.length === 0; // {} only
  if (arg.type === 'Literal') return arg.value === null;                   // null (not false/0/'')
  if (arg.type === 'Identifier') return arg.name === 'undefined';          // explicit `return undefined`
  return false;
}

// Data/compute/IO signal in the try block. localStorage/sessionStorage are deliberately EXCLUDED —
// a UI-local default is not the t/3165 class. False negatives (a helper that hides its IO behind a
// plain call) are the safe direction for a non-blocking gate; the error-flip tightens later.
const DATA_IO_SIGNAL_RE = /\b(await|fs|fsp|readFile|readFileSync|writeFile|writeFileSync|readdir|createReadStream|fetch|https?|axios|got|request|backend|readDataFile|writeDataFile|getBackend|db|query|pool|exec|execSync|spawn|embed|computeEmbedding|onnx)\b/;

/**
 * Does this subtree contain a SILENT empty/no-data return (`[]` / `{}` / `null` / `undefined` — see
 * {@link isSilentEmptyReturn}) that belongs to THIS catch (not inside a nested function, whose
 * returns are a different scope)? Descends control-flow blocks, stops at function boundaries.
 */
function containsDegradedReturn(node) {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'ReturnStatement') {
    return isSilentEmptyReturn(node.argument);
  }
  if (FUNCTION_TYPES.has(node.type)) return false;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c.type === 'string' && containsDegradedReturn(c)) return true;
      }
    } else if (child && typeof child.type === 'string') {
      if (containsDegradedReturn(child)) return true;
    }
  }
  return false;
}

/** WARN-or-higher recording present (either transport: `log.*.warn|error`, or a warn/error record()). */
function hasWarnOrErrorLogging(source) {
  if (/\blog\.\w+\.(warn|error)\b/.test(source)) return true;
  if (source.includes('getGlobalRecorder') && /\blevel\s*:\s*['"](warn|error)['"]/.test(source)) return true;
  return false;
}

/** Does the catch's corresponding try block show a data/compute/IO operation? */
function tryBlockHasDataIoSignal(catchNode, sourceCode) {
  const tryStmt = catchNode.parent;
  if (!tryStmt || tryStmt.type !== 'TryStatement' || !tryStmt.block) return false;
  return DATA_IO_SIGNAL_RE.test(sourceCode.getText(tryStmt.block));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A degraded-default return from a data/compute/IO catch must record at WARN or ERROR (Fallback-Path Logging)',
    },
    messages: {
      degradedReturnNeedsWarn:
        'Catch on a data/IO path returns a SILENT empty/no-data default ([] / {} / null / undefined) — that is a FALLBACK and must record at WARN or ERROR (getGlobalRecorder().record({ level: \'warn\' }) or log.*.warn/error()) stating what fell back and why. Info-level and the /* silent by design */ escape-hatch do NOT satisfy this. (Boolean/number/string guards and observable objects like {ok:false,reason} are excluded — not silent.) Fallback-Path Logging, t/3200/t/3169.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        if (
          containsDegradedReturn(node.body) &&
          tryBlockHasDataIoSignal(node, context.sourceCode) &&
          !hasWarnOrErrorLogging(context.sourceCode.getText(node.body))
        ) {
          context.report({ node, messageId: 'degradedReturnNeedsWarn' });
        }
      },
    };
  },
};

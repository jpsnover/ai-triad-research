// Custom ESLint rule: no raw fs read of a data-root path (t/3087 / t/3093).
//
// The May 14 GitHub API-First migration (dc8651b0) moved every data-root consumer behind
// StorageBackend except a raw fs read in loadEmbeddingsFile, which then silently read an empty
// cache for 3.5 months (t/3085). This rule turns "remember to migrate every caller" into a
// lint signal: flag a raw fs read (fs.readFile / fs.readFileSync / fs.promises.readFile) whose
// PATH ARGUMENT traces to a data-root resolver — resolveDataPath / getTaxonomyDir /
// getEmbeddingsPath / getDataRoot, including member forms like fileIO.getTaxonomyDir()
// (resolveDataPath(sub) === path.join(getDataRoot(), sub), config.ts, so getDataRoot is the base).
// Data-root reads must go through src/server/storage/readDataFile(), which carries the
// empty/missing-read guard.
//
// KNOWN LIMITATION (tripwire, not proof — green ≠ verified): catches inline reads and
// SAME-SCOPE const indirection, including transitive const → path.join(const, …) → const hops
// (the sources.ts:52 style). It does NOT follow CROSS-FUNCTION / cross-module wrapper
// indirection (e.g. `fs.readFile(makePath())` where makePath() is defined elsewhere) — that
// hole is closed by the t/3094 data-root-reader-location convention + review, not this rule.
// A new hit is a true positive requiring TL review before it is silenced.

const RESOLVERS = new Set(['resolveDataPath', 'getTaxonomyDir', 'getEmbeddingsPath', 'getDataRoot']);
const FS_OBJECTS = new Set(['fs', 'fsp', 'fsPromises']);
const PATH_JOINERS = new Set(['join', 'resolve', 'normalize']);
const MAX_HOPS = 6; // same-scope, bounded — not full data-flow

/** A data-root resolver call — bare `foo()` or member `obj.foo()` (e.g. fileIO.getTaxonomyDir()). */
function isResolverCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const c = node.callee;
  if (c.type === 'Identifier') return RESOLVERS.has(c.name);
  if (c.type === 'MemberExpression' && c.property.type === 'Identifier' && !c.computed) {
    return RESOLVERS.has(c.property.name);
  }
  return false;
}

/** A raw fs read: fs.readFile(Sync) / fsp.readFile(Sync) / fs.promises.readFile — NOT backend.readFile. */
function isFsReadCall(node) {
  const c = node.callee;
  if (c.type !== 'MemberExpression' || c.computed || c.property.type !== 'Identifier') return false;
  if (c.property.name !== 'readFile' && c.property.name !== 'readFileSync') return false;
  const obj = c.object;
  if (obj.type === 'Identifier') return FS_OBJECTS.has(obj.name);
  // fs.promises.readFile
  return obj.type === 'MemberExpression'
    && obj.object.type === 'Identifier' && obj.object.name === 'fs'
    && obj.property.type === 'Identifier' && obj.property.name === 'promises';
}

/** Find a variable binding by walking up the scope chain (same-scope + enclosing scopes). */
function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return null;
}

/** Does `node` (a path expression) trace to a data-root resolver within bounded same-scope hops? */
function tracesToResolver(node, scope, depth) {
  if (!node || depth > MAX_HOPS) return false;
  if (isResolverCall(node)) return true;
  // path.join(a, b, …) / path.resolve(…) — traces if ANY argument does
  if (node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && node.callee.object.type === 'Identifier' && node.callee.object.name === 'path'
      && node.callee.property.type === 'Identifier' && PATH_JOINERS.has(node.callee.property.name)) {
    return node.arguments.some((a) => tracesToResolver(a, scope, depth + 1));
  }
  // Array literal → any element tracing counts (a `candidates`-style path list).
  if (node.type === 'ArrayExpression') {
    return node.elements.some((el) => el && tracesToResolver(el, scope, depth + 1));
  }
  // Identifier → resolve to a same-scope `const` and follow its initializer, OR a
  // `for (const x of <array>)` loop variable → follow the iterated array (the server.ts:443
  // authorized-users pattern: `const candidates = [path.join(getDataRoot(), …)]; for (const p
  // of candidates) fs.readFileSync(p)`). Both are same-scope + bounded — still "light".
  if (node.type === 'Identifier') {
    const variable = findVariable(scope, node.name);
    if (!variable) return false;
    for (const def of variable.defs) {
      if (def.type !== 'Variable' || def.node.type !== 'VariableDeclarator') continue;
      const decl = def.parent; // the enclosing VariableDeclaration
      if (!decl || decl.kind !== 'const') continue;
      if (decl.parent && decl.parent.type === 'ForOfStatement' && decl.parent.left === decl) {
        if (tracesToResolver(decl.parent.right, scope, depth + 1)) return true;
      } else if (def.node.init && tracesToResolver(def.node.init, scope, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Flag a raw fs read whose path traces to a data-root resolver — route it through storage/readDataFile() (migration-remnant class, t/3085/t/3087)',
    },
    messages: {
      rawDataRootRead:
        'Raw fs read of a data-root path (its argument traces to a data-root resolver). Route it '
        + 'through src/server/storage/readDataFile() — the migration-remnant class that silently '
        + 'read an empty cache for 3.5 months (t/3085/t/3087). If this is a sanctioned exception, add '
        + '// eslint-disable-next-line local/no-raw-data-root-read -- <TL-approved rationale> at the '
        + 'call site. tripwire: green ≠ verified — a new hit needs TL review before silencing.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        if (!isFsReadCall(node)) return;
        const pathArg = node.arguments[0];
        if (!pathArg) return;
        const scope = sourceCode.getScope(node);
        if (tracesToResolver(pathArg, scope, 0)) {
          context.report({ node, messageId: 'rawDataRootRead' });
        }
      },
    };
  },
};

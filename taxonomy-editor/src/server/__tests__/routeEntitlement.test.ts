// @vitest-environment node
//
// t/2634 — CI entitlement gate (prevention layer for the t/2625 class). A route handler that
// runs server-side AI generation from a USER-SUPPLIED model MUST route through
// resolveGenerationContext (pins the free tier + gates the backend). Bypassing it lets a
// free/restricted tier reach a premium backend via body.model (evidence-qbaf + /api/ai/search
// did — fixed in t/2625). This test fails the build if any route regresses.
//
// AST-based for low false-positives (per the TL gate-design conditions, p/333#130). It flags a
// route handler that BOTH (a) directly calls ai.generateText/…ByUsage/…WithSearchByUsage (incl.
// inside an adapter closure defined in the handler) AND (b) reads `model` from `body` — either
// the destructure form (`const { model } = body`) OR the property-access form (`body.model`,
// `req.body.model`, inline) — but does NOT call resolveGenerationContext anywhere in the handler.
//
// It also follows ONE level of module-scope helper calls (t/2638): a handler + the helpers it
// directly calls form one gate-scope — the generation OR the gate may live in either.
//
// KNOWN LIMITATIONS (favour low false-POSITIVE over completeness): (1) two-level+ indirection (a
// helper calling another helper that generates) is not followed; (2) a model laundered through a
// parse helper — e.g. op-ed's parseOpEdCreate(body) → params.model, not body.model — is not
// detected as a user-model read, so op-ed is not flagged (it's gated separately via
// resolveOpEdModel). Same shape as the t/2626 lib-emit build-artifact gate.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes');

const GEN_FNS = new Set(['generateText', 'generateTextByUsage', 'generateTextWithSearchByUsage']);
const GATE_FN = 'resolveGenerationContext';
const REGISTRARS = new Set(['get', 'post', 'put', 'del', 'patch']);

// Exemptions: key = '<file>:<METHOD> <path>'. Each entry needs a why-comment.
const EXEMPT = new Set<string>([
  // (none)
]);

type Finding = { file: string; method: string; path: string; line: number };

function isGenCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const c = node.expression;
  if (ts.isPropertyAccessExpression(c)) return GEN_FNS.has(c.name.text);
  if (ts.isIdentifier(c)) return GEN_FNS.has(c.text);
  return false;
}
function isGateCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === GATE_FN;
}
function bindsModelFromBody(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node) || !node.initializer) return false;
  if (!/\bbody\b/.test(node.initializer.getText())) return false;
  if (!node.name || !ts.isObjectBindingPattern(node.name)) return false;
  return node.name.elements.some(el =>
    ts.isBindingElement(el) &&
    ((ts.isIdentifier(el.name) && el.name.text === 'model') ||
     (!!el.propertyName && ts.isIdentifier(el.propertyName) && el.propertyName.text === 'model')));
}
/** Property-access read of a user model: `body.model` or `req.body.model` (TL GV p/333#138). */
function readsBodyModelProp(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'model') return false;
  const obj = node.expression;
  return (ts.isIdentifier(obj) && obj.text === 'body') ||
         (ts.isPropertyAccessExpression(obj) && obj.name.text === 'body'); // req.body.model
}
function analyzeHandler(fn: ts.Node): { generates: boolean; readsBodyModel: boolean; callsGate: boolean } {
  let generates = false, readsBodyModel = false, callsGate = false;
  (function walk(n: ts.Node): void {
    if (isGenCall(n)) generates = true;
    if (isGateCall(n)) callsGate = true;
    if (bindsModelFromBody(n) || readsBodyModelProp(n)) readsBodyModel = true;
    ts.forEachChild(n, walk);
  })(fn);
  return { generates, readsBodyModel, callsGate };
}

/** Names of module-scope functions that `fn` directly calls (one-level call graph). */
function collectCalledLocalFns(fn: ts.Node, localFns: Map<string, ts.Node>): Set<string> {
  const called = new Set<string>();
  (function walk(n: ts.Node): void {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && localFns.has(n.expression.text)) {
      called.add(n.expression.text);
    }
    ts.forEachChild(n, walk);
  })(fn);
  return called;
}

/** Scan one route source; return the bypassing routes it contains. Follows ONE level of
 *  module-scope helper calls (t/2638): a handler + the helpers it directly calls form one
 *  gate-scope — the generation or the gate may live in either. */
export function scanSource(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  // Module-scope function definitions (name → body node), for one-level call-graph following.
  const localFns = new Map<string, ts.Node>();
  sf.forEachChild(n => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) localFns.set(n.name.text, n);
    else if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          localFns.set(d.name.text, d.initializer);
        }
      }
    }
  });
  const out: Finding[] = [];
  (function walk(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const name = ts.isIdentifier(c) ? c.text : (ts.isPropertyAccessExpression(c) ? c.name.text : '');
      if (REGISTRARS.has(name)) {
        const pathArg = n.arguments[0];
        const path = pathArg && ts.isStringLiteral(pathArg) ? pathArg.text : '<dynamic>';
        const handler = n.arguments.find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (handler) {
          const direct = analyzeHandler(handler);
          // Follow one level: a called same-file helper can supply the generation OR the gate.
          let generates = direct.generates, callsGate = direct.callsGate;
          for (const fnName of collectCalledLocalFns(handler, localFns)) {
            const h = analyzeHandler(localFns.get(fnName)!);
            generates = generates || h.generates;
            callsGate = callsGate || h.callsGate;
          }
          const key = `${file}:${name.toUpperCase()} ${path}`;
          if (generates && direct.readsBodyModel && !callsGate && !EXEMPT.has(key)) {
            out.push({ file, method: name.toUpperCase(), path, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
          }
        }
      }
    }
    ts.forEachChild(n, walk);
  })(sf);
  return out;
}

describe('t/2634 — route backend-entitlement gate', () => {
  it('no route generates from a user-supplied model without resolveGenerationContext', () => {
    const findings: Finding[] = [];
    for (const f of readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
      findings.push(...scanSource(f, readFileSync(join(ROUTES_DIR, f), 'utf-8')));
    }
    const msg = findings.map(f => `  routes/${f.file}:${f.line} — ${f.method} ${f.path}`).join('\n');
    expect(findings, `Route(s) generate from a user-supplied model without routing through resolveGenerationContext (t/2625 class):\n${msg}\n\nFix: resolveGenerationContext(req, model) + enforceBackendAllowed(res, tier, backend) BEFORE generating; use the effectiveModel. See routes/generationContext.ts (/api/ai/generate + chat-stream).`).toEqual([]);
  });

  // Fire arm — the predicate itself: a synthetic bypasser IS flagged; a gated one is NOT.
  it('flags a synthetic route that generates from body.model without the gate', () => {
    const src = `post('/api/x', async (req, res, body) => {
      const { prompt, model } = body as { prompt: string; model?: string };
      json(res, await ai.generateTextWithSearchByUsage('server.search', { prompt }, model ? { model } : undefined));
    });`;
    expect(scanSource('synthetic.ts', src)).toHaveLength(1);
  });

  it('flags the property-access form too (body.model / req.body.model, no destructure) (TL GV p/333#138)', () => {
    const inline = `post('/api/x', async (req, res, body) => {
      json(res, await ai.generateText((body as { prompt: string }).prompt, body.model));
    });`;
    expect(scanSource('synthetic.ts', inline)).toHaveLength(1);
    const reqBody = `post('/api/x', async (req, res) => {
      json(res, await ai.generateText(req.body.prompt, req.body.model));
    });`;
    expect(scanSource('synthetic.ts', reqBody)).toHaveLength(1);
  });

  it('does NOT flag the same route once it routes through resolveGenerationContext', () => {
    const src = `post('/api/x', async (req, res, body) => {
      const { prompt, model } = body as { prompt: string; model?: string };
      const { tier, effectiveModel, backend } = resolveGenerationContext(req, model);
      if (enforceBackendAllowed(res, tier, backend)) return;
      json(res, await ai.generateTextWithSearchByUsage('server.search', { prompt }, effectiveModel ? { model: effectiveModel } : undefined));
    });`;
    expect(scanSource('synthetic.ts', src)).toHaveLength(0);
  });

  it('does NOT flag a route that generates with no user-supplied model', () => {
    const src = `post('/api/x', async (req, res, body) => {
      const { prompt } = body as { prompt: string };
      json(res, await ai.generateText(prompt, 'gemini-2.5-flash'));
    });`;
    expect(scanSource('synthetic.ts', src)).toHaveLength(0);
  });

  // t/2638 — one-level helper following: generation OR the gate may live in a called same-file helper.
  it('flags a route that generates via a same-file helper with no gate anywhere', () => {
    const src = `async function genHelper(m) { return await ai.generateText('p', m); }
    post('/api/x', async (req, res, body) => {
      const { model } = body as { model?: string };
      json(res, await genHelper(model));
    });`;
    expect(scanSource('synthetic.ts', src)).toHaveLength(1);
  });

  it('does NOT flag a helper-routed route when the HANDLER gates', () => {
    const src = `async function genHelper(m) { return await ai.generateText('p', m); }
    post('/api/x', async (req, res, body) => {
      const { model } = body as { model?: string };
      const { tier, effectiveModel, backend } = resolveGenerationContext(req, model);
      if (enforceBackendAllowed(res, tier, backend)) return;
      json(res, await genHelper(effectiveModel));
    });`;
    expect(scanSource('synthetic.ts', src)).toHaveLength(0);
  });

  it('does NOT flag a helper-routed route when the HELPER gates', () => {
    const src = `async function genHelper(req, res, m) {
      const { tier, effectiveModel, backend } = resolveGenerationContext(req, m);
      if (enforceBackendAllowed(res, tier, backend)) return;
      return await ai.generateText('p', effectiveModel);
    }
    post('/api/x', async (req, res, body) => {
      const { model } = body as { model?: string };
      json(res, await genHelper(req, res, model));
    });`;
    expect(scanSource('synthetic.ts', src)).toHaveLength(0);
  });
});

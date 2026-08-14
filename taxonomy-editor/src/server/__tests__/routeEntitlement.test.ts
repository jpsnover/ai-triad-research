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
// KNOWN LIMITATION (favours low false-POSITIVE over completeness): generation reached INDIRECTLY
// via a module-scope helper the handler calls (op-ed's driveOpEdRun; /api/ai/generate's
// generateWithSearch) is not analysed, so not flagged — those are gated separately (op-ed:
// resolveOpEdModel; ai/generate: resolveGenerationContext). The direct-call class this closes is
// the one that regressed. Same shape as the t/2626 lib-emit build-artifact gate.

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

/** Scan one route source; return the bypassing routes it contains. */
export function scanSource(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
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
          const { generates, readsBodyModel, callsGate } = analyzeHandler(handler);
          const key = `${file}:${name.toUpperCase()} ${path}`;
          if (generates && readsBodyModel && !callsGate && !EXEMPT.has(key)) {
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
});

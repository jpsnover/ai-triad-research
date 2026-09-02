// Rule-level Gate Verification for local/require-warn-on-degraded-catch-return (t/3200).
// The rule lives in lib/eslint-rules (Shared Lib scope) but is applied by taxonomy-editor's config,
// so its test lives in the taxonomy-editor rule-test harness (same place as no-raw-data-root-read).
// Both-arms proof: `invalid` = the FAIL arm (a degraded return FROM A DATA/IO PATH with no/
// insufficient WARN recording fires), `valid` = the precision arm (adequate WARN recording — either
// transport — plus NON-data-IO defaults like a localStorage miss and non-degraded catches, which the
// narrowed predicate must NOT flag, so the gate isn't noisy — TL t/3200#2).
// Snippets are wrapped in `async function h() {}` (top-level `return`/`await` are parse errors).
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../../lib/eslint-rules/require-warn-on-degraded-catch-return.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;

const rt = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

const h = (body: string) => `async function h() { ${body} }`;

rt.run('require-warn-on-degraded-catch-return', rule, {
  valid: [
    // ── Non-degraded / non-IO catches: this rule stays silent (base rule owns them) ──
    h("try { f(); } catch (e) { getGlobalRecorder()?.record({ level: 'info' }); }"),
    h("try { f(); } catch (e) { /* telemetry — silent by design */ }"),
    h("try { f(); } catch (e) { doCleanup(); }"), // non-degraded, no recording → base rule's concern, not this one

    // ── Silent empty return FROM A DATA/IO PATH with adequate WARN/ERROR recording (both transports) ──
    h("try { await load(); } catch (e) { log.server.warn('fell back to empty'); return []; }"),
    h("try { const d = await fs.readFile(p); } catch (e) { log.ai.error('recompute failed'); return null; }"),
    h("try { await fetch(u); } catch (e) { getGlobalRecorder()?.record({ level: 'warn', message: 'empty' }); return {}; }"),
    h("try { const r = await backend.readFile(p); } catch (e) { log.server.warn('x'); return []; }"),

    // ── EXCLUDED by the refined predicate (NOT silent, TL t/3200 GV) — silent even w/o a recorder ──
    h("try { await isReachable(); } catch (e) { return false; }"),                        // boolean guard, not data
    h("try { await compute(); } catch (e) { return 0; }"),                                 // numeric guard
    h("try { await fetch(u); } catch (e) { return { ok: false, reason: 'network' }; }"),   // observable Result object
    h("try { const r = await backend.get(k); } catch (e) { return { error: 'x' }; }"),     // observable {error}
    h("try { const a = [await one()]; return a; } catch (e) { return [fallbackItem]; }"),  // NON-EMPTY array, observable

    // ── NARROWING: benign UI/local default (no data/IO signal) is NOT the strict class ──
    h("try { return JSON.parse(localStorage.getItem('k')); } catch (e) { return []; }"),
    h("try { const v = localStorage.getItem('k'); return v ? JSON.parse(v) : null; } catch (e) { log.renderer.info('no cache'); return []; }"),

    // ── Nested-function return does NOT trigger the strict path (different scope) ──
    h("try { await load(); } catch (e) { log.server.warn('x'); items.forEach(() => { return []; }); return []; }"),
  ],
  invalid: [
    // Level gap: degraded return from an IO path but only info-level structured log.
    {
      code: h("try { await load(); } catch (e) { log.server.info('miss'); return []; }"),
      errors: [{ messageId: 'degradedReturnNeedsWarn' }],
    },
    // Escape-hatch gap: degraded return from an fs read + silent-by-design comment but NO logging
    // (audit Finding 1: aiBackends.ts:957 — comment present, emitted nothing).
    {
      code: h("try { const d = await fs.readFile(p); } catch (e) { /* telemetry — silent by design */ return []; }"),
      errors: [{ messageId: 'degradedReturnNeedsWarn' }],
    },
    // Recorder present but wrong level (info) on a degraded return from a fetch path.
    {
      code: h("try { await fetch(u); } catch (e) { getGlobalRecorder()?.record({ level: 'info' }); return {}; }"),
      errors: [{ messageId: 'degradedReturnNeedsWarn' }],
    },
    // Silent empty return from an IO path with nothing at all.
    {
      code: h("try { await load(); } catch (e) { return null; }"),
      errors: [{ messageId: 'degradedReturnNeedsWarn' }],
    },
    // Explicit `return undefined` from an IO path — silent no-data (TL predicate includes undefined).
    {
      code: h("try { await load(); } catch (e) { return undefined; }"),
      errors: [{ messageId: 'degradedReturnNeedsWarn' }],
    },
    // Dedicated empty-array fire branch: bare `return []` from an IO path, no recorder (TL nit, p/342#254).
    {
      code: h("try { await load(); } catch (e) { return []; }"),
      errors: [{ messageId: 'degradedReturnNeedsWarn' }],
    },
  ],
});

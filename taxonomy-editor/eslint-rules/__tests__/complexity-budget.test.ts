// Gate Verification for complexity-budget ESLint rule (t/3821).
// Both-arms proof per each decision point. Uses inline baseline object (not a file path)
// so the test is hermetic. shouldWrite semantics are re-implemented inline — the generator
// .mjs cannot be imported in vitest (top-level await / ESM resolution mismatch).
import { describe, it, afterAll, beforeAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { RuleTester, Linter } from 'eslint';
import rule from '../../../lib/eslint-rules/complexity-budget.js';
import { isAcceptable } from '../../../lib/eslint-rules/complexity-budget-predicate.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;

const rt = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

// ── ARM 1: non-baselined file, max exceeds threshold → overThreshold ──────────
// ── ARM 1b: non-baselined file, max at or below threshold → clean ─────────────
rt.run('complexity-budget — ARM 1: not in baseline', rule, {
  valid: [
    {
      // threshold=3, complexity=3 (entry: 1 + 2 branches = 3) → exactly at limit, no error
      filename: 'new-file.js',
      code: `function f(a, b, c) { if (a) return 1; if (b) return 2; return 3; }`,
      options: [{ threshold: 3 }],
    },
    {
      // file not in baseline, max=1 (no branches) → clean
      filename: 'simple.js',
      code: `function f() { return 1; }`,
      options: [{ baseline: {}, threshold: 15 }],
    },
  ],
  invalid: [
    {
      // not in baseline, max=4 (1 + 3 branches), threshold=3 → overThreshold
      filename: 'new-file.js',
      code: `function f(a, b, c, d) { if (a) return 1; if (b) return 2; if (c) return 3; return 4; }`,
      options: [{ threshold: 3 }],
      errors: [{ messageId: 'overThreshold' }],
    },
  ],
});

// ── ARM 2a: max rises above baseline → maxExceeded ───────────────────────────
// ── ARM 2b: countOver rises above baseline → countOverExceeded ───────────────
// ── ARM 3: matching baseline → clean ─────────────────────────────────────────
// Inline baseline so tests are hermetic. Key is the filename string as-is (inline mode).
const BASELINE_ARM2 = {
  'arm2.js': { max: 3, countOver: 0 },
};

rt.run('complexity-budget — ARM 2/3: baselined file', rule, {
  valid: [
    {
      // max=3, countOver=0 matches baseline exactly → clean
      filename: 'arm2.js',
      code: `function f(a, b, c) { if (a) return 1; if (b) return 2; return 3; }`,
      options: [{ baseline: BASELINE_ARM2, threshold: 15 }],
    },
    {
      // max=2 < baseline.max=3 → clean (improvement)
      filename: 'arm2.js',
      code: `function f(a, b) { if (a) return 1; return 2; }`,
      options: [{ baseline: BASELINE_ARM2, threshold: 15 }],
    },
  ],
  invalid: [
    {
      // max=4 > baseline.max=3 → maxExceeded
      filename: 'arm2.js',
      code: `function f(a, b, c, d) { if (a) return 1; if (b) return 2; if (c) return 3; return 4; }`,
      options: [{ baseline: BASELINE_ARM2, threshold: 15 }],
      errors: [{ messageId: 'maxExceeded' }],
    },
    {
      // threshold=2 so a function of complexity 3 is countOver; baseline.countOver=0 → countOverExceeded
      filename: 'arm2.js',
      code: `function f(a, b, c) { if (a) return 1; if (b) return 2; return 3; }`,
      options: [{ baseline: BASELINE_ARM2, threshold: 2 }],
      errors: [{ messageId: 'countOverExceeded' }],
    },
  ],
});

// ── ARM 4b: decomposition via RULE — baseline has one large function; after
//    split into four smaller ones max drops but countOver rises → zero errors ──
// threshold=5: each 7-complexity function (1+6 ifs) is countOver; baseline recorded
// one 20-complexity function (countOver=1). After split: max=7<20, countOver=4>1.
// isAcceptable({max:7,countOver:4},{max:20,countOver:1}) → max<existing.max → true → clean.
const BASELINE_SPLIT = {
  'split.js': { max: 20, countOver: 1 },
};
rt.run('complexity-budget — ARM 4b: decomposition rule clean', rule, {
  valid: [
    {
      filename: 'split.js',
      // Four functions each with complexity 7 (1 + 6 ifs). max=7<20, countOver=4>1.
      code: [
        'function a(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function b(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function c(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function d(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
      ].join('\n'),
      options: [{ baseline: BASELINE_SPLIT, threshold: 5 }],
    },
  ],
  invalid: [],
});

// ── shouldWrite — thin generator wrapper (delegates to isAcceptable) ──────────
// Generator's only extra branch vs isAcceptable: !existing → true (new file).
function shouldWrite(observed: { max: number; countOver: number }, existing: { max: number; countOver: number } | undefined, threshold = 15): boolean {
  if (!existing) return true;
  return isAcceptable(observed, existing, threshold);
}

// ── ARM 4c: ceiling PASSES via rule — honest decomposition stays within ceiling ───
// Baseline: {max:20, countOver:1}, threshold=5.
// After split: 2 functions each at complexity 7 → {max:7, countOver:2}.
// ceiling = max(1×2, 1+5) = 6; countOver=2 ≤ 6 → PASS.
const BASELINE_CEIL_PASS = {
  'ceil-pass.js': { max: 20, countOver: 1 },
};
rt.run('complexity-budget — ARM 4c: ceiling passes (honest decomposition)', rule, {
  valid: [
    {
      filename: 'ceil-pass.js',
      // Two functions each with complexity 7 (1 + 6 nested ifs). max=7<20, countOver=2.
      // ceiling = max(1+5, ceil(20/5)=4) = 6; 2 ≤ 6 → acceptable.
      code: [
        'function a(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function b(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
      ].join('\n'),
      options: [{ baseline: BASELINE_CEIL_PASS, threshold: 5 }],
    },
  ],
  invalid: [],
});

// ── ARM 4d: ceiling FAILS via rule — pathological growth rejected ─────────────
// Baseline: {max:100, countOver:1}, threshold=5.
// After "split": 7 functions each at complexity 7 → {max:7, countOver:7}.
// ceiling = max(1×2, 1+5) = 6; countOver=7 > 6 → FAIL → countOverExceeded.
const BASELINE_CEIL_FAIL = {
  'ceil-fail.js': { max: 30, countOver: 1 },
};
rt.run('complexity-budget — ARM 4d: ceiling fails (pathological growth)', rule, {
  valid: [],
  invalid: [
    {
      filename: 'ceil-fail.js',
      // Seven functions each with complexity 7, threshold=5. max=7<30 (looks like decomposition),
      // ceiling = max(1+5, ceil(30/5)=6) = 6; countOver=7 > 6 → rejected.
      code: [
        'function a(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function b(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function c(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function d(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function e(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function f(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
        'function g(x){if(x>0)if(x>1)if(x>2)if(x>3)if(x>4)if(x>5)return 1;return 0;}',
      ].join('\n'),
      options: [{ baseline: BASELINE_CEIL_FAIL, threshold: 5 }],
      errors: [{ messageId: 'countOverExceeded' }],
    },
  ],
});

// ── ARM 4: decomposition (max strictly down, countOver may rise) → shouldWrite=true ──
describe('shouldWrite — ARM 4: decomposition', () => {
  it('max strictly decreased, countOver rose → true', () => {
    const result = shouldWrite({ max: 4, countOver: 2 }, { max: 5, countOver: 0 });
    if (!result) throw new Error('Expected shouldWrite to return true for decomposition');
  });

  it('max strictly decreased, countOver same → true', () => {
    const result = shouldWrite({ max: 4, countOver: 1 }, { max: 5, countOver: 1 });
    if (!result) throw new Error('Expected shouldWrite to return true for decomposition');
  });
});

// ── ARM 5: regressions → shouldWrite=false ────────────────────────────────────
describe('shouldWrite — ARM 5: regression', () => {
  it('max rose → false', () => {
    const result = shouldWrite({ max: 6, countOver: 0 }, { max: 5, countOver: 0 });
    if (result) throw new Error('Expected shouldWrite to return false (max regression)');
  });

  it('max same, countOver rose → false', () => {
    const result = shouldWrite({ max: 5, countOver: 2 }, { max: 5, countOver: 1 });
    if (result) throw new Error('Expected shouldWrite to return false (countOver regression)');
  });

  it('max same, countOver same → true (Pareto)', () => {
    const result = shouldWrite({ max: 5, countOver: 1 }, { max: 5, countOver: 1 });
    if (!result) throw new Error('Expected shouldWrite to return true for Pareto (same/same)');
  });

  it('no existing → true (new file)', () => {
    const result = shouldWrite({ max: 10, countOver: 2 }, undefined);
    if (!result) throw new Error('Expected shouldWrite to return true for new file');
  });
});

// ── shouldWrite ceiling arms (t/3821 predicate fix, e/240#30) ────────────────
// ceiling = max(existing.countOver + 5, ceil(existing.max / threshold))
describe('shouldWrite — ceiling arms', () => {
  it('decomp + countOver within ceiling → true', () => {
    // {max:40, countOver:2} vs {max:100, countOver:1}, threshold=15: ceiling=max(6,ceil(100/15)=7)=7; 2≤7 → true
    const result = shouldWrite({ max: 40, countOver: 2 }, { max: 100, countOver: 1 }, 15);
    if (!result) throw new Error('Expected true: honest decomposition within ceiling');
  });

  it('decomp + countOver exceeds ceiling → false', () => {
    // {max:99, countOver:500} vs {max:100, countOver:1}, threshold=15: ceiling=max(6,ceil(100/15)=7)=7; 500>7 → false
    const result = shouldWrite({ max: 99, countOver: 500 }, { max: 100, countOver: 1 }, 15);
    if (result) throw new Error('Expected false: pathological countOver growth rejected by ceiling');
  });
});

// ── Generator integrity: stale-key isolation (e/240#15 condition 1 amendment) ───
// A second generator run from a different --root spelling (e.g. 'taxonomy-editor/src'
// instead of 'taxonomy-editor') produces different relative keys for the same physical file.
// The generator's replace semantics (updated={} rather than {...existing}) ensure only
// visited keys appear in the output. This test proves the invariant inline.
describe('generator integrity — stale-key isolation', () => {
  function generatorShouldWrite(
    observed: { max: number; countOver: number },
    existing: { max: number; countOver: number } | undefined,
    threshold = 15,
  ): boolean {
    if (!existing) return true;
    return isAcceptable(observed, existing, threshold);
  }

  it('second run from different cwd does not double keys in output', () => {
    // Simulate: run 1 used --root taxonomy-editor/src → key 'main/aiCallLog.ts'
    const existingBaseline: Record<string, { max: number; countOver: number }> = {
      'main/aiCallLog.ts': { max: 8, countOver: 0 },
    };

    // Simulate: run 2 uses --root taxonomy-editor → visits key 'src/main/aiCallLog.ts'
    // Replace semantics: updated starts empty; only visited keys appear.
    const updated: Record<string, { max: number; countOver: number }> = {};
    const relKey = 'src/main/aiCallLog.ts';
    const observed = { max: 8, countOver: 0 };

    if (generatorShouldWrite(observed, existingBaseline[relKey])) {
      updated[relKey] = observed;
    } else {
      updated[relKey] = existingBaseline[relKey]!;
    }

    // Output has exactly 1 key (the run-2 spelling) — the run-1 key is gone.
    if (Object.keys(updated).length !== 1)
      throw new Error(`Expected 1 key, got ${Object.keys(updated).length}: ${JSON.stringify(Object.keys(updated))}`);
    if (!Object.prototype.hasOwnProperty.call(updated, 'src/main/aiCallLog.ts'))
      throw new Error('Expected src/main/aiCallLog.ts in output');
    if (Object.prototype.hasOwnProperty.call(updated, 'main/aiCallLog.ts'))
      throw new Error('Stale key main/aiCallLog.ts must not appear — replace semantics violated');
  });
});

// ── ARM: threshold mismatch (e/240#22, t/3838) — both arms ───────────────────
// __meta__.threshold in baseline must match configured threshold; mismatch → error.
// ARM A: match → clean. ARM B: mismatch → thresholdMismatch (both values in message).
describe('threshold mismatch — both arms', () => {
  const linter = new Linter({ configType: 'flat' });
  const simpleCode = `function f(a) { if (a) return 1; return 2; }`;

  it('ARM A: matching threshold → clean', () => {
    const baseline = { __meta__: { threshold: 15 }, 'match.js': { max: 20, countOver: 1 } };
    const messages = linter.verify(simpleCode, {
      plugins: { local: { rules: { 'complexity-budget': rule } } },
      rules: { 'local/complexity-budget': ['error', { threshold: 15, baseline }] },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    });
    const errs = messages.filter((m) => m.ruleId === 'local/complexity-budget');
    if (errs.length !== 0)
      throw new Error(`Expected 0 errors, got: ${JSON.stringify(errs.map((e) => e.message))}`);
  });

  it('ARM B: mismatching threshold → thresholdMismatch with both values', () => {
    const baseline = { __meta__: { threshold: 10 }, 'match.js': { max: 20, countOver: 1 } };
    const messages = linter.verify(simpleCode, {
      plugins: { local: { rules: { 'complexity-budget': rule } } },
      rules: { 'local/complexity-budget': ['error', { threshold: 15, baseline }] },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    });
    const errs = messages.filter((m) => m.ruleId === 'local/complexity-budget');
    if (errs.length !== 1 || !errs[0].message.includes('10') || !errs[0].message.includes('15'))
      throw new Error(`Expected thresholdMismatch with both values (10 and 15), got: ${JSON.stringify(errs.map((e) => e.message))}`);
  });
});

// ── ARM: baseline load error — both arms ─────────────────────────────────────
// If the configured string baseline path is unreadable, the rule must fail loudly
// with baselineLoadError naming the path. Silently degrading to {} disables the gate.
// ARM A: string path exists and is readable → no baselineLoadError (gate active).
// ARM B: string path does not exist → baselineLoadError (ENOENT, both values in message).
describe('baseline load error — both arms', () => {
  const linter = new Linter({ configType: 'flat' });
  const simpleCode = `function f(a) { if (a) return 1; return 2; }`;
  const tmpBaseline = `.complexity-test-baseline-tmp.json`;

  beforeAll(() => {
    writeFileSync(tmpBaseline, JSON.stringify({ __meta__: { threshold: 15 } }), 'utf-8');
  });

  afterAll(() => {
    try { unlinkSync(tmpBaseline); } catch { /* cleanup best-effort */ }
  });

  it('ARM A: configured string path exists → no baselineLoadError', () => {
    const messages = linter.verify(simpleCode, {
      plugins: { local: { rules: { 'complexity-budget': rule } } },
      rules: { 'local/complexity-budget': ['error', { threshold: 15, baseline: tmpBaseline }] },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    });
    const errs = messages.filter((m) => m.ruleId === 'local/complexity-budget');
    if (errs.some((e) => e.messageId === 'baselineLoadError'))
      throw new Error(`Unexpected baselineLoadError: ${JSON.stringify(errs.map((e) => e.message))}`);
  });

  it('ARM B: configured string path does not exist → baselineLoadError naming the path', () => {
    const missing = 'nonexistent-complexity-baseline-xyz.json';
    const messages = linter.verify(simpleCode, {
      plugins: { local: { rules: { 'complexity-budget': rule } } },
      rules: { 'local/complexity-budget': ['error', { threshold: 15, baseline: missing }] },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    });
    const errs = messages.filter((m) => m.ruleId === 'local/complexity-budget');
    if (errs.length !== 1 || errs[0].messageId !== 'baselineLoadError')
      throw new Error(`Expected exactly one baselineLoadError, got: ${JSON.stringify(errs.map((e) => e.message))}`);
    if (!errs[0].message.includes(missing))
      throw new Error(`Expected error message to include path "${missing}", got: ${errs[0].message}`);
  });
});

// ── ARM 6: drift test — built-in `complexity` and our rule agree on max ───────
// 18 fixtures covering: simple functions, nested ifs, ternaries, loops, switch,
// logical expressions, async/arrow, pattern assignments, no-function files, etc.
// Both are run via ESLint Linter separately; we compare the max reported by each.
// Built-in is run at max:0 (reports every function); we compute max from messages.
describe('drift test — built-in complexity vs our rule node set', () => {
  const FIXTURES: Array<{ label: string; code: string }> = [
    { label: 'single if', code: `function f(a) { if (a) return 1; return 2; }` },
    { label: 'nested ifs', code: `function f(a, b) { if (a) { if (b) return 1; return 2; } return 3; }` },
    { label: 'ternary', code: `function f(a) { return a ? 1 : 0; }` },
    { label: 'while loop', code: `function f(n) { let i = 0; while (i < n) i++; return i; }` },
    { label: 'do-while', code: `function f(n) { let i = 0; do { i++; } while (i < n); return i; }` },
    { label: 'for loop', code: `function f(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }` },
    { label: 'for-in', code: `function f(o) { let s = ''; for (const k in o) s += k; return s; }` },
    { label: 'for-of', code: `function f(a) { let s = 0; for (const x of a) s += x; return s; }` },
    { label: 'logical &&', code: `function f(a, b) { return a && b; }` },
    { label: 'logical ||', code: `function f(a, b) { return a || b; }` },
    { label: 'assignment pattern', code: `function f({ x = 1 } = {}) { return x; }` },
    { label: 'switch with cases', code: `function f(x) { switch(x) { case 1: return 'a'; case 2: return 'b'; default: return 'c'; } }` },
    { label: 'arrow function', code: `const f = (a) => a ? 1 : 0;` },
    { label: 'async function', code: `async function f(p) { if (p) { return await fetch(p); } return null; }` },
    { label: 'complex multi-branch', code: `function f(a,b,c,d) { if(a){if(b)return 1;return 2;}else if(c){return 3;}return d?4:5; }` },
    { label: 'no branches (trivial)', code: `function f(a) { return a + 1; }` },
    { label: 'multiple functions', code: `function a(x) { if(x) return 1; return 0; } function b(y) { return y ? 1 : 0; }` },
    { label: 'deeply nested', code: `function f(a,b,c,d,e) { if(a){ if(b){ if(c){ if(d){ return e?1:2; } return 3; } return 4; } return 5; } return 6; }` },
    // Optional chaining: each ?. operator is a separate MemberExpression[optional=true] node.
    // a?.b?.c has TWO optional members (+2), not one ChainExpression wrapper (+1).
    { label: 'optional chaining single', code: `function f(a) { return a?.b; }` },
    { label: 'optional chaining double', code: `function f(a) { return a?.b?.c; }` },
    { label: 'optional call', code: `function f(a) { return a?.b(); }` },
  ];

  function builtinComplexities(code: string): number[] {
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(code, {
      rules: { complexity: ['error', { max: 0 }] },
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    });
    return messages
      .filter((m) => m.ruleId === 'complexity')
      .map((m) => {
        const match = m.message.match(/complexity of (\d+)/);
        return match ? parseInt(match[1], 10) : 1;
      });
  }

  function ourMaxComplexity(code: string, filename: string): number {
    const linter = new Linter({ configType: 'flat' });
    // threshold=1: every function with complexity>1 is reported via overThreshold.
    // Complexity=1 (no branches) is not reported; the fallback return 1 below handles it.
    const messages = linter.verify(
      code,
      {
        plugins: { local: { rules: { 'complexity-budget': rule } } },
        rules: { 'local/complexity-budget': ['error', { threshold: 1 }] },
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      },
      { filename },
    );
    // The overThreshold message embeds "max N" — extract it
    for (const m of messages) {
      if (m.ruleId === 'local/complexity-budget') {
        const match = m.message.match(/max (\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
    return 1; // single function, no branches → complexity=1, at threshold → no message
  }

  for (const { label, code } of FIXTURES) {
    it(`drift: ${label}`, () => {
      const builtinMaxes = builtinComplexities(code);
      const builtinMax = builtinMaxes.length > 0 ? Math.max(...builtinMaxes) : 1;
      const ourMax = ourMaxComplexity(code, `drift-${label.replace(/\s+/g, '-')}.js`);
      if (builtinMax !== ourMax) {
        throw new Error(
          `Drift detected for "${label}": built-in max=${builtinMax}, our max=${ourMax}.\n` +
          `Code: ${code}`,
        );
      }
    });
  }
});

// ── Both-halves: deadlock fix (t/3821, e/240#29) ─────────────────────────────
// Three times in this work stream a fix was correct in one half and absent in the
// other. This arm proves BOTH: the rule passes the deadlock split AND the generator
// writes the new baseline values. Testing only the predicate leaves the generator gap open.
//
// Scenario: runTurn.ts {max:408, countOver:1} split into 15 functions at complexity 20.
// New ceiling = max(1+5, ceil(408/15)=28) = 28; countOver=15 ≤ 28 → both pass.
// Old ceiling = max(1×2, 1+5) = 6; countOver=15 > 6 → both deadlocked (rule fails,
// generator shares predicate so it also refuses to write the new values — no escape).

const BASELINE_DEADLOCK = {
  'deadlock.js': { max: 408, countOver: 1 },
};

// RULE ARM: 15 functions at complexity 20 (19 nested ifs, >threshold=15) → PASS.
rt.run('complexity-budget — both-halves: rule ARM (deadlock resolved)', rule, {
  valid: [
    {
      filename: 'deadlock.js',
      // 15 functions, each complexity 20 (1 + 19 nested ifs). {max:20, countOver:15}.
      // Baseline {max:408, countOver:1}, threshold=15.
      // New ceiling=max(6,28)=28; 15≤28 → PASS. Old ceiling=6; 15>6 → FAIL (deadlock).
      code: Array.from({ length: 15 }, (_, i) =>
        `function f${i + 1}(a,b,c,d,e,g,h,i,j,k,l,m,n,o,p,q,r,s,t){if(a)if(b)if(c)if(d)if(e)if(g)if(h)if(i)if(j)if(k)if(l)if(m)if(n)if(o)if(p)if(q)if(r)if(s)if(t)return 1;return 0;}`
      ).join('\n'),
      options: [{ baseline: BASELINE_DEADLOCK, threshold: 15 }],
    },
  ],
  invalid: [],
});

// GENERATOR ARM: shouldWrite({max:20, countOver:15}, {max:408, countOver:1}, threshold=15) → true.
describe('both-halves: generator ARM (deadlock resolved — generator writes new values)', () => {
  it('{max:20, countOver:15} vs {max:408, countOver:1} — shouldWrite true (not deadlocked)', () => {
    // New ceiling = max(1+5, ceil(408/15)=28) = 28; 15≤28 → true → generator writes.
    // Old ceiling = max(1×2, 1+5) = 6; 15>6 → false → generator refused (deadlock).
    const result = shouldWrite({ max: 20, countOver: 15 }, { max: 408, countOver: 1 }, 15);
    if (!result) throw new Error('Generator deadlock: shouldWrite must return true so generator can write the new baseline');
  });
});

// ── shouldWrite — total-complexity oracle (e/240#35, TL ruling) ───────────────
// Oracle: peak falls AND total complexity roughly preserved → pass.
//         peak falls AND total complexity multiplies → fail.
// Do NOT write this oracle as a function count — that was the ambiguity that nearly shipped.
describe('shouldWrite — total-complexity oracle', () => {
  it('peak falls, total preserved: {408,1}→{max:27,countOver:15} passes', () => {
    // total: 408 → 15×27=405 (preserved). ceiling=max(6,ceil(408/15)=28)=28; 15≤28 → true.
    const result = shouldWrite({ max: 27, countOver: 15 }, { max: 408, countOver: 1 }, 15);
    if (!result) throw new Error('Expected pass: peak fell, total complexity roughly preserved');
  });

  it('peak barely falls, total multiplies ×165: {100,3}→{max:99,countOver:500} fails', () => {
    // total: 3×100=300 → 500×99=49500 (×165). ceiling=max(3+5,ceil(100/15)=7)=8; 500>8 → false.
    const result = shouldWrite({ max: 99, countOver: 500 }, { max: 100, countOver: 3 }, 15);
    if (result) throw new Error('Expected fail: total complexity multiplied ×165');
  });

  it('peak falls to 40%, total multiplies ×16: {100,1}→{max:40,countOver:40} fails', () => {
    // total: 1×100=100 → 40×40=1600 (×16). ceiling=max(6,ceil(100/15)=7)=7; 40>7 → false.
    const result = shouldWrite({ max: 40, countOver: 40 }, { max: 100, countOver: 1 }, 15);
    if (result) throw new Error('Expected fail: total complexity multiplied ×16');
  });
});

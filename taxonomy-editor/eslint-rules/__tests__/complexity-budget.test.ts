// Gate Verification for complexity-budget ESLint rule (t/3821).
// Both-arms proof per each decision point. Uses inline baseline object (not a file path)
// so the test is hermetic. shouldWrite semantics are re-implemented inline — the generator
// .mjs cannot be imported in vitest (top-level await / ESM resolution mismatch).
import { describe, it, afterAll } from 'vitest';
import { RuleTester, Linter } from 'eslint';
import rule from '../../../lib/eslint-rules/complexity-budget.js';

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

// ── shouldWrite semantics (re-implemented inline for unit coverage) ────────────
// The generator .mjs exports shouldWrite but cannot be imported in vitest, so we
// replicate the function here and assert the TL-corrected logic directly.
function shouldWrite(observed: { max: number; countOver: number }, existing: { max: number; countOver: number } | undefined): boolean {
  if (!existing) return true;
  if (observed.max < existing.max) return true; // decomposition
  if (observed.max === existing.max && observed.countOver <= existing.countOver) return true; // Pareto
  return false;
}

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
    // Use a very low threshold so every function is reported via overThreshold
    // if it has any complexity > 0; baseline is empty (no file in baseline).
    const messages = linter.verify(
      code,
      {
        plugins: { local: { rules: { 'complexity-budget': rule } } },
        rules: { 'local/complexity-budget': ['error', { threshold: 0 }] },
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

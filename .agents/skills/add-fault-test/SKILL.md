---
name: add-fault-test
description: Pattern playbook for adding fault injection tests using FaultHarness. Self-certify against this pattern to skip TL design review.
---

# Fault Injection Test Playbook

Use this playbook when adding fault injection tests for resilience validation. Following this pattern qualifies for the **design review gate exemption** — state in your ticket comment that you followed `/add-fault-test` and note any deviations.

## When This Applies

- Adding tests that verify behavior under failure conditions (API timeouts, storage errors, rate limits, auth failures)
- Testing retry/fallback/circuit-breaker logic
- Validating that errors produce ActionableError (not bare throws or hangs)

## When This Does NOT Apply (requires TL design review)

- Creating new FaultTarget types or extending the FaultHarness itself
- Testing cross-agent failure cascades (multiple services failing together)
- Changes to production error handling code (not just tests)

## Key Files

| File | Purpose |
|------|---------|
| `lib/debate/__tests__/faultInjection.ts` | FaultHarness class, FaultProfile/Fault/FaultStats types, pre-built AI_FAULT_PROFILES |
| `lib/debate/__tests__/faultInjection.test.ts` | Reference tests — copy patterns from here |
| `taxonomy-editor/src/server/**/__tests__/*fault*.test.ts` | Server-side fault tests |

## Core Types

```typescript
interface FaultProfile {
  name: string;
  description: string;
  faults: Fault[];
}

interface Fault {
  target: FaultTarget;  // 'ai-call' | 'storage' | 'rate-limiter' | 'network'
  trigger: 'always' | 'nth-call' | 'after-delay' | 'random' | 'match-request';
  effect: 'timeout' | 'throw-429' | 'throw-503' | 'throw-enoent' | 'throw-eacces'
        | 'corrupt-json' | 'slow-response' | 'auth-fail' | 'circuit-open';
  nthCall?: number;        // Used with 'nth-call' trigger
  delayMs?: number;        // Used with 'after-delay' trigger
  probability?: number;    // Used with 'random' trigger (0.0-1.0)
  matchFn?: (url: string, init?: RequestInit) => boolean;  // Used with 'match-request'
}

interface FaultStats {
  timeouts: number;
  retries: number;
  fallbackAttempts: number;
  errors: number;
}
```

## Pre-built Profiles (AI_FAULT_PROFILES)

| Profile | What it does |
|---------|-------------|
| `silentAiDrop` | AI call hangs on 3rd request (nthCall=3, timeout) |
| `tokenExhaustion` | Rate-limit 429 on 5th request |
| `totalAiOutage` | All AI calls return 503 |
| `flakyNetwork` | 30% random timeouts |
| `authFailFast` | Auth fails immediately on every call (401) |
| `fallbackChainExhaustion` | All backends return 503 |

## Step-by-Step

### 1. Choose or create a FaultProfile

Use a pre-built profile from `AI_FAULT_PROFILES` if it fits. Otherwise create a custom one:

```typescript
const myProfile: FaultProfile = {
  name: 'storageCorruption',
  description: 'JSON file corrupted on disk',
  faults: [{ target: 'storage', trigger: 'always', effect: 'corrupt-json' }],
};
```

### 2. Write the test

```typescript
import { FaultHarness, AI_FAULT_PROFILES } from '../faultInjection.js';
// or for custom profiles:
import { FaultHarness, type FaultProfile } from '../faultInjection.js';

it('handles silent AI drop with timeout and ActionableError', async () => {
  const harness = new FaultHarness(AI_FAULT_PROFILES.silentAiDrop);
  harness.install();
  try {
    // Exercise the code under test
    const err = await adapter.generateText('test', 'model-id', { timeoutMs: 10_000 })
      .catch((e: unknown) => e);

    // Verify behavior under fault
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('ActionableError');
    expect((err as Error).message).toMatch(/timed out/i);
    expect(harness.stats.timeouts).toBeGreaterThanOrEqual(1);
  } finally {
    harness.teardown();  // ALWAYS in finally block
  }
});
```

### 3. Verify against the Coherent Experience Checklist

Every fault test must verify ALL applicable items:

- [ ] **No hangs** — code resolves/rejects within timeout, never hangs forever
- [ ] **No silent swallowing** — errors are surfaced, not eaten
- [ ] **ActionableError on unrecoverable** — includes Goal, Problem, Location, Next Steps
- [ ] **Graceful partial results** — if applicable, returns what succeeded
- [ ] **Retry-before-fail** — transient errors trigger retry logic
- [ ] **Fallback-before-fail** — if fallback chain exists, it activates
- [ ] **No state corruption** — stores/caches remain consistent after failure
- [ ] **UI-reportable** — error message is suitable for showing to users

### 4. Run tests

```bash
cd taxonomy-editor && npx vitest run --reporter=verbose <your-test-file>
```

## Self-Certification Checklist

Before marking your ticket done, verify:

- [ ] Tests use `harness.install()` / `harness.teardown()` in try/finally
- [ ] At least one test per fault profile used
- [ ] `harness.stats` assertions verify the fault actually fired
- [ ] ActionableError checked on all unrecoverable paths
- [ ] No test relies on timing (use `vi.useFakeTimers()` if needed)
- [ ] All tests pass: `npx vitest run <file>`
- [ ] Coherent Experience Checklist items verified

## Common Mistakes

- **Forgetting `harness.teardown()`** — leaks stubbed fetch into other tests. Always use `finally`.
- **Not checking `harness.stats`** — test passes but fault never fired (wrong trigger config).
- **Hardcoding timeouts** — use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` instead of real waits.
- **Testing only the error path** — also verify the happy path still works after teardown (no leak).
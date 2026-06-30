// Fault injection harness for debate engine resilience testing (t/1083).
// Usage:
//   const harness = new FaultHarness(AI_FAULT_PROFILES.silentAiDrop);
//   harness.install();
//   // ... run adapter calls — 3rd call will timeout
//   harness.teardown();
//   expect(harness.stats.timeouts).toBe(1);

import { vi } from 'vitest';

// ── Types ────────────────────────────────────────────────

export type FaultTarget = 'ai-call' | 'storage' | 'rate-limiter' | 'network';

export interface Fault {
  target: FaultTarget;
  trigger: 'always' | 'nth-call' | 'after-delay' | 'random' | 'match-request';
  effect: 'timeout' | 'throw-429' | 'throw-503' | 'throw-enoent' | 'throw-eacces'
        | 'corrupt-json' | 'slow-response' | 'auth-fail' | 'circuit-open';
  nthCall?: number;
  delayMs?: number;
  probability?: number;
  // match-request: fires when matchFn returns true for the request.
  // TODO: composable with nth-call (counter only increments for matching requests)
  matchFn?: (url: string, init?: RequestInit) => boolean;
}

export interface FaultProfile {
  name: string;
  description: string;
  faults: Fault[];
}

export interface FaultStats {
  timeouts: number;
  retries: number;
  fallbackAttempts: number;
  errors: number;
}

// ── Response helpers ─────────────────────────────────────

function freshResponse(body: object | string, status = 200): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  });
}

function geminiOkBody(text = 'Hello from Gemini') {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
}

// ── FaultHarness ─────────────────────────────────────────

export class FaultHarness {
  stats: FaultStats = { timeouts: 0, retries: 0, fallbackAttempts: 0, errors: 0 };
  private profile: FaultProfile;
  private originalFetch: typeof globalThis.fetch | null = null;
  private callCount = 0;
  private startTime = 0;
  private installed = false;

  constructor(profile: FaultProfile) {
    this.profile = profile;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.callCount = 0;
    this.startTime = Date.now();
    this.stats = { timeouts: 0, retries: 0, fallbackAttempts: 0, errors: 0 };

    this.originalFetch = globalThis.fetch;
    const self = this;

    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>): Promise<Response> => {
      self.callCount++;
      const currentCall = self.callCount;
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      const init = args[1] as RequestInit | undefined;

      for (const fault of self.profile.faults) {
        if (fault.target !== 'ai-call') {
          if (fault.target === 'storage' || fault.target === 'rate-limiter' || fault.target === 'network') {
            throw new Error(`FaultHarness: target '${fault.target}' not implemented — Phase 2+`);
          }
          continue;
        }

        if (!self.shouldTrigger(fault, currentCall, url, init)) continue;

        return self.applyEffect(fault.effect);
      }

      return freshResponse(geminiOkBody());
    });
  }

  teardown(): void {
    if (!this.installed) return;
    this.installed = false;
    if (this.originalFetch) {
      vi.stubGlobal('fetch', this.originalFetch);
      this.originalFetch = null;
    }
  }

  private shouldTrigger(fault: Fault, currentCall: number, url?: string, init?: RequestInit): boolean {
    switch (fault.trigger) {
      case 'always':
        return true;
      case 'nth-call':
        return currentCall === (fault.nthCall ?? 1);
      case 'after-delay':
        return (Date.now() - this.startTime) >= (fault.delayMs ?? 0);
      case 'random':
        return Math.random() < (fault.probability ?? 0.5);
      case 'match-request':
        return fault.matchFn ? fault.matchFn(url ?? '', init) : false;
      default:
        return false;
    }
  }

  private applyEffect(effect: Fault['effect']): Promise<Response> | Response {
    switch (effect) {
      case 'timeout':
        this.stats.timeouts++;
        this.stats.errors++;
        return new Promise<Response>(() => {});
      case 'throw-429':
        this.stats.errors++;
        return freshResponse({ error: { message: 'Rate limit exceeded', status: 'RESOURCE_EXHAUSTED' } }, 429);
      case 'throw-503':
        this.stats.errors++;
        return freshResponse({ error: { message: 'Service unavailable' } }, 503);
      case 'auth-fail':
        this.stats.errors++;
        return freshResponse({ error: { message: 'Permission denied', status: 'PERMISSION_DENIED' } }, 401);
      case 'corrupt-json':
        this.stats.errors++;
        return freshResponse('{broken json', 200);
      case 'slow-response':
        this.stats.errors++;
        return new Promise<Response>(resolve => {
          setTimeout(() => resolve(freshResponse(geminiOkBody())), 5000);
        });
      case 'throw-enoent':
        this.stats.errors++;
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      case 'throw-eacces':
        this.stats.errors++;
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      case 'circuit-open':
        this.stats.errors++;
        throw new Error('Circuit breaker open — not implemented (Phase 3)');
      default:
        return freshResponse(geminiOkBody());
    }
  }
}

// ── Pre-built AI fault profiles ──────────────────────────

export const AI_FAULT_PROFILES: Record<string, FaultProfile> = {
  silentAiDrop: {
    name: 'silentAiDrop',
    description: 'AI call hangs on 3rd request (repros t/1068)',
    faults: [{ target: 'ai-call', trigger: 'nth-call', effect: 'timeout', nthCall: 3 }],
  },
  tokenExhaustion: {
    name: 'tokenExhaustion',
    description: 'Rate-limit 429 on 5th request (repros t/1061)',
    faults: [{ target: 'ai-call', trigger: 'nth-call', effect: 'throw-429', nthCall: 5 }],
  },
  totalAiOutage: {
    name: 'totalAiOutage',
    description: 'All AI calls return 503',
    faults: [{ target: 'ai-call', trigger: 'always', effect: 'throw-503' }],
  },
  flakyNetwork: {
    name: 'flakyNetwork',
    description: '30% random timeouts',
    faults: [{ target: 'ai-call', trigger: 'random', effect: 'timeout', probability: 0.3 }],
  },
  authFailFast: {
    name: 'authFailFast',
    description: 'Auth fails immediately on every call (repros t/1062)',
    faults: [{ target: 'ai-call', trigger: 'always', effect: 'auth-fail' }],
  },
  fallbackChainExhaustion: {
    name: 'fallbackChainExhaustion',
    description: 'All backends return 503 — entire fallback chain fails',
    faults: [{ target: 'ai-call', trigger: 'always', effect: 'throw-503' }],
  },
};

// ── Storage fault profiles (crash recovery, t/1149) ─────

export interface StorageFault {
  target: 'writeFileSync' | 'renameSync' | 'readFileSync';
  effect: 'throw-enospc' | 'throw-eacces' | 'throw-exdev' | 'corrupt-json' | 'nth-call-throw';
  nthCall?: number;
  errorCode?: string;
}

export interface StorageFaultProfile {
  name: string;
  description: string;
  faults: StorageFault[];
}

export const STORAGE_FAULT_PROFILES: Record<string, StorageFaultProfile> = {
  checkpointWriteEnospc: {
    name: 'checkpointWriteEnospc',
    description: 'writeFileSync throws ENOSPC (disk full)',
    faults: [{ target: 'writeFileSync', effect: 'throw-enospc' }],
  },
  checkpointWriteEacces: {
    name: 'checkpointWriteEacces',
    description: 'writeFileSync throws EACCES (permission denied)',
    faults: [{ target: 'writeFileSync', effect: 'throw-eacces' }],
  },
  corruptPartialJson: {
    name: 'corruptPartialJson',
    description: 'readFileSync returns malformed JSON for partial checkpoint',
    faults: [{ target: 'readFileSync', effect: 'corrupt-json' }],
  },
  renameFailure: {
    name: 'renameFailure',
    description: 'renameSync throws EXDEV (cross-device rename)',
    faults: [{ target: 'renameSync', effect: 'throw-exdev' }],
  },
};

export function makeStorageError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

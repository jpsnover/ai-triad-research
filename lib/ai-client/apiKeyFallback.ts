// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * API-key routing rules, shared by every TS path (t/4105, the TS half of PowerShell's t/4102 and t/4087).
 * Each rule lives here ONCE, ported from scripts/AIEnrich.psm1 with the same map and wording:
 *
 *  1. AI_API_KEY is a fallback for the GEMINI backend only (PI decision 2026-10-07). AI_API_KEY is typically a
 *     Google key, so sending it to another provider leaks a credential to a third party.
 *     - At CALL time, `resolveGenericFallbackKey` throws for any other backend when AI_API_KEY is set.
 *     - In LISTING contexts (key presence, status, discovery loops), the caller softens ONLY this refusal,
 *       keyed on its kind (`isKeyRoutingRefusal(err, 'AIApiKeyGeminiOnlyRefused')`), to "not configured" plus a
 *       WARN reading LISTING_WARN (SO e/284#2 cond 1, #10). Never catch everything.
 *  2. A key may only reach the backend it's named for (`assertKeyForBackend`, PowerShell's
 *     Assert-AIApiKeyBackend). Before any send, a key whose value equals ANOTHER backend's named variable is
 *     refused, whatever route it took (explicit, stored, own env or fallback). The error names the variable,
 *     never the key.
 *
 * Both refusals are a `KeyRoutingRefusal`, and failover never treats one as a reason to try the next provider
 * (SO e/284#12 cond 6): a refused primary throws to the caller, it is never served by another company.
 *
 * No key value ever appears in an error message or a log line (SO e/284#2 cond 4).
 */

import { ActionableError } from '../debate/errors.js';

export const GENERIC_FALLBACK_ENV = 'AI_API_KEY';
export const GENERIC_FALLBACK_BACKEND = 'gemini';
/** The listing-path WARN text, word for word the PowerShell half's (e/284#8), so the two read the same. */
export const LISTING_WARN = 'AI_API_KEY applies to gemini only';

export type KeyRefusalKind = 'AIApiKeyGeminiOnlyRefused' | 'AIApiKeyForeignCredentialRefused';

/**
 * A refusal to send a key to a backend. It is NOT a provider failure: retry, key rotation and failover must
 * rethrow it, never absorb it (SO e/284#12 cond 6). `name` stays 'ActionableError' so existing error mapping is
 * unchanged; test the kind with `isKeyRoutingRefusal`, which reads the property, so it survives a realm or
 * serialization boundary where `instanceof` would not.
 */
export class KeyRoutingRefusal extends ActionableError {
  public readonly refusalKind: KeyRefusalKind;

  constructor(kind: KeyRefusalKind, opts: ConstructorParameters<typeof ActionableError>[0]) {
    super(opts);
    this.refusalKind = kind;
    Object.setPrototypeOf(this, KeyRoutingRefusal.prototype); // ActionableError pins its own prototype
  }
}

/** True when `err` is a key-routing refusal (of `kind`, when given). */
export function isKeyRoutingRefusal(err: unknown, kind?: KeyRefusalKind): err is KeyRoutingRefusal {
  const k = (err as { refusalKind?: unknown } | null | undefined)?.refusalKind;
  return (k === 'AIApiKeyGeminiOnlyRefused' || k === 'AIApiKeyForeignCredentialRefused') && (kind === undefined || k === kind);
}

/** Each backend's own key variables, in priority order. MUST match PowerShell's $script:AIApiKeyEnvVarMap. */
export const BACKEND_KEY_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
  gemini: ['GEMINI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  azure: ['AZURE_OPENAI_API_KEY'],
  zai: ['ZAI_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY'],
  xai: ['XAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
};

/** Local backends that take no key: AI_API_KEY is neither their fallback nor a reason to refuse them. */
export const KEYLESS_BACKENDS: readonly string[] = ['ollama'];

type Env = Readonly<Record<string, string | undefined>>;
const processEnv = (): Env => (typeof process !== 'undefined' && process.env ? process.env : {});
const ownVars = (backend: string): readonly string[] => BACKEND_KEY_ENV_VARS[backend] ?? [`${backend.toUpperCase()}_API_KEY`];

/**
 * The variable(s) to name in a missing-key hint, as PowerShell does: gemini offers "or AI_API_KEY",
 * every other backend names only its own variable(s).
 */
export function keyHint(backend: string): string {
  const vars = [...ownVars(backend)];
  if (backend === GENERIC_FALLBACK_BACKEND) vars.push(GENERIC_FALLBACK_ENV);
  return vars.join(' or ');
}

/**
 * CALL-TIME AI_API_KEY fallback for `backend`, gemini only. Call it only after the backend's own sources (its
 * env vars, a key store) came up empty.
 * @throws ActionableError when `backend` isn't gemini and AI_API_KEY is set
 */
export function resolveGenericFallbackKey(backend: string, env: Env = processEnv()): string | undefined {
  const fallback = env[GENERIC_FALLBACK_ENV];
  if (!fallback || KEYLESS_BACKENDS.includes(backend)) return undefined;
  if (backend === GENERIC_FALLBACK_BACKEND) return fallback;
  throw new KeyRoutingRefusal('AIApiKeyGeminiOnlyRefused', {
    goal: `Resolve an API key for the '${backend}' backend`,
    problem: `no key for backend '${backend}': ${GENERIC_FALLBACK_ENV} is set, but it is the fallback for the gemini backend only and is never sent to '${backend}' (t/4102)`,
    location: 'lib/ai-client/apiKeyFallback.ts resolveGenericFallbackKey',
    nextSteps: [`set ${keyHint(backend)}, or pass a key issued for '${backend}'`],
  });
}

/** The hint a listing shows for a non-gemini backend that AI_API_KEY would otherwise have "configured". */
export function listingNotConfiguredHint(backend: string, env: Env = processEnv()): string | undefined {
  if (backend === GENERIC_FALLBACK_BACKEND || !env[GENERIC_FALLBACK_ENV]) return undefined;
  return `${LISTING_WARN}; set ${keyHint(backend)}`;
}

/**
 * The env variable of a backend OTHER than `backend` that holds exactly `key`, or undefined. A key equal to the
 * backend's own variable is never foreign. Port of PowerShell's Get-AIApiKeyForeignOwner.
 */
export function foreignKeyOwner(key: string, backend: string, env: Env = processEnv()): string | undefined {
  if (!key) return undefined;
  if ((BACKEND_KEY_ENV_VARS[backend] ?? []).some((v) => env[v] === key)) return undefined;
  for (const other of Object.keys(BACKEND_KEY_ENV_VARS).sort()) {
    if (other === backend) continue;
    for (const v of BACKEND_KEY_ENV_VARS[other]) {
      const value = env[v];
      if (value && value === key) return v;
    }
  }
  return undefined;
}

/**
 * Refuse, before any send, a key that is another backend's credential (port of Assert-AIApiKeyBackend, t/4087).
 * @param route  how the key arrived, for the message, e.g. 'explicit', 'stored', 'AI_API_KEY fallback'
 * @throws ActionableError naming the variable, never the key
 */
export function assertKeyForBackend(key: string, backend: string, route: string, env: Env = processEnv()): void {
  const owner = foreignKeyOwner(key, backend, env);
  if (!owner) return;
  throw new KeyRoutingRefusal('AIApiKeyForeignCredentialRefused', {
    goal: `Resolve an API key for the '${backend}' backend`,
    problem: `the ${route} key is the value of ${owner}, another backend's credential; it will not be sent to '${backend}' (t/4087)`,
    location: 'lib/ai-client/apiKeyFallback.ts assertKeyForBackend',
    nextSteps: [`set the '${backend}' backend's own key variable, or pass a key issued for '${backend}'`],
  });
}

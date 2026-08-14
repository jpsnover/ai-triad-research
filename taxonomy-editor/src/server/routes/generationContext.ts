// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
//
// Shared generation-context resolution + backend-entitlement gate (t/2625).
//
// INVARIANT: every route that runs server-side AI generation from a user-supplied model
// MUST resolve through `resolveGenerationContext` (which pins the free tier's model and
// derives the target backend) and gate with `enforceBackendAllowed` BEFORE calling the
// provider. Otherwise a free/restricted-tier caller can select a premium backend via
// `body.model` (the class this closes: /api/evidence-qbaf + /api/ai/search bypassed it;
// chat-stream + /api/ai/generate already routed through this). Extracted from the verbatim
// copies previously duplicated in routes/ai.ts and routes/chat.ts.

import http from 'http';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { DEFAULT_MODEL } from '../../../../lib/ai-client/index.js';
import * as proxyTiers from '../ai/proxyTiers.js';
import * as ai from '../ai/aiBackends.js';
import { type AIBackend } from '../config.js';
import { getClientIp } from '../httpKit.js';
import { callerTierIdentity } from '../security/accessControl.js';
import { getCurrentUser } from '../security/userContext.js';

export type ResolvedTier = ReturnType<typeof proxyTiers.resolveTier>;

/** ALS-verified request identity, not raw headers (t/848). */
function callerIdentity(): { principalName: string; idp: string } {
  return callerTierIdentity(getCurrentUser());
}

/** Resolve the caller's tier + rate-limit key + effective (pinned-for-free) model +
 *  target backend from the request. Pure setup — sends no response. */
export function resolveGenerationContext(req: http.IncomingMessage, model: string | undefined): {
  tier: ResolvedTier; isFree: boolean; limitKey: string; effectiveModel: string | undefined; backend: AIBackend;
} {
  const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
  const tier = proxyTiers.resolveTier(principalName, idp);
  const isFree = tier.level === 'free';
  // Free tier (t/793): keyed per-IP (all keyless users would otherwise share one
  // bucket), with the model pinned. Other tiers key by user and honour the request model.
  const limitKey = isFree ? `free:${getClientIp(req)}` : (principalName || '_anonymous');
  const effectiveModel = isFree ? (tier.pinnedModel ?? model) : model;
  const backend = ai.resolveBackend(effectiveModel || DEFAULT_MODEL);
  return { tier, isFree, limitKey, effectiveModel, backend };
}

/** 403 + record when the resolved backend isn't allowed on the caller's tier.
 *  Returns true when it has already sent a response (caller must return). */
export function enforceBackendAllowed(res: http.ServerResponse, tier: ResolvedTier, backend: AIBackend): boolean {
  if (proxyTiers.isBackendAllowed(tier, backend)) return false;
  // t/1463: record the tier context so a tier-restriction 403 is a one-line FR read
  // instead of a server.ts → proxyTiers → runtimeConfig code trace.
  getGlobalRecorder()?.record({
    type: 'ai.error', component: 'ai-generate', level: 'warn',
    message: `Backend '${backend}' not available on '${tier.level}' tier`,
    data: { tier_level: tier.level, requested_backend: backend, allowed_backends: tier.allowedBackends },
  });
  res.writeHead(403);
  res.end(JSON.stringify({ error: `Backend '${backend}' not available on your tier`, tier_level: tier.level, requested_backend: backend }));
  return true;
}

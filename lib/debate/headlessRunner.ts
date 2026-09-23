// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared headless debate runner (t/3599).
 *
 * Both inquiry job runners (server t/3578, Electron t/3579) satisfy
 * `InquiryPipelineDeps.runDebate` by calling this and closing over their
 * host-specific adapter and taxonomy. `cli.ts` and `mcp-server.ts` also
 * converge here — no host keeps its own engine construction.
 *
 * Host-specific concerns (keys, filesystem, HTTP, job lifecycle) stay out.
 */

import { DebateEngine } from './debateEngine.js';
import type { DebateConfig, DebateProgress } from './debateEngine.js';
import type { AIAdapter, ExtendedAIAdapter } from './aiAdapter.js';
import type { LoadedTaxonomy } from './taxonomyLoader.js';
import type { DebateSession } from './types/session.js';
import { deriveTerminationReason } from './calibrationLogger/extract.js';
import type { TerminationReason } from './calibrationLogger/extract.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

export type { TerminationReason };

export interface HeadlessDebateResult {
  session: DebateSession;
  terminationReason: TerminationReason;
}

/**
 * Run a debate to completion and return the session + termination reason.
 *
 * `deriveTerminationReason` is wrapped defensively: if it throws (unexpected
 * session shape), the result degrades to `'unknown'` and a WARN is emitted so
 * the session is never lost to a classification error.
 */
export async function runHeadlessDebate(
  config: DebateConfig,
  adapter: AIAdapter | ExtendedAIAdapter,
  taxonomy: LoadedTaxonomy,
  onProgress?: (p: DebateProgress) => void,
): Promise<HeadlessDebateResult> {
  const engine = new DebateEngine(config, adapter, taxonomy);
  const session = await engine.run(onProgress);

  let terminationReason: TerminationReason;
  try {
    terminationReason = deriveTerminationReason(session);
  } catch (err) {
    terminationReason = 'unknown';
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'headlessRunner',
      level: 'warn',
      message: `deriveTerminationReason threw unexpectedly — degrading to 'unknown' so session is not lost (session id: ${session.id})`,
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
  }

  return { session, terminationReason };
}

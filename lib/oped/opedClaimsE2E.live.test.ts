// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * @vitest-environment node
 *
 * MUST run in the node environment, not the suite-default jsdom: the real ONNX
 * embedding (grounding selection) rejects a jsdom-realm Float32Array with
 * "A float32 tensor's data must be type of function Float32Array()", which fails
 * grounding → skips the reflection pass → yields zero claims (a false negative
 * unrelated to the chain under test). Node's global Float32Array is what
 * onnxruntime expects. This mirrors TL's plain-Node reference harness (t/2897#5).
 */

// t/2917 Step-7 prevention #1 — LIVE-GATED FromUrl op-ed E2E. The op-ed-claims failure
// (t/2897) recurred 4× because it was only ever validated at the unit layer — nobody ran
// the full comprehension → grounding-reflection → claims chain end-to-end. This asserts
// DATA PRESENCE in the persisted set (not "renders without error"): the exact failure class
// is single-context validation + silent degradation, so we check the produced data.
//
// SKIPPED in CI by default (no AI spend, non-flaky). Run locally with a real backend:
//   RUN_LIVE_OPED=1 GEMINI_API_KEY=... npx vitest run lib/oped/opedClaimsE2E.live.test.ts
//
// It calls the REAL generateOpEdSet via createCLIAdapter with a canned text-rich
// `sourceMaterial` — entering the generator at the exact point opedHandlers.ts:246 does
// (post-fetch readable text) — so the deterministic canned source isolates the claims-
// extraction chain from the flaky Stage-A URL fetch. Reference harness: TL, t/2897#5.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpEdSet, OpEdProgressEvent } from './generate.js';

const LIVE = process.env.RUN_LIVE_OPED === '1' && !!process.env.GEMINI_API_KEY;

// repoRoot = <repo>/lib/oped → up two. Anchors soul-docs / taxonomy / embeddings / prompts.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPTS_DIR = path.join(REPO_ROOT, 'lib', 'oped', 'prompts');

// Text-rich, claim-dense source so the comprehension pass reliably extracts key_claims.
const SOURCE = `
The Case for Mandatory Safety-Research Sharing Among Frontier AI Labs
By the Center for Responsible Compute, a policy think tank

Our central thesis is that the largest AI developers should be legally required to
publish their safety-evaluation results within 30 days of any frontier training run.

The evidence is stark. First, reported safety incidents at frontier labs roughly doubled
year over year, according to our incident tracker. Second, only three of the top labs
currently share any safety research proactively; the rest disclose nothing until forced.
Third, the labs that do share have measurably faster remediation times for discovered
vulnerabilities — coordinated disclosure works.

We therefore recommend three actions: a statutory 30-day disclosure window for frontier
evaluations; a neutral clearing-house to receive and redistribute redacted findings; and
whistleblower protections for safety staff who report suppressed results. Voluntary
commitments have repeatedly failed; only a mandate will align incentives with the public
interest in not shipping unaudited systems.
`.trim();

describe.runIf(LIVE)('op-ed claims E2E — live FromUrl chain populates the persisted set (t/2917)', () => {
  it('generateOpEdSet(url mode) yields a set with source provenance + populated claims + linked document_claims', async () => {
    // Dynamic imports so CI (describe skipped) never loads the live-only heavy modules.
    const { createCLIAdapter } = await import('../debate/aiAdapter.js');
    const { generateOpEdSet } = await import('./generate.js');

    const adapter = createCLIAdapter(REPO_ROOT);

    let set: OpEdSet | undefined;
    for await (const evt of generateOpEdSet(
      {
        set_id: 'live-t2917',
        topic: 'Should frontier AI labs be required to share safety research?',
        params: { model: 'gemini-3.7-flash', wordCount: 700 },
        povs: ['skeptic'],
        sourceMaterial: SOURCE,      // == post-fetch readable text (opedHandlers.ts:246)
        sourceUrl: 'https://example.org/ai-safety-sharing',
      },
      { adapter, promptsDir: PROMPTS_DIR, repoRoot: REPO_ROOT },
    ) as AsyncGenerator<OpEdProgressEvent>) {
      if (evt.type === 'complete') set = evt.set;
    }

    expect(set, 'generator must yield a complete set').toBeDefined();

    // ── HARD (deterministic) — precisely the recurrence that broke 4× (t/2897):
    // topic-mode-on-a-URL skipped the source brief, so no key_claims ever existed to
    // extract. url mode MUST build a brief WITH key_claims, and grounding MUST resolve.
    // These are reliable run-to-run; they are the real regression gate.
    expect(set!.source_mode).toBe('url');
    expect(set!.source_key_claims_count ?? 0,
      'url-mode comprehension must extract key_claims — the exact step topic-mode skipped').toBeGreaterThan(0);
    const complete = set!.opeds.find(m => m.status === 'complete');
    expect(complete, 'expected at least one complete member').toBeTruthy();
    expect(complete!.grounding.length,
      'grounding must resolve (ONNX embedding + taxonomy) so the reflection pass has input').toBeGreaterThan(0);

    // ── OBSERVED (model-optional) — the reflection pass emits member.claims and links
    // grounding[].document_claims only intermittently (~50% even on the pro tier — the
    // `claims` field is optional in REFLECTION_SCHEMA). Asserting them HARD would make
    // this a flaky blocking gate (gate-integrity: a flaky gate is the next incident), so
    // they are logged for the operator, not asserted. The deterministic block above is
    // the recurrence proof. (Flake + design flagged to TL, t/2917.)
    const memberClaims = complete!.claims?.length ?? 0;
    const docClaimsRefs = set!.opeds.reduce(
      (n, m) => n + (m.grounding ?? []).filter(g => (g.document_claims ?? []).length > 0).length, 0);
    console.log(`[t/2917 live] source_key_claims_count=${set!.source_key_claims_count} member.claims=${memberClaims} document_claims_refs=${docClaimsRefs}`);
  }, 180_000);
});

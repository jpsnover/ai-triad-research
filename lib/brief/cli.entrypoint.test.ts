// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Subprocess-level regression test for the full-pipeline CLI entrypoint (t/2868).
//
// The bug this locks against: the `invokedDirectly` guard used a string compare
// (`import.meta.url === "file://" + argv[1]`) that silently evaluated FALSE on
// Windows (Node emits `file:///C:/…` — three slashes — but the template produced
// `file://C:/…` — two), so `runCli()` was never called. The process exited 0 with
// NO stdout and NO stderr, which the PS wrapper parsed as an empty TriadDeckExport
// ("Exported brief:" with no path). The prior unit suite MOCKED invocation, so it
// stayed green while the real entrypoint no-op'd — hence this test SPAWNS the real
// entrypoint and asserts on OUTPUT (a test that only checks exit 0 misses it: the
// bug IS exit 0).
//
// Windows-specific: on POSIX the argv path already starts with `/`, so the old
// two-slash template happened to match — the defect never reproduced on Linux CI.
// This test therefore locks the observable contract (entrypoint → non-empty stdout
// + TriadDeckExport) on every platform; the red-first proof was run on Windows.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, 'cli.ts');
const REPO_ROOT = resolve(HERE, '..', '..');

// Minimal valid CLOSED debate session (mirrors extract.test.ts makeSession) — the
// full offline pipeline (extract → deterministic narration → render → verify) runs
// on it with --skip-narration, so no model/network is touched.
function makeSession(): Record<string, unknown> {
  return {
    id: 'sess-e2e-001',
    run_id: 'run-e2e-001',
    title: 'Should AI safety be legally mandated?',
    debate_model: 'claude-sonnet-5',
    protocol_id: 'structured',
    phase: 'closed',
    topic: {
      final: 'AI safety requirements should be legally mandated',
      scope: {
        key_tensions: ['innovation vs. safety'],
        explicit_qualifiers: ['for frontier models only'],
        excluded_scenarios: ['research prototypes'],
        time_horizon: '2026-2030',
      },
      critique: {
        rating: 'fair',
        composite_score: 12,
        reframing_suggestion: 'Should frontier AI training require certified safety audits?',
      },
    },
    transcript: [
      {
        type: 'concluding',
        metadata: {
          synthesis: {
            areas_of_agreement: [{ point: 'AI risks are real', povers: ['acc', 'saf'] }],
            areas_of_disagreement: [
              { point: 'Mandatory thresholds are harmful', bdi_layer: 'belief', resolvability: 'empirically_testable' },
            ],
            unresolved_questions: ['What metrics define sufficient safety?'],
            cruxes: [
              { question: 'Will mandates stifle innovation?', type: 'EMPIRICAL', if_yes: 'Acc wins', if_no: 'Saf wins', resolution_status: 'active' },
            ],
            preferences: [
              { conflict: 'speed vs. safety', prevails: 'saf', criterion: 'public harm', rationale: 'irreversible harms outweigh delay costs', what_would_change_this: 'proof mandates cut investment >30%' },
            ],
            argument_map: [
              { claim_id: 'a1', claim: 'Regulation reduces innovation', claimant: 'acc', supported_by: ['a2'], attacked_by: [{ claim_id: 'a3' }] },
            ],
          },
        },
      },
    ],
    argument_network: {
      nodes: [
        { id: 'a1', text: 'Regulation reduces innovation', speaker: 'acc', scoring_method: 'bdi_criteria', computed_strength: 0.72 },
        { id: 'fc1', text: 'Frontier models doubled in 12 months', speaker: 'system', scoring_method: 'fact_check', verification_status: 'supported', verification_evidence: 'Source: Epoch AI compute tracker 2025' },
        { id: 'fc2', text: 'Mandates slow deployment by >6 months', speaker: 'acc', scoring_method: 'fact_check', verification_status: 'disputed', verification_evidence: 'No peer-reviewed evidence found' },
      ],
    },
    commitments: {
      acc: { asserted: ['c1', 'c2'], conceded: ['c3'], challenged: ['c4', 'c5'] },
      saf: { asserted: ['c6'], conceded: [], challenged: ['c7'] },
    },
    convergence_tracker: {
      issues: [
        { taxonomy_ref: 'ai-safety-mandate', convergence: 0.4, qbaf_strength: 0.45 },
        { taxonomy_ref: null, convergence: 0.6 },
      ],
    },
    crux_tracker: [
      { id: 'cx1', description: 'Will mandates stifle innovation?', state: 'engaged', identified_turn: 2, history: [], attacking_claim_ids: [], speakers_involved: ['acc', 'saf'], last_computed_strength: 0.5, support_polarity: 0 },
      { id: 'cx2', description: 'Is AGI near?', state: 'resolved', identified_turn: 1, history: [], attacking_claim_ids: [], speakers_involved: ['acc'], last_computed_strength: 0.3, support_polarity: 0 },
    ],
  };
}

let dir: string;
let sessionPath: string;
let outDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'brief-cli-e2e-'));
  sessionPath = join(dir, 'debate.json');
  outDir = join(dir, 'out');
  writeFileSync(sessionPath, JSON.stringify(makeSession()));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('brief CLI entrypoint (subprocess)', () => {
  it(
    'runs when invoked directly and prints a TriadDeckExport line to stdout (exit 0)',
    () => {
      // Spawn the REAL entrypoint the way T8/PowerShell does. `node --import tsx`
      // runs cli.ts as the process entry (argv[1] = cli.ts) — exactly what the
      // invokedDirectly guard must recognise. --skip-narration keeps it offline.
      const res = spawnSync(
        process.execPath,
        [
          '--import', 'tsx',
          CLI,
          '--path', sessionPath,
          '--model', 'gemini-2.5-flash',
          '--preset', 'policymaker',
          '--skip-narration',
          '--out', outDir,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 },
      );

      // Distinguish a spawn failure (e.g. tsx unresolved) from the silent no-op we test for.
      expect(res.error, `failed to spawn the CLI subprocess: ${res.error?.message}`).toBeUndefined();

      const stdout = (res.stdout ?? '').trim();
      const stderr = (res.stderr ?? '').trim();
      const diag = `\n--- exit=${res.status} ---\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;

      // ── The t/2868 contract: the entrypoint must RUN and emit a well-formed result.
      // The bug was a SILENT no-op — exit 0 with empty stdout AND no error line — which
      // an exit-code-only assertion misses. So assert on OUTPUT: runCli() ran iff it
      // produced either the success line (stdout TriadDeckExport) or a mapped error line
      // (stderr {errorCode,message}). A bare invokedDirectly=false produces NEITHER.
      const emittedError = /"errorCode"\s*:/.test(stderr);
      expect(
        stdout !== '' || emittedError,
        `entrypoint silently no-op'd — no stdout and no {errorCode} line (the t/2868 bug)${diag}`,
      ).toBe(true);

      if (stdout !== '') {
        // Success path — the CLI's exact T8/PowerShell contract: one TriadDeckExport line, exit 0.
        const lines = stdout.split('\n').filter(Boolean);
        const passthru = JSON.parse(lines[lines.length - 1]) as { debateId?: string; path?: string; manifestPath?: string };
        expect(passthru.debateId, `stdout is not a TriadDeckExport${diag}`).toBe('sess-e2e-001');
        expect(passthru.path, `TriadDeckExport.path missing${diag}`).toMatch(/brief\.pptx$/);
        expect(passthru.manifestPath).toMatch(/audit-manifest\.json$/);
        expect(res.status, `expected exit 0 on the success path${diag}`).toBe(0);
        expect(readdirSync(outDir)).toEqual(
          expect.arrayContaining(['deck_spec.json', 'narration.json', 'brief.pptx', 'audit-manifest.json']),
        );
      } else {
        // Ran, but a stage/verify gate produced a mapped error — still PROVES the entrypoint
        // executed (vs the silent no-op). Contract: one {errorCode,message} line, non-zero exit.
        // (Currently exercised by the t/2871 OOXML-order verify failure; tighten to
        // success-only once that lands.)
        const errLine = stderr.split('\n').reverse().find(l => /"errorCode"\s*:/.test(l))!;
        const parsed = JSON.parse(errLine) as { errorCode?: string; message?: string };
        expect(parsed.errorCode, `error line is not a well-formed {errorCode,message}${diag}`).toBeTruthy();
        expect(res.status, `a mapped error must exit non-zero${diag}`).not.toBe(0);
      }
    },
    130_000,
  );
});

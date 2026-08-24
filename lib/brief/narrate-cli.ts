// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief NARRATE-stage debug CLI (t/2873). Runs ONLY narrate() on a loaded deck_spec —
// no extract/render/verify — so a model's narration output can be inspected in
// isolation while diagnosing zero-entry / bad-trace failures (the t/2872 class).
// Consumed by PowerShell's Test-BriefNarrationStage (contract: t/2873#2), wrapped
// via tsx the same way Export-TriadDebateBrief wraps the full-pipeline cli.ts.
//
//   tsx lib/brief/narrate-cli.ts --spec <deck_spec.json> --model <id> \
//     [--preset conference] [--checker-model <id>] [--skip-narration]
//
// Output contract (t/2873#2):
//   A COMPLETED narrate run — success OR failure — is DATA, not an error: stdout gets
//   exactly one JSON line { entryCount, audienceQuestionCount, narration, checkerReport?,
//   errors } and the process exits 0. A narrate() throw (schema/trace/model) is CAPTURED
//   into errors[] with narration=null/entryCount=0 — the diagnostic wants to see the
//   failed output, not a stack trace. Only arg / spec-file / infra faults exit ≠0 with a
//   { errorCode, message } line on stderr (same shape as cli.ts).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ActionableError, errorMessage } from '../debate/errors.js';
import { createCLIAdapter } from '../debate/aiAdapter.js';
import { resolveRepoRoot } from '../debate/taxonomyLoader.js';
import type { AIAdapter } from '../debate/aiAdapter.js';
import { narrate } from './narrate.js';
import type { CheckerReport } from './narrate.js';
import type { DeckSpec, Narration, BriefPreset, ModelSource } from './types.js';

const LOCATION = 'lib/brief/narrate-cli.ts';
const PRESETS: readonly BriefPreset[] = ['policymaker', 'conference', 'classroom'];
const MODEL_SOURCES: readonly ModelSource[] = ['Explicit', 'Global', 'Default'];

/** exit≠0 codes — infra/arg/spec-file faults ONLY (a narrate failure is DATA, not this). */
export type NarrateCliErrorCode = 'SpecFileInvalid';

export interface NarrateCliArgs {
  spec: string;
  model: string;
  modelSource: ModelSource;
  preset: BriefPreset;
  checkerModel?: string;
  checkerModelSource?: ModelSource;
  skipNarration: boolean;
}

/** One JSON line on stdout for a completed run. */
export interface NarrateCliOutput {
  entryCount: number;
  audienceQuestionCount: number;
  narration: Narration | null;
  checkerReport?: CheckerReport;
  errors: string[];
}

function fail(problem: string, nextSteps: string[]): never {
  throw new ActionableError({
    goal: 'Run the Brief narrate stage in isolation on a deck_spec',
    problem,
    location: LOCATION,
    nextSteps,
  });
}

export function parseArgs(argv: string[]): NarrateCliArgs {
  const map = new Map<string, string>();
  let skipNarration = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-narration') { skipNarration = true; continue; }
    if (a.startsWith('--')) { map.set(a.slice(2), argv[++i]); }
  }

  const spec = map.get('spec');
  const model = map.get('model');
  if (!spec || !model) {
    fail('--spec and --model are required', [
      'tsx lib/brief/narrate-cli.ts --spec <deck_spec.json> --model <id> [--preset conference] [--checker-model <id>] [--skip-narration]',
    ]);
  }

  const preset = (map.get('preset') ?? 'conference') as BriefPreset;
  if (!PRESETS.includes(preset)) fail(`Unknown preset "${preset}"`, [`Use one of: ${PRESETS.join(', ')}`]);

  const modelSource = (map.get('model-source') ?? 'Explicit') as ModelSource;
  if (!MODEL_SOURCES.includes(modelSource)) fail(`Unknown model-source "${modelSource}"`, [`Use one of: ${MODEL_SOURCES.join(', ')}`]);
  const checkerModelSource = map.get('checker-model-source') as ModelSource | undefined;
  if (checkerModelSource && !MODEL_SOURCES.includes(checkerModelSource)) {
    fail(`Unknown checker-model-source "${checkerModelSource}"`, [`Use one of: ${MODEL_SOURCES.join(', ')}`]);
  }

  return {
    spec: spec!,
    model: model!,
    modelSource,
    preset,
    checkerModel: map.get('checker-model'),
    checkerModelSource,
    skipNarration,
  };
}

function emitError(code: NarrateCliErrorCode, message: string): void {
  process.stderr.write(JSON.stringify({ errorCode: code, message }) + '\n');
}

/** Guard adapter for --skip-narration: narrate() builds deterministic narration
 *  without a model, so an actual call is a bug, not a silent no-op. */
const skipNarrationGuardAdapter: AIAdapter = {
  generateText: async () => {
    throw new ActionableError({
      goal: 'Produce narration text',
      problem: 'The model adapter was invoked under --skip-narration (deterministic mode)',
      location: LOCATION,
      nextSteps: ['Remove --skip-narration to narrate with a model, or report this as a bug'],
    });
  },
};

export interface RunResult { exitCode: number }

export async function runCli(argv: string[]): Promise<RunResult> {
  let args: NarrateCliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write((err instanceof ActionableError ? err.message : String(err)) + '\n');
    return { exitCode: 2 };
  }

  // ── read + parse the deck_spec (a bad/unreadable spec file is an infra fault → exit≠0) ──
  let spec: DeckSpec;
  try {
    const parsed = JSON.parse(await readFile(args.spec, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('deck_spec is not a JSON object');
    spec = parsed as DeckSpec;
  } catch (err) {
    emitError('SpecFileInvalid', `Cannot read/parse deck_spec at ${args.spec}: ${errorMessage(err)}`);
    return { exitCode: 1 };
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolveRepoRoot(__dirname);
  const adapter = args.skipNarration ? skipNarrationGuardAdapter : createCLIAdapter(repoRoot);

  // ── run ONLY narrate; CAPTURE a throw into errors[] (it is the diagnostic, not a fault) ──
  const out: NarrateCliOutput = { entryCount: 0, audienceQuestionCount: 0, narration: null, errors: [] };
  try {
    const { narration, checkerReport } = await narrate({
      spec,
      preset: args.preset,
      modelId: args.model,
      modelSource: args.modelSource,
      checkerModelId: args.checkerModel,
      checkerModelSource: args.checkerModelSource,
      skipNarration: args.skipNarration,
    }, adapter);
    out.narration = narration;
    out.entryCount = narration.entries.length;
    out.audienceQuestionCount = narration.audience_questions.length;
    if (checkerReport) out.checkerReport = checkerReport;
  } catch (err) {
    out.errors.push(errorMessage(err));
  }

  process.stdout.write(JSON.stringify(out) + '\n');
  return { exitCode: 0 };
}

// Executed directly (not imported): run over process.argv and set the exit code.
// Resolved-path guard (compare fileURLToPath === path.resolve(argv[1])) — a hand-built
// file:// string compare silently fails on Windows (t/2868).
const invokedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  runCli(process.argv.slice(2))
    .then(r => { process.exitCode = r.exitCode; })
    .catch((e: unknown) => {
      // Last-resort infra fault (e.g. adapter/registry construction) — wire-shaped error line.
      process.stderr.write(JSON.stringify({ errorCode: 'SpecFileInvalid', message: String(e) }) + '\n');
      process.exitCode = 1;
    });
}

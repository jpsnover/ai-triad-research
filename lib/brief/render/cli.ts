// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — node CLI entrypoint for the offline pipeline (consumed by T8 PS
// local mode). Runs the deterministic render with no server and no model call.
// PDF is NOT produced here (Electron-only); the CLI reports that actionably
// rather than silently omitting the format (TL t/2802#2).
//
//   node render/cli.js --spec deck_spec.json --narration narration.json \
//     --preset conference --out ./brief.pptx [--pdf]

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionableError } from '../../debate/errors.js';
import type { DeckSpec, Narration, BriefPreset } from '../types.js';
import { render } from './index.js';

const LOCATION = 'lib/brief/render/cli.ts';
const PRESETS: readonly BriefPreset[] = ['policymaker', 'conference', 'classroom'];

interface CliArgs {
  spec: string;
  narration: string;
  preset: BriefPreset;
  out: string;
  pdf: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  let pdf = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdf') { pdf = true; continue; }
    if (a.startsWith('--')) { map.set(a.slice(2), argv[++i]); }
  }
  const spec = map.get('spec');
  const narration = map.get('narration');
  const preset = (map.get('preset') ?? 'conference') as BriefPreset;
  const out = map.get('out') ?? './brief.pptx';
  if (!spec || !narration) {
    throw new ActionableError({
      goal: 'Render a debate brief offline',
      problem: '--spec and --narration are required',
      location: LOCATION,
      nextSteps: ['Pass --spec <deck_spec.json> --narration <narration.json> --preset <p> --out <file.pptx>'],
    });
  }
  if (!PRESETS.includes(preset)) {
    throw new ActionableError({
      goal: 'Render a debate brief offline',
      problem: `Unknown preset "${preset}"`,
      location: LOCATION,
      nextSteps: [`Use one of: ${PRESETS.join(', ')}`],
    });
  }
  return { spec, narration, preset, out, pdf };
}

export async function runCli(argv: string[], log: (m: string) => void = console.log): Promise<void> {
  const args = parseArgs(argv);
  const spec = JSON.parse(await readFile(args.spec, 'utf8')) as DeckSpec;
  const narration = JSON.parse(await readFile(args.narration, 'utf8')) as Narration;

  const result = await render({ spec, narration, preset: args.preset });
  await writeFile(args.out, result.pptxBytes);
  log(`Wrote ${args.out} (${result.slideModels.length} slides, preset=${args.preset})`);
  for (const w of result.warnings) log(`  warning: ${w}`);

  if (args.pdf) {
    log('PDF requires the desktop app: the offline CLI renders .pptx only. ' +
        'Open the brief in the AITriad desktop app to export a PDF (printToPDF is Electron-only).');
  }
}

// Executed directly (not imported): run the CLI over process.argv.
// Compare RESOLVED PATHS, not a hand-built file:// string — the string compare
// silently failed on Windows (three-slash file:/// vs two), leaving the CLI a
// no-op that exited 0 with no output (t/2868, same genus as lib/brief/cli.ts).
const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  runCli(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof ActionableError ? e.message : String(e));
    process.exitCode = 1;
  });
}

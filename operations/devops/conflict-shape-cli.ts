// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Conflict-file shape validation CLI (t/3953). Prevention follow-up for t/3948: a writer wrote
// `linked_taxonomy_nodes` as a doubly-nested array (`[["id"]]`) into conflict files on
// ai-triad-data, undetected until it broke CI for every downstream code PR. This CLI is what the
// warn-first data-repo hook (conflicts-shape-check) shells out to, so the check runs the SAME
// rule the editor already enforces — never a second, drifting implementation of the shape.
//
//   tsx --tsconfig <taxonomy-editor>/tsconfig.json operations/devops/conflict-shape-cli.ts --input <file.json>
//
// Input: a JSON array of { path: string, content: unknown }, one entry per changed
// conflicts/*.json file — `content` is that file's full parsed JSON, in whichever shape it was
// found (see candidatesOf below). `path` is carried through into error messages so a caller
// checking several files at once can tell which file a reported problem belongs to.
//
// Output contract (mirrors lib/schema/pov-tags-cli.ts): stdout's LAST line is exactly one JSON
// object: { "checked": <conflicts examined>, "invalid": <conflicts with problems>,
// "errors": [ "<path>: <zod path>: <message>", … ] }
// Exit 0 = every conflict valid; exit 1 = one or more invalid (errors lists them); any other
// exit = the check could not run (bad input, unreadable schema). Callers must treat anything but
// 0 as "do not write" / "could not verify".

import { readFileSync } from 'node:fs';
import { conflictFileSchema } from '../../taxonomy-editor/src/renderer/utils/validation.js';

function readInput(argv: string[]): string {
  const i = argv.indexOf('--input');
  if (i >= 0) {
    if (!argv[i + 1]) throw new Error('--input needs a file path');
    return readFileSync(argv[i + 1], 'utf8');
  }
  return readFileSync(0, 'utf8');
}

/**
 * A conflicts/*.json file has been written in more than one shape over time:
 *  - an aggregate index: { conflicts: [ <conflict>, … ] } (conflicts/conflicts.json);
 *  - a bare single conflict object (the per-claim conflicts/conflict-<slug>.json files —
 *    this is the shape the t/3948 incident actually hit);
 *  - (defensively) a bare top-level array of conflicts, matching the other data-repo writers'
 *    `{nodes:[…]}`-adjacent conventions.
 * Returns the list of individual conflict candidates to validate, regardless of which shape.
 */
function candidatesOf(content: unknown): unknown[] {
  if (Array.isArray(content)) return content;
  if (content && typeof content === 'object' && Array.isArray((content as { conflicts?: unknown }).conflicts)) {
    return (content as { conflicts: unknown[] }).conflicts;
  }
  return [content];
}

try {
  const entries = JSON.parse(readInput(process.argv.slice(2)));
  if (!Array.isArray(entries)) throw new Error('input must be a JSON array of { path, content }');

  let checked = 0;
  let invalid = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof (entry as { path?: unknown }).path !== 'string') {
      errors.push(`entry without a string "path": ${JSON.stringify(entry)}`);
      invalid++;
      continue;
    }
    const { path, content } = entry as { path: string; content: unknown };
    const candidates = candidatesOf(content);
    const multi = candidates.length > 1;
    candidates.forEach((candidate, i) => {
      checked++;
      const result = conflictFileSchema.safeParse(candidate);
      if (!result.success) {
        invalid++;
        const tag = multi ? `[${i}]` : '';
        for (const issue of result.error.issues) {
          const zpath = issue.path.length > 0 ? issue.path.join('.') : '(root)';
          errors.push(`${path}${tag}: ${zpath}: ${issue.message}`);
        }
      }
    });
  }

  process.stdout.write(JSON.stringify({ checked, invalid, errors }) + '\n');
  process.exitCode = invalid > 0 ? 1 : 0;
} catch (err) {
  process.stderr.write(`conflict-shape-cli: could not run the check: ${(err as Error).message}\n`);
  process.exitCode = 2;
}

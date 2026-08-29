// t/3113 FIRE-ARM fixture — a deliberate data-root read to prove the promoted
// `local/no-raw-data-root-read: 'error'` gate REDS the `eslint src/` lint job on a
// directory run. This file is REVERTED within PR #1641 and must never reach main.
import fs from 'fs';
import { resolveDataPath } from './config.js';

export function __t3113FireArm(): string {
  const p = resolveDataPath('embeddings.json');
  return fs.readFileSync(p, 'utf-8');
}

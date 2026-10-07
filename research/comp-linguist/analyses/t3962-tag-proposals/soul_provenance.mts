// t/4066 (SO e/278#5, #7): soul provenance from the CANONICAL builder, never a port.
// soulDocHash iterates UTF-16 code units; a Python port over UTF-8 bytes would diverge on the first non-ASCII
// character. So the writer records this script's output verbatim.
//   emit:   npx tsx soul_provenance.mts emit
//   verify: npx tsx soul_provenance.mts verify <pov-tag-proposals.json>  -> every soul must compare 'same'
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSoulProvenance, compareSoulProvenance } from '../../../../lib/debate/soulDocSchema.ts';

const SOULS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'lib', 'debate', 'soul-docs');
const FILES = { critical: 'skeptic.critical.soul.json', institutional: 'skeptic.institutional.soul.json', shared: 'skeptic.soul.json' } as const;

const current = Object.fromEntries(
  Object.entries(FILES).map(([k, f]) => [k, buildSoulProvenance(f, readFileSync(join(SOULS, f), 'utf8'))]),
);

const [mode, file] = process.argv.slice(2);
if (mode === 'emit') {
  process.stdout.write(JSON.stringify(current) + '\n');
} else if (mode === 'verify') {
  const written = JSON.parse(readFileSync(file, 'utf8')).value_basis_run?.soul_provenance ?? {};
  let ok = true;
  for (const k of Object.keys(FILES)) {
    const r = compareSoulProvenance(written[k], current[k]);
    console.log(`${k.padEnd(14)} written=${JSON.stringify(written[k])} current=${current[k].hash} -> ${r}`);
    if (r !== 'same') ok = false;
  }
  console.log(ok ? 'SOUL PROVENANCE: all same' : 'SOUL PROVENANCE: MISMATCH');
  process.exit(ok ? 0 : 1);
} else {
  console.error('usage: emit | verify <file>');
  process.exit(2);
}

// t/1344 — cross-runtime parity shim.
// Reads a debate JSON, scores the calibration_log via lib/debate/qualityScore.ts,
// prints one line of JSON: {"score": <number>, "tier": <string>}.
// Kept test-scoped (not promoted to lib/) per t/1344#2.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { computeQualityScore } from '../../../lib/debate/qualityScore.ts';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, process.argv[2] ?? 'debate-fixture.json');
const debate = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { score, tier } = computeQualityScore(debate.calibration_log);
process.stdout.write(JSON.stringify({ score, tier }) + '\n');

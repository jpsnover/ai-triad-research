// Node-only description hashing for the Debate-Tested harvest writer.
//
// This lives in its own module because `debateTested.ts` is reachable from the
// Electron renderer (via `taxonomyRelevance` → WELL_TESTED_EXCLUSION/isReeligible),
// and a static `import { createHash } from 'crypto'` in that graph makes Vite's
// browser crypto stub throw at renderer init. Node callers inject this hasher via
// `setDescriptionHasher(computeDescriptionHash)`; the renderer never imports it. (t/1591)

import { createHash } from 'crypto';

/** SHA-256 of a node description, used to detect post-hoc description edits. Node-only (uses crypto). */
export function computeDescriptionHash(description: string): string {
  return 'sha256:' + createHash('sha256').update(description).digest('hex');
}

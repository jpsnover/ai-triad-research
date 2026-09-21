// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3529: compile-time-only conformance check between preload.cts's actual exposed API
// surface (`PreloadElectronAPI`) and the renderer's declared view of it (`ElectronAPI` in
// electron.d.ts). Never imported by any entry point or bundled — it exists solely so a
// divergence between the two fails `tsc`, not so it can be required at runtime. This file
// is a root file under BOTH tsconfig.main.json (`src/main/**/*`) and the renderer's
// tsconfig.json (`src/**/*`), so it rides both projects' existing `tsc --noEmit` steps —
// no new CI gate needed (t/3529 design, TL-approved e/179#2).
import type { PreloadElectronAPI } from '../preload.cjs';
import type { ElectronAPI } from '../../renderer/types/electron.js';

// Bidirectional structural-equality check — a non-distributive function-type comparison,
// which dodges variance quirks a plain `A extends B ? B extends A ? ... : ...` conditional
// would miss. Same form as Rosetta's t/3528 `aiCallMeta` pin (t/3528#5 TL ruling); defined
// locally rather than imported across scopes (e/179#2 R1) since it's a generic utility, not
// a shared contract between the two roles.
type _Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// R1 (e/179#2): a plain `A extends B ? (B extends A ? true : false) : false` conditional
// passes VACUOUSLY when either side is `any` — `any extends X` and `X extends any` are both
// true regardless of what `X` is. `_Equal` above is immune to that for two REAL types, but
// the liveness of the check as a whole still depends on `PreloadElectronAPI`/`ElectronAPI`
// actually resolving to real types in the first place. If the cross-directory import ever
// silently degrades to `any` (e.g. a future tsconfig edit breaks resolution — the exact risk
// flagged when this design was reviewed), `_Equal<any, ElectronAPI>` would itself evaluate
// `true` and the whole gate would pass forever while catching nothing: enforcement and
// silence become indistinguishable (t/2379 failure-class 8). This guard makes the gate prove
// BOTH imports are alive on every single compile, not just at initial landing. Note this file
// is a real `.ts` (not `.d.ts`) directly referencing both imported types, so `skipLibCheck`
// (true in all three tsconfigs, there to skip `node_modules`, not first-party code) does NOT
// exempt this assertion from being checked — don't "simplify" it away assuming it does.
type IsAny<T> = 0 extends (1 & T) ? true : false;
true satisfies _Equal<IsAny<PreloadElectronAPI>, false>;
true satisfies _Equal<IsAny<ElectronAPI>, false>;

// DECOMPOSED CHECK (t/3532 exit criterion, TL ruling t/3532#7 — supersedes the ticket's
// original "flip to mutual assignability" wording). A bidirectional mutual-assignability
// check (tried first, see git history) conflates two different properties and produced
// false positives: with `strictFunctionTypes` on and `ElectronAPI` using arrow-property
// syntax (contravariant param checking applies), a preload param typed looser than its
// declaration (e.g. `unknown` vs a specific payload shape) is the CORRECT, safe direction —
// an implementation that accepts more than the interface promises is exactly what you want.
// Mutual assignability demanded exact param identity anyway, manufacturing ~5+ "gaps" that
// were never real drift (t/3532#6 found new ones every time the last was excluded — a
// scripted audit would have catalogued ~190 non-problems, not debt). Splitting into the two
// properties this check actually needs to prove avoids that:
//
// 1. Implementation satisfies the declaration — plain `extends`, letting TypeScript apply
//    correct variance (return types covariant, params contravariant).
type _Assignable<A, B> = A extends B ? true : false;
true satisfies _Assignable<Omit<PreloadElectronAPI, _CarveOut>, Omit<ElectronAPI, _CarveOut>>;

// 2. Nothing preload implements is undeclared — key containment only, no param-identity
//    demand. This is the direction t/3529 deliberately left uncovered pending this ticket;
//    `_Equal<_Undeclared, never>` also names the offending keys in a failing diagnostic,
//    which a bare `extends` check wouldn't.
type _Undeclared = Exclude<keyof PreloadElectronAPI, keyof ElectronAPI | _CarveOut>;
true satisfies _Equal<_Undeclared, never>;

// CARVE-OUT (TL ruling, e/182#2 → t/3532#3/#7 — folded into t/3532, no separate ticket).
// Named methods ONLY, never a wildcard. Shrinking this list (fixing one and removing its
// name) is free — growing it needs TL review, because an exclusion list is a
// gate-weakening surface (same threat model as a `.trivyignore` entry).
//
// t/3532 resolved 12 of the original 14 undeclared/miscast methods: `exportChatToFile`
// (Rosetta tightened electron.d.ts's params) and 11 `Promise<unknown>` precision gaps
// sharpened in preload.cts after verification against their real IPC handlers
// (`listBriefExports`, `fetchRelevantNodes`, `computeAttribution`, `listOrganizations`,
// `getOrganization`, `getOrganizationsByPov`, `getOrganizationsByTopic`,
// `getOrganizationsByPolicy`, `getOrganizationEdges`, `getEntity`, `listEntities`,
// `getContainerMentions`). It also fixed two type-shape gaps found while proving arm 1
// above (`processVersions` widened from a generic `Record` to the real `NodeJS.ProcessVersions`
// shape; `getApiKeySummary` widened to include the `keyCount`/`maskedKeys` fields preload's
// real return already carries) and removed 20 stale `?:` optional markers — landing-order
// safety left over from each method's original IPC wiring (comments like "Optional — wired
// by X; until then undefined"), all long since unconditionally implemented in preload.cts:
// `cancelGenerate`, `forwardFlightEvent`, `getContainerMentions`, `getEntity`,
// `getOrganization`, `getOrganizationEdges`, `getOrganizationsByPolicy`,
// `getOrganizationsByPov`, `getOrganizationsByTopic`, `listEntities`, `listOrganizations`,
// `loadAggregatedCruxes`, `loadConflictClusters`, `loadGreatestHits`, `onTriggerDump`,
// `saveEdges`, `sendDumpResult`, `triggerMainDump`, `validateApiKey`, `verifyStoredKeys`.
//
// `getPreferences` — CARVE-OUT EMPTIED (t/3536): the handler now validates via the shared
// lib/userPreferencesSchema.ts (t/3535) instead of returning the parsed file contents
// as-is, so `UserPreferences | null` is now an enforced claim, not an unverified one — the
// exact condition TL set for removing it (t/3532#3/#7). (`setPreferences` and the 5
// param-precision entries found during the mutual-assignability attempt — `openDebateWindow`,
// `importKeysFromSharing`, `saveEdges`, `reportError`, `createBriefExport` — were never
// carved out: arm 1's contravariant param check passes them correctly, since a looser
// preload param is safe, not a gap.)
type _CarveOut = never;

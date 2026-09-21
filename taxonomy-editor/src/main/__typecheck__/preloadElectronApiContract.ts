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

// MUTUAL ASSIGNABILITY (t/3532 exit criterion — flipped from the one-directional check t/3529
// landed with). `_Equal` above is exact identity, the wrong semantic for this object interface:
// `ElectronAPI` carries dozens of legitimate optional members (e.g. `getWebAppUrl`, web-only,
// correctly `?.()`-guarded at its call site), and exact identity would permanently fail on
// every one of them — unlike t/3528's tuple pin, where "wider" was itself the hazard being
// guarded against. `MutuallyAssignable` below checks BOTH directions of plain assignability:
// a declared member missing from preload, or present with an incompatible type, fails (the
// direction that caught the real `loadSourceEvidenceIndex` mismatch, t/3529); AND a method
// preload implements that electron.d.ts never declares now ALSO fails (the direction t/3529
// deliberately left uncovered, closed here) — this is what t/3532's 12-method declaration +
// 11-method precision sharpening earned: nothing left in the carve-out but `getPreferences`
// (t/3532#3, unenforced-by-design pending t/3536's Zod validation, not a type gap).
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : false) : false;

// CARVE-OUT (TL ruling, e/182#2 → t/3532#3 — folded into t/3532, no separate ticket).
// Named methods ONLY, never a wildcard. Shrinking this list (fixing one and removing its
// name) is free — growing it needs TL review, because an exclusion list is a
// gate-weakening surface (same threat model as a `.trivyignore` entry).
//
// t/3532 resolved 12 of the original 14: `exportChatToFile` (Rosetta tightened
// electron.d.ts's params) and 11 `Promise<unknown>` precision gaps sharpened in preload.cts
// after verification against their real IPC handlers (`listBriefExports`,
// `fetchRelevantNodes`, `computeAttribution`, `listOrganizations`, `getOrganization`,
// `getOrganizationsByPov`, `getOrganizationsByTopic`, `getOrganizationsByPolicy`,
// `getOrganizationEdges`, `getEntity`, `listEntities`, `getContainerMentions`).
//
// `getPreferences`/`setPreferences` remain carved out DELIBERATELY (TL ruling, t/3532#3):
// `getPreferences` reads unvalidated JSON off disk and returns it as-is — declaring
// `UserPreferences | null` in electron.d.ts is a good claim that happens to be unenforced,
// and the fix is to make the claim TRUE (Zod-validate on read, t/3534/t/3536), not to
// downgrade the type and push unsafety into every settings call site. `setPreferences`'s
// param has the same shape of gap (preload accepts `unknown`, unvalidated) — paired here
// rather than a separate exclusion since they're the same read/write surface. Removing
// both from the carve-out is t/3536's job.
//
// Flipping the assertion below (mutual assignability) also surfaced a THIRD class beyond
// the ticket's original inventory: 20 methods declared `?:` optional in electron.d.ts
// as a landing-order safety measure during their original IPC wiring (comments like
// "Optional — wired by X (ElectronMain); until then undefined"), all now unconditionally
// implemented in preload.cts for a long time — a false-optional stale from history that
// the prior one-directional check couldn't see (optional-in-declared vs required-in-preload
// only breaks the REVERSE direction). Fixed alongside this flip: `cancelGenerate`,
// `forwardFlightEvent`, `getContainerMentions`, `getEntity`, `getOrganization`,
// `getOrganizationEdges`, `getOrganizationsByPolicy`, `getOrganizationsByPov`,
// `getOrganizationsByTopic`, `listEntities`, `listOrganizations`, `loadAggregatedCruxes`,
// `loadConflictClusters`, `loadGreatestHits`, `onTriggerDump`, `saveEdges`,
// `sendDumpResult`, `triggerMainDump`, `validateApiKey`, `verifyStoredKeys`. `getWebAppUrl`
// remains legitimately optional (genuinely absent from preload — web-only concept).
// FURTHER TEMPORARY carve-outs pending an ElectronMain preload.cts param-sharpening pass
// (same category TL already approved for fetchRelevantNodes/computeAttribution, t/3532#3) —
// discovered mid-flip, reported for a scope decision before continuing (t/3532#6):
// openDebateWindow, importKeysFromSharing, saveEdges, reportError, createBriefExport.
// Surfaced one new instance every time the prior one was excluded — likely NOT exhaustive;
// see t/3532#6 for the recommendation to stop trickle-discovery and audit systematically.
type _CarveOut = 'getPreferences' | 'setPreferences'
  | 'openDebateWindow' | 'importKeysFromSharing' | 'saveEdges' | 'reportError' | 'createBriefExport';
true satisfies MutuallyAssignable<Omit<PreloadElectronAPI, _CarveOut>, Omit<ElectronAPI, _CarveOut>>;

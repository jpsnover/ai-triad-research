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

// Deliberately ONE-DIRECTIONAL pending t/3532 (TL ruling, e/179#2) — checks only that
// preload.cts's actual surface satisfies everything electron.d.ts declares: a declared
// member missing from preload, or present with an incompatible type, fails the build (this
// caught the real `loadSourceEvidenceIndex` type mismatch fixed alongside this file). It
// does NOT yet catch the reverse direction — methods preload.cts implements that
// electron.d.ts never declares — because `ElectronAPI` carries dozens of legitimate optional
// members (e.g. `getWebAppUrl`, web-only, correctly `?.()`-guarded at its call site); a naive
// bidirectional equality check permanently fails on those, unlike t/3528's tuple pin, where
// "wider" was itself the hazard being guarded against. `_Equal` above remains right for that
// case; plain one-directional assignability is the correct semantics for this interface.
// t/3532 (Rosetta, electron.d.ts) adds the 12 currently-undeclared methods this check
// surfaced (osArch/osPlatform, onFlightEventFromPopup, onPromptDiffContext, the OpEd set)
// and cleans up 3 renderer call sites that bypass the interface today with local ad-hoc
// types or an unsafe `as unknown as` cast. Its exit criterion is flipping the assertion
// below to `_Equal` (mutual assignability), so full strength isn't quietly forgotten.
type _Assignable<A, B> = A extends B ? true : false;

// CARVE-OUT (TL ruling, e/182#2 — folded into t/3532, no separate ticket). Named methods
// ONLY, never a wildcard. Shrinking this list (fixing one and removing its name) is free —
// growing it needs TL review, because an exclusion list is a gate-weakening surface (same
// threat model as a `.trivyignore` entry).
//
// `exportChatToFile`: electron.d.ts's own params are too loose (`string`/`unknown[]` vs the
// real literal-union shapes `preload.cts`/`bridge/types.ts`'s `AppAPI` already use) — a
// Rosetta-file fix, t/3532.
//
// The other 13 (`listBriefExports`, `getPreferences`, `fetchRelevantNodes`,
// `computeAttribution`, `listOrganizations`, `getOrganization`, `getOrganizationsByPov`,
// `getOrganizationsByTopic`, `getOrganizationsByPolicy`, `getOrganizationEdges`,
// `getEntity`, `listEntities`, `getContainerMentions`): preload declares `Promise<unknown>`
// because `ipcRenderer.invoke(...)` genuinely returns an untyped result — that IS the honest
// type. electron.d.ts's more precise declared type is an unverified CLAIM about what the
// corresponding main-process IPC handler actually returns; casting preload to match it would
// just restate that same unverified claim in a second place ("conformance theatre"), not add
// real safety. Real safety requires checking each handler's actual return type — unscoped
// here, folded into t/3532's AC, which allows resolving a gap either by verifying-and-typing
// (as done for the 5 methods fixed alongside this file, e.g. `getSourceEvidence`) or by
// documenting the claim as accepted-unverified.
type _CarveOut =
  | 'exportChatToFile'
  | 'listBriefExports' | 'getPreferences' | 'fetchRelevantNodes' | 'computeAttribution'
  | 'listOrganizations' | 'getOrganization' | 'getOrganizationsByPov'
  | 'getOrganizationsByTopic' | 'getOrganizationsByPolicy' | 'getOrganizationEdges'
  | 'getEntity' | 'listEntities' | 'getContainerMentions';
true satisfies _Assignable<Omit<PreloadElectronAPI, _CarveOut>, Omit<ElectronAPI, _CarveOut>>;

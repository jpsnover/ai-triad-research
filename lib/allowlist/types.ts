// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3496 (t/3495 epic — admin-managed shared Gemini key): shared types for the
// admin allowlist and the session/profile response, importable by both server
// and renderer. Interface-first — no implementation here; see t/3495-B
// (allowlistStore.ts) and t/3495-C (admin routes + debate route + session wiring).

/** One admin-allowlist entry. `userId` is the authoritative membership key —
 *  the debate route MUST look up membership by `userId`, never by `email`
 *  (SO condition 4, t/3495#2). `email` is stored for audit display only. */
export interface AllowlistEntry {
  userId: string;
  email: string;
  addedAt: string;
}

/** GET /api/admin/allowlist response shape. */
export interface AdminAllowlistResponse {
  entries: AllowlistEntry[];
}

/** GET /api/user/profile response shape. `geminiAllowlisted` must ALWAYS be
 *  present as a boolean — emit `false` (never omit/undefined) on an allowlist
 *  read error or when the caller is not a member (SO condition 5, t/3495#2). */
export interface UserSession {
  userId: string;
  displayName: string;
  idp: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  quotas: unknown;
  geminiAllowlisted: boolean;
}

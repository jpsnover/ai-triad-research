// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2036 — backend-selection de-conflation. The original bug: the AI-backend
// dropdowns collapsed a lossy `available` boolean (tier AND key) into a single
// "(not on your tier)" state, so a backend the user simply had no key for read as
// tier-blocked and was DISABLED — a BYOK user couldn't select it to enter a key
// (violates ADR-002). This maps the authoritative per-backend `reason` to the three
// real states, so the two dropdowns (SettingsDialog, NewChatDialog) stay in lockstep.
//
//   #1 has key + tier-ok  → selectable, plain label
//   #2 no key, BYOK-permitted (desktop always; web byok/platform) → selectable, "(bring your own key)"
//   #3 no key AND tier forbids BYOK (web anonymous/free) → NOT freely selectable, "(sign in to use)"
//
// Backend selection is never tier-gated for #1/#2 (TL ruling t/2036); #3 stays
// honestly restricted because the server would 403 the call even with a key — the
// unlock is signing in (→ byok tier), not entering a key (TL policy, p/56#215).

/** One entry of the `getAvailableBackends()` result (bridge contract). */
export interface BackendAvailabilityEntry {
  available: boolean;
  reason?: 'tier_restricted' | 'no_key';
}

export interface BackendSelectState {
  /** false only for #3 (tier-forbidden) — never disable merely for a missing key. */
  selectable: boolean;
  /** Label suffix incl. leading space, or '' for the plain has-key state. */
  suffix: string;
}

/**
 * Resolve a backend's dropdown state from its availability entry + local key presence.
 * `entry` may be undefined (availability not loaded / backend absent) — in that case we
 * fall back to `hasKey` and never disable, so a load hiccup can't re-block selection.
 */
export function backendSelectState(
  entry: BackendAvailabilityEntry | undefined,
  hasKey: boolean,
): BackendSelectState {
  // #3 — tier forbids BYOK (server 403s regardless of a key). Honest restriction.
  if (entry?.reason === 'tier_restricted') {
    return { selectable: false, suffix: ' (sign in to use)' };
  }
  // #1 — usable (key present AND tier-ok, per the entry) or a known local key.
  if (entry?.available || (!entry && hasKey)) {
    return { selectable: true, suffix: '' };
  }
  // #2 — no key but BYOK-permitted: selectable, prompt to bring a key.
  return { selectable: true, suffix: ' (bring your own key)' };
}

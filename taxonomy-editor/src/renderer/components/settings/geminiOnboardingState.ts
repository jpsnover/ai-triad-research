// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3604: split out of GeminiOnboardingModal.tsx — a .tsx module exporting
// non-component functions breaks React Fast Refresh (forces a full reload
// instead of a hot update). These are plain state helpers, not components.

export const DISMISS_KEY = 'gemini-onboarding-dismissed';

export function shouldShowGeminiOnboarding(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  return dismissed !== 'permanent';
}

export function clearSessionDismiss(): void {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (dismissed === 'once') localStorage.removeItem(DISMISS_KEY);
}

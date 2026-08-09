// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure URL helper — no electron dep, directly testable (t/2399).

export function buildDebateHash(debateId: string, source?: string): string {
  let hash = `debate-window?id=${encodeURIComponent(debateId)}`;
  if (source) hash += `&source=${encodeURIComponent(source)}`;
  return hash;
}

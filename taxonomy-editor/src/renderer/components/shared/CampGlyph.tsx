// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { JSX } from 'react';

export type CampKey = 'acc' | 'saf' | 'skp';

interface CampGlyphProps {
  camp: CampKey;
  size?: number;
  className?: string;
}

const PATHS: Record<CampKey, JSX.Element> = {
  acc: (
    <>
      <path d="M8 14c0-3 2-5.5 4-8 2 2.5 4 5 4 8a4 4 0 0 1-8 0z" />
      <path d="M10 13.5c0-1.2 1-2.5 2-3.5 1 1 2 2.3 2 3.5a2 2 0 0 1-4 0z" />
    </>
  ),
  saf: (
    <path d="M12 3l7 4v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V7l7-4z" />
  ),
  // Bare "?" — reads as doubt/scrutiny (the Skeptic's stance) without the
  // circled-"?" Help affordance or the old bullseye's "selected radio" read (t/2415, Design t/2415#1).
  skp: (
    <>
      <path d="M8.5 9.5a3.5 3.5 0 1 1 5.3 3c-1.1.8-1.8 1.4-1.8 2.8" />
      <path d="M12 18.5h0.01" />
    </>
  ),
};

export function CampGlyph({ camp, size = 16, className }: CampGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[camp]}
    </svg>
  );
}

const POV_TO_CAMP: Record<string, CampKey> = {
  accelerationist: 'acc',
  safetyist: 'saf',
  skeptic: 'skp',
};

export function povToCamp(pov: string): CampKey | undefined {
  return POV_TO_CAMP[pov];
}

// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';

export type Breakpoint = 'phone' | 'phone-lg' | 'tablet' | 'tablet-lg' | 'desktop';

const BREAKPOINT_QUERIES: [Breakpoint, string][] = [
  ['phone', '(max-width: 479px)'],
  ['phone-lg', '(max-width: 767px)'],
  ['tablet', '(max-width: 1023px)'],
  ['tablet-lg', '(max-width: 1199px)'],
];

function resolveBreakpoint(): Breakpoint {
  for (const [bp, query] of BREAKPOINT_QUERIES) {
    if (window.matchMedia(query).matches) return bp;
  }
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(resolveBreakpoint);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const mqls = BREAKPOINT_QUERIES.map(([, query]) => window.matchMedia(query));

    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setBreakpoint(resolveBreakpoint()), 100);
    };

    for (const mql of mqls) mql.addEventListener('change', handler);
    window.addEventListener('resize', handler);
    return () => {
      if (timer) clearTimeout(timer);
      for (const mql of mqls) mql.removeEventListener('change', handler);
      window.removeEventListener('resize', handler);
    };
  }, []);

  return breakpoint;
}

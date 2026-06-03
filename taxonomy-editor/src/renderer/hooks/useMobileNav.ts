// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useEffect } from 'react';
import { useBreakpoint } from './useBreakpoint';

export type ViewStackEntry = {
  view: 'list' | 'detail' | 'debate' | 'diagnostics';
  id?: string;
};

const LIST_ENTRY: ViewStackEntry = { view: 'list' };

const INACTIVE = {
  stack: [LIST_ENTRY] as ViewStackEntry[],
  push: (() => {}) as (entry: ViewStackEntry) => void,
  pop: (() => LIST_ENTRY) as () => ViewStackEntry,
  current: LIST_ENTRY,
  isActive: false,
};

export function useMobileNav() {
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const [stack, setStack] = useState<ViewStackEntry[]>([LIST_ENTRY]);

  useEffect(() => {
    if (!isPhone) setStack([LIST_ENTRY]);
  }, [isPhone]);

  const push = useCallback((entry: ViewStackEntry) => {
    setStack(prev => [...prev, entry]);
  }, []);

  const pop = useCallback((): ViewStackEntry => {
    let result = LIST_ENTRY;
    setStack(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      result = next[next.length - 1];
      return next;
    });
    return result;
  }, []);

  if (!isPhone) return INACTIVE;

  return {
    stack,
    push,
    pop,
    current: stack[stack.length - 1],
    isActive: true,
  };
}

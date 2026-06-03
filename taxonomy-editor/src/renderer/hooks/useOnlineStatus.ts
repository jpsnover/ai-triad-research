// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

export type ConnectionType = 'wifi' | 'ethernet' | 'cellular' | 'unknown';

export function useConnectionType(): ConnectionType {
  const conn = (navigator as any).connection;
  const [type, setType] = useState<ConnectionType>(() => {
    if (!conn) return 'unknown';
    if (conn.type === 'wifi' || conn.type === 'ethernet') return conn.type;
    if (conn.type === 'cellular') return 'cellular';
    return 'unknown';
  });

  useEffect(() => {
    if (!conn) return;
    const handler = () => {
      if (conn.type === 'wifi' || conn.type === 'ethernet') setType(conn.type);
      else if (conn.type === 'cellular') setType('cellular');
      else setType('unknown');
    };
    conn.addEventListener('change', handler);
    return () => conn.removeEventListener('change', handler);
  }, [conn]);

  return type;
}

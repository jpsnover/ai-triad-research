// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnlineStatus, useConnectionType } from './useOnlineStatus';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const CACHE_NAME = 'taxonomy-pov-cache-v1';
const STORAGE_MIN_BYTES = 200 * 1024 * 1024;
const VERSION_KEY = 'taxonomy-precache-versions';

const POV_ENDPOINTS = [
  '/api/taxonomy/accelerationist',
  '/api/taxonomy/safetyist',
  '/api/taxonomy/skeptic',
];

const SUPPLEMENTARY_ENDPOINTS = [
  '/api/edges',
  '/api/taxonomy/situations',
  '/api/conflicts',
  '/api/policy-registry',
];

const ALL_ENDPOINTS = [...POV_ENDPOINTS, ...SUPPLEMENTARY_ENDPOINTS];

export interface PrecacheProgress {
  state: 'idle' | 'checking' | 'caching' | 'done' | 'error' | 'limited';
  completed: string[];
  total: number;
  currentLabel: string;
  error?: string;
}

function endpointLabel(url: string): string {
  if (url.includes('accelerationist')) return 'Accelerationist';
  if (url.includes('safetyist')) return 'Safetyist';
  if (url.includes('skeptic')) return 'Skeptic';
  if (url.includes('edges')) return 'Edges';
  if (url.includes('situations')) return 'Situations';
  if (url.includes('conflicts')) return 'Conflicts';
  if (url.includes('policy')) return 'Policy Actions';
  return url;
}

function shouldPrecache(connType: string): boolean {
  return connType === 'wifi' || connType === 'ethernet';
}

async function checkStorageBudget(): Promise<{ sufficient: boolean; availableMB: number }> {
  if (!navigator.storage?.estimate) return { sufficient: true, availableMB: Infinity };
  const est = await navigator.storage.estimate();
  const available = (est.quota ?? 0) - (est.usage ?? 0);
  return { sufficient: available >= STORAGE_MIN_BYTES, availableMB: Math.round(available / (1024 * 1024)) };
}

function getStoredVersions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(VERSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setStoredVersions(versions: Record<string, string>) {
  try {
    localStorage.setItem(VERSION_KEY, JSON.stringify(versions));
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'precache',
      level: 'warn',
      message: 'Failed to persist precache versions',
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
  }
}

async function fetchWithFreshCheck(url: string, versions: Record<string, string>): Promise<{ response: Response; changed: boolean }> {
  const headers: Record<string, string> = {};
  const etag = versions[url];
  if (etag) headers['If-None-Match'] = etag;

  const response = await fetch(url, { headers });
  if (response.status === 304) return { response, changed: false };
  return { response, changed: true };
}

export function usePrecache(activePov?: string) {
  const isOnline = useOnlineStatus();
  const connType = useConnectionType();
  const [progress, setProgress] = useState<PrecacheProgress>({
    state: 'idle', completed: [], total: ALL_ENDPOINTS.length, currentLabel: '',
  });
  const cancelledRef = useRef(false);
  const hasRunRef = useRef(false);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setProgress(prev => ({ ...prev, state: 'idle', currentLabel: '' }));
  }, []);

  const dismiss = useCallback(() => {
    setProgress({ state: 'idle', completed: [], total: ALL_ENDPOINTS.length, currentLabel: '' });
  }, []);

  useEffect(() => {
    if (!isOnline || !shouldPrecache(connType)) return;
    if (hasRunRef.current) return;
    if (import.meta.env.VITE_TARGET !== 'web') return;

    hasRunRef.current = true;
    cancelledRef.current = false;

    const run = async () => {
      try {
        setProgress(p => ({ ...p, state: 'checking', currentLabel: 'Checking storage...' }));

        const { sufficient, availableMB } = await checkStorageBudget();

        try {
          await navigator.storage?.persist?.();
        } catch { /* storage persist — best-effort, silent by design */ }

        const versions = getStoredVersions();
        const ordered = orderEndpoints(activePov);

        if (!sufficient) {
          const limited = activePov
            ? ordered.filter(u => u.includes(activePov))
            : ordered.slice(0, 1);

          await cacheEndpoints(limited, versions, (p) => setProgress(p), cancelledRef);
          setProgress(p => ({
            ...p,
            state: 'limited',
            currentLabel: `Limited storage (${availableMB}MB) — only current POV cached offline.`,
          }));
          return;
        }

        await cacheEndpoints(ordered, versions, (p) => setProgress(p), cancelledRef);

        if (!cancelledRef.current) {
          setProgress(p => ({ ...p, state: 'done', currentLabel: 'All POVs available offline' }));
          setTimeout(() => {
            setProgress(p => p.state === 'done' ? { ...p, state: 'idle' } : p);
          }, 3000);
        }
      } catch (err) {
        if (!cancelledRef.current) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'precache',
            level: 'error',
            message: 'POV precaching failed',
            error: { name: (err as Error).name ?? 'Error', message: String(err) },
          });
          setProgress(p => ({
            ...p,
            state: 'error',
            currentLabel: 'Precaching failed',
            error: String(err),
          }));
        }
      }
    };

    void run();
  }, [isOnline, connType, activePov]);

  // Reset hasRun when going offline then back on wifi
  useEffect(() => {
    if (!isOnline) hasRunRef.current = false;
  }, [isOnline]);

  return { progress, cancel, dismiss };
}

function orderEndpoints(activePov?: string): string[] {
  const ordered = [...ALL_ENDPOINTS];
  if (activePov) {
    const activePath = `/api/taxonomy/${activePov}`;
    const idx = ordered.indexOf(activePath);
    if (idx > 0) {
      ordered.splice(idx, 1);
      ordered.unshift(activePath);
    }
  }
  return ordered;
}

async function cacheEndpoints(
  endpoints: string[],
  versions: Record<string, string>,
  onProgress: (p: PrecacheProgress) => void,
  cancelledRef: { current: boolean },
) {
  const cache = await caches.open(CACHE_NAME);
  const completed: string[] = [];
  const updatedVersions = { ...versions };

  for (const url of endpoints) {
    if (cancelledRef.current) return;

    onProgress({
      state: 'caching',
      completed: [...completed],
      total: endpoints.length,
      currentLabel: `Caching for offline: ${endpointLabel(url)}... (${completed.length + 1}/${endpoints.length})`,
    });

    try {
      const { response, changed } = await fetchWithFreshCheck(url, versions);
      if (changed && response.ok) {
        const etag = response.headers.get('ETag');
        if (etag) updatedVersions[url] = etag;
        await cache.put(url, response.clone());
      }
      completed.push(endpointLabel(url));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'precache',
        level: 'warn',
        message: `Failed to precache ${url}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      completed.push(endpointLabel(url));
    }
  }

  setStoredVersions(updatedVersions);
  onProgress({
    state: 'caching',
    completed,
    total: endpoints.length,
    currentLabel: '',
  });
}

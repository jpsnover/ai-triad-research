import { useState, useEffect } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export interface AuthInfo { user: string; anonymous: boolean; idp: string }

export interface QuotaLimits {
  maxChats: number;
  maxDebates: number;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  idp: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  quotas: QuotaLimits | null;
}

export function useAuthStatus(): AuthInfo | null {
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_TARGET !== 'web') return;
    fetch('/api/auth/me').then(r => r.json()).then(setAuth).catch((err) => {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'useAuthStatus', level: 'warn', message: 'Auth status check failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    });
  }, []);
  return auth;
}

export function useUserProfile(): UserProfile | null {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_TARGET !== 'web') return;
    fetch('/api/user/profile').then(r => r.json()).then(setProfile).catch((err) => {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'useAuthStatus', level: 'warn', message: 'User profile fetch failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    });
  }, []);
  return profile;
}

import { useState, useEffect } from 'react';

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
    fetch('/api/auth/me').then(r => r.json()).then(setAuth).catch(() => { /* telemetry — silent by design */ });
  }, []);
  return auth;
}

export function useUserProfile(): UserProfile | null {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_TARGET !== 'web') return;
    fetch('/api/user/profile').then(r => r.json()).then(setProfile).catch(() => { /* telemetry — silent by design */ });
  }, []);
  return profile;
}

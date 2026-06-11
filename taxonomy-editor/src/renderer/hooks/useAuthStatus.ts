import { useState, useEffect } from 'react';

export interface AuthInfo { user: string; anonymous: boolean; idp: string }

export function useAuthStatus(): AuthInfo | null {
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_TARGET !== 'web') return;
    fetch('/api/auth/me').then(r => r.json()).then(setAuth).catch(() => { /* telemetry — silent by design */ });
  }, []);
  return auth;
}

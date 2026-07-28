// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useAuthStatus } from '../../hooks/useAuthStatus';
import './AnonymousBanner.css';

export function AnonymousBanner() {
  const auth = useAuthStatus();
  if (!auth?.anonymous) return null;

  return (
    <div className="anonymous-banner">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="anonymous-banner-icon">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zM8 11a1 1 0 110 2 1 1 0 010-2z" />
      </svg>
      <span>Anonymous mode — your data is temporary and will be lost when your session ends.</span>
      <a href="/api/auth/fresh-login/github" className="anonymous-banner-link">Sign in with GitHub</a>
      <a href="/api/auth/fresh-login/google" className="anonymous-banner-link anonymous-banner-link-alt">Sign in with Google</a>
    </div>
  );
}

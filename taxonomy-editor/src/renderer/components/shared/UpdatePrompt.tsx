// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="pwa-update-toast">
      <span>Update available</span>
      <button className="btn btn-sm" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  );
}

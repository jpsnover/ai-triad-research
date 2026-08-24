// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { initAnalytics } from './analyticsEmitter';
import { initDwellTracker } from './dwellTracker';

/**
 * Start the per-session analytics services in the required order (t/2699 / t/2707).
 *
 * The dwell tracker MUST be initialized before analytics: it is what emits
 * `view.dwell` events, and the Engagement (Hierarchy) dashboard queries **only**
 * `view.dwell` (analytics.ts). A session that starts `initAnalytics()` without the
 * dwell tracker records no dwell events → the dashboard stays empty for that user.
 *
 * The App.tsx copy-status-complete path did exactly that (missed
 * `initDwellTracker`), so every init path now routes through this single helper —
 * a path can no longer silently start analytics without dwell tracking. Preserves
 * the existing sites' semantics (analytics starts once the dwell tracker resolves).
 */
export function initAnalyticsSession(): void {
  void initDwellTracker().then(() => initAnalytics());
}

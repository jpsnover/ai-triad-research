// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Node-deletion audit log endpoint (t/3860; parent design t/3852).
// POST /api/node-delete-log — write-only, authenticated users only.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error } from '../httpKit.js';
import { isAnonymousUser } from '../security/userContext.js';
import { writeNodeDeleteLogEntry } from '../storage/nodeDeleteLog.js';
import type { NodeDeleteLogEntry } from '../storage/nodeDeleteLog.js';

export function registerNodeDeleteLogRoutes(router: Router, _ctx: ServerCtx): void {
  const { post } = router;

  post('/api/node-delete-log', async (req, res, body) => {
    if (isAnonymousUser()) { error(res, 'Sign in required', 403); return; }

    const b = (body ?? {}) as Partial<NodeDeleteLogEntry>;
    if (typeof b.nodeId !== 'string' || !b.nodeId) { error(res, 'nodeId is required', 400); return; }
    if (typeof b.pov !== 'string' || !b.pov) { error(res, 'pov is required', 400); return; }
    if (typeof b.label !== 'string') { error(res, 'label is required', 400); return; }
    if (typeof b.user !== 'string' || !b.user) { error(res, 'user is required', 400); return; }
    if (typeof b.danglingEdges !== 'number') { error(res, 'danglingEdges is required (number)', 400); return; }
    if (typeof b.danglingSituationRefs !== 'number') { error(res, 'danglingSituationRefs is required (number)', 400); return; }
    if (typeof b.danglingChildren !== 'number') { error(res, 'danglingChildren is required (number)', 400); return; }

    writeNodeDeleteLogEntry({
      nodeId: b.nodeId, pov: b.pov, label: b.label, user: b.user,
      danglingEdges: b.danglingEdges, danglingSituationRefs: b.danglingSituationRefs,
      danglingChildren: b.danglingChildren,
    });

    json(res, {}, 204);
  });
}

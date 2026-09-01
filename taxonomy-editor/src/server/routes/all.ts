// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2749: consolidated route registration — extracted from server.ts to reclaim
// headroom at the 1500-line ESLint gate. Registration ORDER IS LOAD-BEARING (the
// router matches the first route whose path template fits a request). Every
// register* call is placed here at the position it held in server.ts, preserving
// the routeTable snapshot order documented in each module's extraction comment.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { registerMetaRoutes } from './meta.js';
import { registerTaxonomyRoutes } from './taxonomy.js';
import { registerConflictsRoutes } from './conflicts.js';
import { registerOrganizationsRoutes } from './organizations.js';
import { registerEntityRoutes } from './entity.js';
import { registerMentionsRoutes } from './mentions.js';
import { registerPublicShareRoutes } from './publicShare.js';
import { registerOpedShareRoutes } from './opedShare.js';
import { registerEdgesRoutes } from './edges.js';
import { registerAdminRoutes } from './admin.js';
import { registerDataRoutes } from './data.js';
import { registerKeysRoutes } from './keys.js';
import { registerAiRoutes } from './ai.js';
import { registerChatRoutes } from './chat.js';
import { registerDebatesRoutes } from './debates.js';
import { registerDiagnosticsRoutes } from './diagnostics.js';
import { registerCommunityRoutes } from './community.js';
import { registerOpedRoutes } from './oped.js';
import { registerBriefExportsRoutes } from './briefExports.js';
import { registerTemplatesRoutes } from './templates.js';
import { registerSupportRoutes } from './support.js';
import { registerHarvestRoutes } from './harvest.js';
import { registerSourcesRoutes } from './sources.js';
import { registerSyncRoutes } from './sync.js';
import { registerSessionRoutes } from './session.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerCanaryRoutes } from './canary.js';

export function registerAllRoutes(router: Router, ctx: ServerCtx): void {
  registerMetaRoutes(router, ctx);
  registerTaxonomyRoutes(router, ctx);
  registerConflictsRoutes(router, ctx);
  registerOrganizationsRoutes(router, ctx);
  registerEntityRoutes(router, ctx);
  registerMentionsRoutes(router, ctx);
  registerPublicShareRoutes(router, ctx);
  registerOpedShareRoutes(router, ctx);
  registerEdgesRoutes(router, ctx);
  registerAdminRoutes(router, ctx);
  registerDataRoutes(router, ctx);
  registerKeysRoutes(router, ctx);
  registerAiRoutes(router, ctx);
  registerChatRoutes(router, ctx);
  registerDebatesRoutes(router, ctx);
  registerDiagnosticsRoutes(router, ctx);
  registerCommunityRoutes(router, ctx);
  registerOpedRoutes(router, ctx);
  registerBriefExportsRoutes(router, ctx);
  registerTemplatesRoutes(router, ctx);
  registerSupportRoutes(router, ctx);
  registerHarvestRoutes(router, ctx);
  registerSourcesRoutes(router, ctx);
  registerSyncRoutes(router, ctx);
  registerSessionRoutes(router, ctx);
  registerPreferencesRoutes(router, ctx);
  // t/3206: canary storm-window loop-sampler control routes (/internal/canary/*). Unique prefix →
  // no collision with any group above, so appended last (order-independent). Flag-gated (404 off).
  registerCanaryRoutes(router, ctx);
}

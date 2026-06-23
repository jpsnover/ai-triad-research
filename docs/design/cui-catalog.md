# Critical User Interactions (CUI) Catalog

**Author:** Technical Lead
**Date:** 2026-06-23
**Status:** Draft — awaiting review
**Ticket:** t/873

---

## What Is a CUI?

A Critical User Interaction is a user-meaningful end-to-end workflow that, if broken, means the product is failing its core purpose. CUIs are not unit tests — they validate *outcomes*, not *code paths*. Each CUI answers: "Can the user accomplish this goal?"

## CUI Priority Levels

- **P0 — Blocking**: Product is unusable if this fails. Must pass before any deploy.
- **P1 — Critical**: Core feature is broken. Should pass before deploy; temporary degradation acceptable.
- **P2 — Important**: Feature regression. Should be caught in pre-release QA.

---

## Domain 1: Taxonomy Browsing & Viewing

### CUI-TAX-001: Load taxonomy and view nodes
- **Priority:** P0
- **Description:** User opens the app and sees the taxonomy graph with all four POV camps populated.
- **Preconditions:** Server running, data available
- **Expected Outcome:** All POV files load (accelerationist, safetyist, skeptic, situations). Node count > 0 for each. UI renders the graph.
- **API Test:**
  1. `GET /api/data/available` → `{ available: true }`
  2. `GET /api/taxonomy/accelerationist` → 200, response has `.nodes[]` with length > 0
  3. `GET /api/taxonomy/safetyist` → 200, nodes > 0
  4. `GET /api/taxonomy/skeptic` → 200, nodes > 0
  5. `GET /api/taxonomy/situations` → 200, nodes > 0
  6. Validate each node has: `id`, `label`, `category` fields
- **UX Test:**
  1. Navigate to app root
  2. Wait for loading to complete (no spinner visible)
  3. Verify POV tabs are visible (Accelerationist, Safetyist, Skeptic)
  4. Click each POV tab — verify node list renders with > 0 items
  5. Screenshot: taxonomy loaded state

### CUI-TAX-002: Select node and view attributes
- **Priority:** P0
- **Description:** User clicks a node and sees its BDI attributes, policy actions, and metadata.
- **Preconditions:** Taxonomy loaded (CUI-TAX-001)
- **Expected Outcome:** Node detail panel shows label, description, category, graph_attributes. No empty panels for enriched nodes.
- **API Test:**
  1. `GET /api/taxonomy/accelerationist` → pick first node with `graph_attributes`
  2. Validate node has: `label`, `description`, `category`
  3. If `graph_attributes` present: validate it has at least one of: `epistemic_type`, `rhetorical_strategy`, `policy_actions`
- **UX Test:**
  1. Click first node in node list
  2. Verify detail panel opens (right sidebar or inspector visible)
  3. Verify node label matches clicked item
  4. Verify at least one attribute section is non-empty
  5. Screenshot: node detail view

### CUI-TAX-003: Search for nodes
- **Priority:** P1
- **Description:** User types a search query and finds relevant nodes across all POVs.
- **Preconditions:** Taxonomy loaded
- **Expected Outcome:** Search returns results matching the query. Clicking a result navigates to that node.
- **API Test:**
  1. Load all taxonomy files, extract 3 random node labels
  2. For each label, simulate a client-side search match (search is client-side — no API endpoint)
  3. Validate the node exists in the loaded data
- **UX Test:**
  1. Click search input (or press Ctrl+K)
  2. Type a known node label substring (e.g., "regulation")
  3. Verify results appear in dropdown
  4. Click first result — verify node detail opens with matching label
  5. Screenshot: search results

### CUI-TAX-004: View edges between nodes
- **Priority:** P1
- **Description:** User sees relationship edges connecting taxonomy nodes.
- **Preconditions:** Taxonomy and edges loaded
- **Expected Outcome:** Edges file loads with typed relationships. Edge count > 0.
- **API Test:**
  1. `GET /api/edges` → 200, response has `.edges[]` with length > 0
  2. Validate each edge has: `source`, `target`, `type`, `status`
  3. Validate edge types are from known set: SUPPORTS, CONTRADICTS, ENABLES, etc.
  4. Validate source/target node IDs exist in loaded taxonomy files
- **UX Test:**
  1. Select a node known to have edges
  2. Verify edge indicators visible in graph or node detail
  3. Click an edge — verify connected node info appears

### CUI-TAX-005: View policy registry
- **Priority:** P1
- **Description:** User views the policy action registry and cross-POV policy mappings.
- **Preconditions:** Taxonomy loaded
- **Expected Outcome:** Policy registry loads with policies spanning multiple POVs.
- **API Test:**
  1. `GET /api/policy-registry` → 200, response is array with length > 0
  2. Validate at least one policy has `source_povs.length > 1` (cross-POV)
  3. Validate each policy has: `id`, `label`, `member_count`

---

## Domain 2: Taxonomy Editing

### CUI-TAX-010: Edit a node and save
- **Priority:** P0
- **Description:** Authenticated user edits a node's description and saves. The change persists on their session branch.
- **Preconditions:** User authenticated, session branch exists
- **Expected Outcome:** PUT succeeds, subsequent GET returns the edited content.
- **API Test:**
  1. `GET /api/auth/me` → verify authenticated (not anonymous)
  2. `GET /api/taxonomy/accelerationist` → pick a node, note original description
  3. `PUT /api/taxonomy/accelerationist` → modify node description with test marker
  4. `GET /api/taxonomy/accelerationist` → verify node description contains test marker
  5. Restore original description via PUT (cleanup)
- **UX Test:**
  1. Click a node to select it
  2. Click edit button / enter edit mode
  3. Modify description text
  4. Click save
  5. Verify save confirmation (toast or indicator)
  6. Refresh page — verify edit persists
  7. Screenshot: before and after edit

### CUI-TAX-011: Submit changes for review (PR flow)
- **Priority:** P1
- **Description:** User with pending edits creates a pull request to merge their session branch.
- **Preconditions:** User has uncommitted edits (CUI-TAX-010)
- **Expected Outcome:** PR created on GitHub, sync status shows PR URL.
- **API Test:**
  1. `GET /api/sync/status` → verify `unsyncedCount > 0` or branch has changes
  2. `GET /api/sync/diff` → verify diff is non-empty
  3. `POST /api/sync/create-pr` → 200, response has PR URL
  4. `GET /api/sync/status` → verify PR URL present
  5. Note: actual PR cleanup (close) needed after test
- **UX Test:**
  1. Navigate to sync panel
  2. Verify "pending changes" badge shows count > 0
  3. Click "Submit for Review" / "Create PR"
  4. Verify PR creation success message with link

---

## Domain 3: Debates

### CUI-DEB-001: Start a new debate
- **Priority:** P0
- **Description:** User enters a topic and starts a three-character debate.
- **Preconditions:** AI backend available (at least free tier Gemini)
- **Expected Outcome:** Debate session created, first turn generates responses from all three characters.
- **API Test:**
  1. `GET /api/backends/available` → verify at least one backend available
  2. `POST /api/ai/generate` with a debate-turn prompt → 200, non-empty response
  3. `PUT /api/debates` with a minimal debate session object → 200
  4. `GET /api/debates` → verify new debate appears in list
- **UX Test:**
  1. Click "New Debate" button
  2. Enter topic text (e.g., "Should AI development be regulated?")
  3. Click "Start" / submit
  4. Wait for first AI response (loading indicator visible, then character responses appear)
  5. Verify all three characters (Accelerationist, Safetyist, Skeptic) have responses
  6. Screenshot: first debate turn

### CUI-DEB-002: Run multi-turn debate
- **Priority:** P0
- **Description:** User advances a debate through multiple turns, seeing AI-generated responses and taxonomy extractions.
- **Preconditions:** Active debate (CUI-DEB-001)
- **Expected Outcome:** Each turn produces character responses. Extraction metadata accumulates.
- **API Test:**
  1. Load an existing debate session: `GET /api/debates/:id`
  2. Submit an AI generation call with debate context → 200, non-empty text
  3. Save updated debate: `PUT /api/debates` → 200
  4. Reload debate: `GET /api/debates/:id` → verify turn count increased
- **UX Test:**
  1. In active debate, click "Next Turn" / advance
  2. Wait for AI responses
  3. Verify new turn appears with three character responses
  4. Repeat for 2 more turns
  5. Verify turn counter increments
  6. Screenshot: multi-turn transcript

### CUI-DEB-003: View debate analysis panels
- **Priority:** P1
- **Description:** User views convergence signals, fallacy detection, and grounding evidence for an active debate.
- **Preconditions:** Debate with 3+ turns
- **Expected Outcome:** Analysis panels render with data. Convergence chart shows trends.
- **UX Test:**
  1. Open a debate with 3+ turns
  2. Open Convergence Signals panel — verify chart renders with data points
  3. Open Fallacy panel — verify it loads (may be empty if no fallacies detected)
  4. Open Grounding panel — verify evidence citations appear
  5. Screenshot: each analysis panel

### CUI-DEB-004: Save and resume debate
- **Priority:** P1
- **Description:** User saves a debate, navigates away, and returns to find it intact.
- **Preconditions:** Active debate with turns
- **Expected Outcome:** Debate persists. Reloading restores full transcript and metadata.
- **API Test:**
  1. `PUT /api/debates` with current session → 200
  2. `GET /api/debates` → verify debate ID in list
  3. `GET /api/debates/:id` → verify turn count, transcript content matches saved state
- **UX Test:**
  1. Save debate (auto-save or explicit save)
  2. Navigate to home / other tab
  3. Navigate back to debates list
  4. Click saved debate — verify full transcript restores
  5. Screenshot: restored debate

### CUI-DEB-005: Delete a debate
- **Priority:** P2
- **Description:** User deletes a debate session.
- **Preconditions:** At least one saved debate
- **Expected Outcome:** Debate removed from list. No stale data.
- **API Test:**
  1. `GET /api/debates` → note a debate ID
  2. `DELETE /api/debates/:id` → 200
  3. `GET /api/debates` → verify debate ID no longer in list
  4. `GET /api/debates/:id` → 404

---

## Domain 4: AI Integration

### CUI-AI-001: Configure BYOK API key
- **Priority:** P0
- **Description:** User enters their own API key and it's stored securely for subsequent AI calls.
- **Preconditions:** User authenticated
- **Expected Outcome:** Key stored, subsequent AI calls use it.
- **API Test:**
  1. `GET /api/keys/has?backend=gemini` → note current state
  2. `POST /api/keys` with test key for gemini → 200
  3. `GET /api/keys/has?backend=gemini` → `{ has: true }`
  4. `GET /api/keys/gemini` → verify masked key in list
  5. Cleanup: `POST /api/keys/delete` to remove test key
- **UX Test:**
  1. Open Settings / API Keys panel
  2. Enter API key for Gemini
  3. Click Save
  4. Verify success indicator
  5. Verify key shows as masked (e.g., `AIza...****`)

### CUI-AI-002: AI generation succeeds
- **Priority:** P0
- **Description:** User triggers an AI-powered feature and gets a response.
- **Preconditions:** At least one AI backend available (free tier or BYOK)
- **Expected Outcome:** Non-empty AI response within timeout.
- **API Test:**
  1. `GET /api/backends/available` → verify at least one backend
  2. `POST /api/ai/generate` with simple prompt → 200, non-empty `text` field
  3. Validate response time < 60s
  4. Validate response is coherent text (not error message, not empty)
- **UX Test:**
  1. Open Analysis panel or start a debate
  2. Trigger AI generation
  3. Verify response appears (not error toast)
  4. Measure and record response time

### CUI-AI-003: Free tier rate limiting works correctly
- **Priority:** P1
- **Description:** Unauthenticated user hits rate limit and sees clear feedback.
- **Preconditions:** Free tier (no BYOK key)
- **Expected Outcome:** Rate limit enforced, 429 response with clear message.
- **API Test:**
  1. `GET /api/proxy/tier` → verify tier info (free or authenticated)
  2. `GET /api/proxy/usage` → note current usage vs limits
  3. If possible, verify 429 response format has `limitType` and `retryAfterMs`

---

## Domain 5: Auth & Access Control

### CUI-AUTH-001: Authenticated user access
- **Priority:** P0
- **Description:** Authenticated user can read and write data.
- **Preconditions:** Valid auth session (GitHub or Google OAuth)
- **Expected Outcome:** `/api/auth/me` returns user identity. Write endpoints accept requests.
- **API Test:**
  1. `GET /api/auth/me` → 200, response has `user` field (not anonymous)
  2. `GET /api/user/profile` → 200, has `storageUserId`, quota info
  3. `PUT /api/taxonomy/accelerationist` → 200 (write succeeds with auth)

### CUI-AUTH-002: Anonymous user gets read-only access
- **Priority:** P0
- **Description:** Unauthenticated user can browse taxonomy and view debates but cannot edit.
- **Preconditions:** No auth session
- **Expected Outcome:** Read endpoints work. Write endpoints return 401/403.
- **API Test:**
  1. `GET /api/auth/me` → 200, `{ anonymous: true }`
  2. `GET /api/taxonomy/accelerationist` → 200 (reads work)
  3. `PUT /api/taxonomy/accelerationist` → 401 or 403 (writes blocked)
  4. `PUT /api/debates` → 401 or 403 (writes blocked)
- **UX Test:**
  1. Open app without authentication
  2. Verify taxonomy loads and is browsable
  3. Verify edit controls are disabled or show "Sign in to edit"
  4. Screenshot: anonymous state

### CUI-AUTH-003: Admin-only endpoints reject non-admin users
- **Priority:** P1
- **Description:** Admin endpoints return 403 for non-admin authenticated users.
- **Preconditions:** Authenticated as non-admin user
- **Expected Outcome:** Admin endpoints reject with 403.
- **API Test:**
  1. `GET /api/admin/health` → 403
  2. `GET /api/admin/review/queue` → 403
  3. `GET /api/admin/feedback` → 403
  4. `GET /api/data/root` → 403

---

## Domain 6: Admin & System Health

### CUI-ADM-001: Admin health dashboard loads
- **Priority:** P0
- **Description:** Admin sees system health: version, uptime, error count, storage status.
- **Preconditions:** Authenticated as admin
- **Expected Outcome:** Health endpoint returns comprehensive system status.
- **API Test:**
  1. `GET /health` → 200, response has: `status`, `version`, `uptime`, `storage`, `github`
  2. Validate `status` is "ok" or "degraded" (not "error")
  3. `GET /api/admin/health` → 200, has `errorCount`, `feedbackCount`
- **UX Test:**
  1. Navigate to admin panel
  2. Verify health metrics displayed (version, uptime, storage)
  3. Screenshot: admin health view

### CUI-ADM-002: Analytics dashboard displays data
- **Priority:** P1
- **Description:** Admin views usage analytics with user activity, feature usage, and session data.
- **Preconditions:** Authenticated as admin, analytics events exist
- **Expected Outcome:** Dashboard loads with summary cards, activity chart, user table.
- **API Test:**
  1. `GET /api/analytics/query?from=2026-01-01&to=2026-12-31` → 200
  2. Validate response has: `summary`, `daily`, `featureUsage`, `users`
  3. If `summary.totalEvents > 0`: validate `daily` array is non-empty
- **UX Test:**
  1. Navigate to `#analytics`
  2. Verify summary cards render (Active Users, Sessions, Total Events, Avg Session)
  3. If data exists: verify activity chart renders, user table has rows
  4. Screenshot: analytics dashboard

### CUI-ADM-003: Error reporting captures and displays errors
- **Priority:** P1
- **Description:** Client errors are submitted to the server and visible in admin view.
- **Preconditions:** Admin access
- **Expected Outcome:** Errors can be submitted and retrieved.
- **API Test:**
  1. `POST /api/admin/errors` with test error payload → 200
  2. `GET /api/admin/health` → verify `errorCount` incremented
- **UX Test:**
  1. (Simulate or trigger an error in the UI)
  2. Navigate to admin panel
  3. Verify error appears in recent errors list

### CUI-ADM-004: Flight recorder captures and exports
- **Priority:** P2
- **Description:** Flight recorder ring buffer captures events and can be dumped for analysis.
- **Preconditions:** App running with activity
- **Expected Outcome:** Dump endpoint stores NDJSON, list endpoint shows dumps.
- **API Test:**
  1. `POST /api/flight-recorder/dump` with test payload → 200
  2. `GET /api/flight-recorder/list` → verify new dump appears
  3. `GET /api/flight-recorder/download/:filename` → 200, valid NDJSON

---

## Domain 7: Community Library

### CUI-COM-001: Browse community content
- **Priority:** P1
- **Description:** User browses shared debates and chats in the Community Library.
- **Preconditions:** Community content exists
- **Expected Outcome:** Community list loads with items. Items are viewable.
- **API Test:**
  1. `GET /api/community/debates` → 200, array response
  2. `GET /api/community/chats` → 200, array response
  3. If items exist: `GET /api/community/debates/:id` → 200, valid debate object
- **UX Test:**
  1. Navigate to Community Library section
  2. Verify debate/chat lists render
  3. Click an item — verify it opens in read-only view

### CUI-COM-002: Submit content to community
- **Priority:** P2
- **Description:** Authenticated user submits a personal debate to the Community Library for review.
- **Preconditions:** User has a saved debate, authenticated
- **Expected Outcome:** Submission created, appears in admin review queue.
- **API Test:**
  1. `POST /api/community/submit` with debate ID → 200
  2. `GET /api/admin/submissions` (as admin) → verify submission appears

---

## Domain 8: Data & Infrastructure

### CUI-DATA-001: Taxonomy data loads from GitHub
- **Priority:** P0
- **Description:** Server loads taxonomy data from the ai-triad-data GitHub repo on startup.
- **Preconditions:** Server running, GitHub accessible
- **Expected Outcome:** Data available, all POV files populated.
- **API Test:**
  1. `GET /api/data/available` → `{ available: true }`
  2. `GET /health` → verify `github.rateLimit` is present and remaining > 0
  3. All four POV GETs return non-empty node arrays (covered by CUI-TAX-001)

### CUI-DATA-002: Session branch isolation
- **Priority:** P0
- **Description:** Edits by one user don't affect another user's view until merged.
- **Preconditions:** Two authenticated users
- **Expected Outcome:** User A's edit doesn't appear in User B's taxonomy GET.
- **API Test:**
  1. `GET /api/sync/status` → verify session branch name matches user
  2. Make a node edit (PUT taxonomy)
  3. Verify edit is on session branch (not main)
  4. Note: full multi-user isolation test requires two auth contexts

### CUI-DATA-003: Health monitoring detects outages
- **Priority:** P1
- **Description:** The 15-min health monitor cron correctly detects when the app is down.
- **Preconditions:** Health monitor workflow configured
- **Expected Outcome:** `/health` and `/api/data/available` respond correctly.
- **API Test:**
  1. `GET /health` → 200 within 5s
  2. `GET /api/data/available` → 200 within 5s
  3. `GET /healthz` → 200 within 1s (liveness probe)

---

## Domain 9: Calibration & Quality

### CUI-CAL-001: Calibration dashboard shows metrics
- **Priority:** P1
- **Description:** Calibration dashboard renders debate quality metrics over time.
- **Preconditions:** Calibration data exists (debates have been run with calibration logging)
- **Expected Outcome:** Metrics load, charts render with data points.
- **API Test:**
  1. `GET /api/calibration/log` → 200, has `entries` and `validation`
  2. If entries exist: validate entries have expected metric keys (crux_addressed_ratio, avg_utilization_rate, etc.)
  3. `GET /api/calibration/history` → 200, has parameter history entries
- **UX Test:**
  1. Open Calibration Dashboard
  2. Verify metric charts render (at least one chart with data)
  3. Verify validation summary shows pass/fail counts
  4. Screenshot: calibration overview

---

## Summary

| Domain | CUI Count | P0 | P1 | P2 |
|---|---|---|---|---|
| Taxonomy Browsing | 5 | 2 | 3 | 0 |
| Taxonomy Editing | 2 | 1 | 1 | 0 |
| Debates | 5 | 2 | 2 | 1 |
| AI Integration | 3 | 2 | 1 | 0 |
| Auth & Access | 3 | 2 | 1 | 0 |
| Admin & Health | 4 | 1 | 2 | 1 |
| Community | 2 | 0 | 1 | 1 |
| Data & Infrastructure | 3 | 2 | 1 | 0 |
| Calibration | 1 | 0 | 1 | 0 |
| **Total** | **28** | **12** | **13** | **3** |

## Test Level Coverage

| CUI ID | API Test | UX Test |
|---|---|---|
| CUI-TAX-001 | Yes (6 checks) | Yes (5 steps + screenshot) |
| CUI-TAX-002 | Yes (3 checks) | Yes (5 steps + screenshot) |
| CUI-TAX-003 | Partial (client-side search) | Yes (5 steps + screenshot) |
| CUI-TAX-004 | Yes (4 checks) | Yes (3 steps) |
| CUI-TAX-005 | Yes (3 checks) | — |
| CUI-TAX-010 | Yes (5 checks + cleanup) | Yes (7 steps + screenshot) |
| CUI-TAX-011 | Yes (5 checks) | Yes (4 steps) |
| CUI-DEB-001 | Yes (4 checks) | Yes (6 steps + screenshot) |
| CUI-DEB-002 | Yes (4 checks) | Yes (5 steps + screenshot) |
| CUI-DEB-003 | — | Yes (5 steps + screenshot) |
| CUI-DEB-004 | Yes (3 checks) | Yes (5 steps + screenshot) |
| CUI-DEB-005 | Yes (4 checks) | — |
| CUI-AI-001 | Yes (5 checks + cleanup) | Yes (5 steps) |
| CUI-AI-002 | Yes (4 checks) | Yes (4 steps) |
| CUI-AI-003 | Yes (3 checks) | — |
| CUI-AUTH-001 | Yes (3 checks) | — |
| CUI-AUTH-002 | Yes (4 checks) | Yes (4 steps + screenshot) |
| CUI-AUTH-003 | Yes (4 checks) | — |
| CUI-ADM-001 | Yes (3 checks) | Yes (3 steps + screenshot) |
| CUI-ADM-002 | Yes (3 checks) | Yes (4 steps + screenshot) |
| CUI-ADM-003 | Yes (2 checks) | Yes (3 steps) |
| CUI-ADM-004 | Yes (3 checks) | — |
| CUI-COM-001 | Yes (3 checks) | Yes (3 steps) |
| CUI-COM-002 | Yes (2 checks) | — |
| CUI-DATA-001 | Yes (3 checks) | — |
| CUI-DATA-002 | Yes (3 checks) | — |
| CUI-DATA-003 | Yes (3 checks) | — |
| CUI-CAL-001 | Yes (3 checks) | Yes (4 steps + screenshot) |

**Coverage: 26/28 CUIs have API tests, 16/28 have UX tests.**

---

## Cmdlet Data Structure

The catalog will be encoded as a PowerShell data structure so `Get-CriticalInteraction` can enumerate it:

```powershell
@{
    Id           = 'CUI-TAX-001'
    Domain       = 'Taxonomy'
    Priority     = 'P0'
    Title        = 'Load taxonomy and view nodes'
    Description  = 'User opens the app and sees the taxonomy graph with all four POV camps populated.'
    Preconditions = @('Server running', 'Data available')
    ApiChecks    = 6
    UxSteps      = 5
    HasScreenshot = $true
}
```

`Test-CriticalInteractions` iterates this structure, runs the test function matching each ID, and returns structured results:

```powershell
[PSCustomObject]@{
    CuiId       = 'CUI-TAX-001'
    Domain      = 'Taxonomy'
    Priority    = 'P0'
    Level       = 'API'         # or 'UX'
    Pass        = $true
    DurationMs  = 342
    Checks      = 6
    Passed      = 6
    Failed      = 0
    Details     = @(...)        # per-check results
    Screenshot  = $null         # path for UX tests
    Error       = $null
}
```

---

## Relationship to Existing Tests

| Existing Test | CUIs It Covers (partially) | Gap CUIs Fill |
|---|---|---|
| `Test-TaxEditorHealth` | CUI-DATA-003 (health probes) | Semantic validation, not just status codes |
| `Test-TaxEditorEndpoints` | CUI-TAX-001 (GET taxonomy), CUI-TAX-004 (edges) | Response shape validation, mutation testing |
| `Invoke-TaxEditorSmokeTest` | CUI-DATA-001, CUI-DATA-003 | End-to-end workflows, not just endpoint liveness |
| Deploy acceptance tests | CUI-TAX-001, CUI-DEB-001, CUI-AUTH-001 | Full semantic checks, multi-step workflows, UX validation |

The CUI cmdlets should **call** existing smoke test cmdlets where appropriate (don't re-implement health checks), then layer on deeper validation.

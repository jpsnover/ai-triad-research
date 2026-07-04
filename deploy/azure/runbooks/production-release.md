# Runbook: Production Release

**Trigger:** New code ready to deploy to production (feature merge, bug fix, or scheduled release)

**Owner:** DevOps/Azure owns the deploy pipeline. App roles own pre-build verification.

## Prerequisites

- Azure OIDC credentials configured in GitHub Actions secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`)
- OAuth secrets configured (`GH_OAUTH_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `AAD_CLIENT_ID`, etc.)
- `ADMIN_USERS` GitHub Actions variable set
- Access to trigger `workflow_dispatch` on the repo

## Step 1: Pre-Build Verification (App Side)

1. Run the full verify gate:
   ```bash
   cd taxonomy-editor && npm run verify
   ```
   This runs tsc (main + server) + eslint + depcruise + vitest + vite build.

2. Ensure working tree is clean of stray files. Commit by **explicit pathspec** — never `git add -A` (it stages overlay files like `AGENTS.md`/`.orca*`).

3. Push to `main`. Wait for CI to complete — all 6 jobs must pass before the deploy workflow will proceed.

## Step 2: Build Container Image

1. Trigger the Container Image workflow:
   ```bash
   gh workflow run container.yml --ref main
   ```

2. Wait for the build to complete (use `gh run watch` — never poll in a loop):
   ```bash
   # Get the run ID, then watch it to completion
   gh run list --workflow=container.yml --limit=1
   gh run watch <run-id> --exit-status
   ```

3. Verify the image exists in GHCR:
   ```bash
   gh api user/packages/container/taxonomy-editor/versions --jq '.[0].metadata.container.tags'
   ```

## Step 3: Deploy to Azure

1. Trigger the deploy workflow (**once only** — duplicate dispatches are cancelled):
   ```bash
   gh workflow run deploy-azure.yml --ref main \
     -f environment=production \
     -f auth_mode=optional \
     -f image_tag=latest
   ```

2. Monitor the deploy:
   ```bash
   gh run list --workflow=deploy-azure.yml --limit=1
   gh run watch <run-id>
   ```

3. The workflow automatically:
   - Verifies CI passed for the commit (test-electron + test-container)
   - Verifies the container image exists in GHCR
   - Runs Bicep what-if (checks for unexpected deletions)
   - Deploys Bicep template (infra + app config)
   - Creates new revision at 0% traffic
   - Health checks the new revision (Phase 1: server up, Phase 2: data loaded)
   - Runs acceptance tests (18 endpoint checks across 8 categories)
   - Shifts 100% traffic to new revision on success
   - Auto-rollback on failure (deactivates failed revision, restores previous)

## Step 4: Post-Deploy Verification

1. Confirm the live revision matches the expected commit:
   ```bash
   gh run view <deploy-run-id> --json headSha --jq '.headSha'
   ```

2. Check production health:
   ```bash
   curl -s https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/health | python -m json.tool
   curl -s https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/healthz
   ```

3. Or use the PowerShell diagnostics:
   ```powershell
   Import-Module ./scripts/AITriad/AITriad.psm1
   Invoke-TaxEditorSmokeTest -Detailed
   ```

4. Spot-check core flows in browser:
   - Root URL renders (sign-in page or anonymous read-only)
   - Taxonomy tree loads, node detail opens
   - Debate tab loads
   - Sync save-bar shows status
   - Conflict badge degrades gracefully when no conflicts exist

5. Scan flight-recorder logs for startup errors:
   ```bash
   az containerapp logs show --name taxonomy-editor -g ai-triad --type console --tail 50
   ```

## Rollback

If post-deploy issues are found after traffic shift:

1. List revisions and identify the previous good one:
   ```bash
   az containerapp revision list --name taxonomy-editor -g ai-triad \
     --query "[?properties.active].{name:name, traffic:properties.trafficWeight, created:properties.createdTime}" -o table
   ```

2. Shift traffic back to the previous revision:
   ```bash
   az containerapp ingress traffic set --name taxonomy-editor -g ai-triad \
     --revision-weight "<previous-revision>=100"
   ```

3. Deactivate the broken revision:
   ```bash
   az containerapp revision deactivate --name taxonomy-editor -g ai-triad \
     --revision "<broken-revision>"
   ```

The deploy workflow handles this automatically when health checks or acceptance tests fail. Manual rollback is only needed for issues discovered after the workflow completes.

## Deploy Hold

**2026-07-04 — Owner decision: NO production deploy until explicitly authorized.** Current prod is stable on ca8e7428 (July 1 code) against the migrated data. The cc→sit migration (t/1308) landed in the data repo but the code repo has accumulated significant changes (quality gates, doc-accuracy gates, dependency patches, cc→sit code-side tightening). Risk assessment deferred a deploy despite green CI. Do not dispatch `deploy-azure.yml` until the owner explicitly lifts this hold.

## Known Issues

- **Duplicate dispatch**: `gh workflow run` occasionally emits two `workflow_dispatch` events. The deploy workflow has `cancel-in-progress: true` so the duplicate is cancelled automatically. If you see a failed run alongside a successful one for the same commit, check both before investigating.
- **BCP318/BCP422 warnings**: `runner/runner.bicep` emits null-safety warnings during every deploy. These are cosmetic — the runner module is disabled (`enabled=false`) and the warnings don't affect the Container App deployment.
- **AlertsManagement RP warnings**: Bicep may emit stderr warnings about the AlertsManagement resource provider. These don't affect deployment (`failOnStdErr: false` is set).

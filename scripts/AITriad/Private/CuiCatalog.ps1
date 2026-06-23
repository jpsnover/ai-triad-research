# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Critical User Interactions catalog — all 28 CUIs from docs/design/cui-catalog.md
$script:CuiCatalog = @(

    # ── Domain: Taxonomy Browsing & Viewing ──────────────────────────────

    @{
        Id            = 'CUI-TAX-001'
        Domain        = 'Taxonomy'
        Priority      = 'P0'
        Title         = 'Load taxonomy and view nodes'
        Description   = 'User opens the app and sees the taxonomy graph with all four POV camps populated.'
        Preconditions = @('Server running', 'Data available')
        ApiChecks     = 6
        UxSteps       = 5
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-TAX-002'
        Domain        = 'Taxonomy'
        Priority      = 'P0'
        Title         = 'Select node and view attributes'
        Description   = 'User clicks a node and sees its BDI attributes, policy actions, and metadata.'
        Preconditions = @('Taxonomy loaded')
        ApiChecks     = 3
        UxSteps       = 5
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-TAX-003'
        Domain        = 'Taxonomy'
        Priority      = 'P1'
        Title         = 'Search for nodes'
        Description   = 'User types a search query and finds relevant nodes across all POVs.'
        Preconditions = @('Taxonomy loaded')
        ApiChecks     = 3
        UxSteps       = 5
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-TAX-004'
        Domain        = 'Taxonomy'
        Priority      = 'P1'
        Title         = 'View edges between nodes'
        Description   = 'User sees relationship edges connecting taxonomy nodes.'
        Preconditions = @('Taxonomy and edges loaded')
        ApiChecks     = 4
        UxSteps       = 3
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-TAX-005'
        Domain        = 'Taxonomy'
        Priority      = 'P1'
        Title         = 'View policy registry'
        Description   = 'User views the policy action registry and cross-POV policy mappings.'
        Preconditions = @('Taxonomy loaded')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: Taxonomy Editing ─────────────────────────────────────────

    @{
        Id            = 'CUI-TAX-010'
        Domain        = 'Taxonomy'
        Priority      = 'P0'
        Title         = 'Edit a node and save'
        Description   = 'Authenticated user edits a node description and saves. The change persists on their session branch.'
        Preconditions = @('User authenticated', 'Session branch exists')
        ApiChecks     = 5
        UxSteps       = 7
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-TAX-011'
        Domain        = 'Taxonomy'
        Priority      = 'P1'
        Title         = 'Submit changes for review (PR flow)'
        Description   = 'User with pending edits creates a pull request to merge their session branch.'
        Preconditions = @('User has uncommitted edits')
        ApiChecks     = 5
        UxSteps       = 4
        HasScreenshot = $false
    }

    # ── Domain: Debates ──────────────────────────────────────────────────

    @{
        Id            = 'CUI-DEB-001'
        Domain        = 'Debate'
        Priority      = 'P0'
        Title         = 'Start a new debate'
        Description   = 'User enters a topic and starts a three-character debate.'
        Preconditions = @('AI backend available')
        ApiChecks     = 4
        UxSteps       = 6
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-DEB-002'
        Domain        = 'Debate'
        Priority      = 'P0'
        Title         = 'Run multi-turn debate'
        Description   = 'User advances a debate through multiple turns, seeing AI-generated responses and taxonomy extractions.'
        Preconditions = @('Active debate')
        ApiChecks     = 4
        UxSteps       = 5
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-DEB-003'
        Domain        = 'Debate'
        Priority      = 'P1'
        Title         = 'View debate analysis panels'
        Description   = 'User views convergence signals, fallacy detection, and grounding evidence for an active debate.'
        Preconditions = @('Debate with 3+ turns')
        ApiChecks     = 0
        UxSteps       = 5
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-DEB-004'
        Domain        = 'Debate'
        Priority      = 'P1'
        Title         = 'Save and resume debate'
        Description   = 'User saves a debate, navigates away, and returns to find it intact.'
        Preconditions = @('Active debate with turns')
        ApiChecks     = 3
        UxSteps       = 5
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-DEB-005'
        Domain        = 'Debate'
        Priority      = 'P2'
        Title         = 'Delete a debate'
        Description   = 'User deletes a debate session.'
        Preconditions = @('At least one saved debate')
        ApiChecks     = 4
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: AI Integration ───────────────────────────────────────────

    @{
        Id            = 'CUI-AI-001'
        Domain        = 'AI'
        Priority      = 'P0'
        Title         = 'Configure BYOK API key'
        Description   = 'User enters their own API key and it is stored securely for subsequent AI calls.'
        Preconditions = @('User authenticated')
        ApiChecks     = 5
        UxSteps       = 5
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-AI-002'
        Domain        = 'AI'
        Priority      = 'P0'
        Title         = 'AI generation succeeds'
        Description   = 'User triggers an AI-powered feature and gets a response.'
        Preconditions = @('At least one AI backend available')
        ApiChecks     = 4
        UxSteps       = 4
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-AI-003'
        Domain        = 'AI'
        Priority      = 'P1'
        Title         = 'Free tier rate limiting works correctly'
        Description   = 'Unauthenticated user hits rate limit and sees clear feedback.'
        Preconditions = @('Free tier, no BYOK key')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: Auth & Access Control ────────────────────────────────────

    @{
        Id            = 'CUI-AUTH-001'
        Domain        = 'Auth'
        Priority      = 'P0'
        Title         = 'Authenticated user access'
        Description   = 'Authenticated user can read and write data.'
        Preconditions = @('Valid auth session')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-AUTH-002'
        Domain        = 'Auth'
        Priority      = 'P0'
        Title         = 'Anonymous user gets read-only access'
        Description   = 'Unauthenticated user can browse taxonomy and view debates but cannot edit.'
        Preconditions = @('No auth session')
        ApiChecks     = 4
        UxSteps       = 4
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-AUTH-003'
        Domain        = 'Auth'
        Priority      = 'P1'
        Title         = 'Admin-only endpoints reject non-admin users'
        Description   = 'Admin endpoints return 403 for non-admin authenticated users.'
        Preconditions = @('Authenticated as non-admin user')
        ApiChecks     = 4
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: Admin & System Health ────────────────────────────────────

    @{
        Id            = 'CUI-ADM-001'
        Domain        = 'Admin'
        Priority      = 'P0'
        Title         = 'Admin health dashboard loads'
        Description   = 'Admin sees system health: version, uptime, error count, storage status.'
        Preconditions = @('Authenticated as admin')
        ApiChecks     = 3
        UxSteps       = 3
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-ADM-002'
        Domain        = 'Admin'
        Priority      = 'P1'
        Title         = 'Analytics dashboard displays data'
        Description   = 'Admin views usage analytics with user activity, feature usage, and session data.'
        Preconditions = @('Authenticated as admin', 'Analytics events exist')
        ApiChecks     = 3
        UxSteps       = 4
        HasScreenshot = $true
    }
    @{
        Id            = 'CUI-ADM-003'
        Domain        = 'Admin'
        Priority      = 'P1'
        Title         = 'Error reporting captures and displays errors'
        Description   = 'Client errors are submitted to the server and visible in admin view.'
        Preconditions = @('Admin access')
        ApiChecks     = 2
        UxSteps       = 3
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-ADM-004'
        Domain        = 'Admin'
        Priority      = 'P2'
        Title         = 'Flight recorder captures and exports'
        Description   = 'Flight recorder ring buffer captures events and can be dumped for analysis.'
        Preconditions = @('App running with activity')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: Community Library ────────────────────────────────────────

    @{
        Id            = 'CUI-COM-001'
        Domain        = 'Community'
        Priority      = 'P1'
        Title         = 'Browse community content'
        Description   = 'User browses shared debates and chats in the Community Library.'
        Preconditions = @('Community content exists')
        ApiChecks     = 3
        UxSteps       = 3
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-COM-002'
        Domain        = 'Community'
        Priority      = 'P2'
        Title         = 'Submit content to community'
        Description   = 'Authenticated user submits a personal debate to the Community Library for review.'
        Preconditions = @('User has a saved debate', 'Authenticated')
        ApiChecks     = 2
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: Data & Infrastructure ────────────────────────────────────

    @{
        Id            = 'CUI-DATA-001'
        Domain        = 'Data'
        Priority      = 'P0'
        Title         = 'Taxonomy data loads from GitHub'
        Description   = 'Server loads taxonomy data from the ai-triad-data GitHub repo on startup.'
        Preconditions = @('Server running', 'GitHub accessible')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-DATA-002'
        Domain        = 'Data'
        Priority      = 'P0'
        Title         = 'Session branch isolation'
        Description   = 'Edits by one user do not affect another user''s view until merged.'
        Preconditions = @('Two authenticated users')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }
    @{
        Id            = 'CUI-DATA-003'
        Domain        = 'Data'
        Priority      = 'P1'
        Title         = 'Health monitoring detects outages'
        Description   = 'The 15-min health monitor cron correctly detects when the app is down.'
        Preconditions = @('Health monitor workflow configured')
        ApiChecks     = 3
        UxSteps       = 0
        HasScreenshot = $false
    }

    # ── Domain: Calibration & Quality ────────────────────────────────────

    @{
        Id            = 'CUI-CAL-001'
        Domain        = 'Calibration'
        Priority      = 'P1'
        Title         = 'Calibration dashboard shows metrics'
        Description   = 'Calibration dashboard renders debate quality metrics over time.'
        Preconditions = @('Calibration data exists')
        ApiChecks     = 3
        UxSteps       = 4
        HasScreenshot = $true
    }
)

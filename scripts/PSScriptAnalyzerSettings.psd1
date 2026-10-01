# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# PSScriptAnalyzer settings for the AITriad PowerShell module (t/3824).
#
# Deliberately unfiltered: no rule exclusions, default severities. This is a
# MEASUREMENT artifact (t/3824 — "measurement, not a gate") — the point is an
# honest count of what PSSA actually flags across scripts/AITriad, not a
# pre-curated subset. A future gate ticket may narrow this; this file does not.
@{
    IncludeDefaultRules = $true
}

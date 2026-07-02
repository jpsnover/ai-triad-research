#!/usr/bin/env pwsh
# Overlay repo wrapper — equivalent to the `ogit` shell alias but works in non-interactive
# shells (Bash tool, CI scripts) where aliases are unavailable.
#
# Usage: pwsh ./scripts/ogit.ps1 <git-args>
#   e.g. pwsh ./scripts/ogit.ps1 status
#        pwsh ./scripts/ogit.ps1 add -f orca-support/AGENTS.md
#        pwsh ./scripts/ogit.ps1 commit -m "message"
#
# Always resolves paths relative to the git repo root, so it works from any subdirectory.

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    Write-Error "ogit.ps1: not inside a git repository"
    exit 1
}

& git --git-dir="$repoRoot/.orca-git" --work-tree="$repoRoot" @args

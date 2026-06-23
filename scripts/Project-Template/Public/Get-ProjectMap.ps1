function Get-ProjectMap {
    <#
    .SYNOPSIS
        Generates a live project overview: directory tree, key files, and git status.
    .DESCRIPTION
        Produces a low-token project overview suitable for orienting AI agents
        or onboarding contributors. Includes directory tree (configurable depth),
        key file detection (manifests, configs, entry points), and git status summary.
    .PARAMETER Depth
        Directory tree depth. Default: 3.
    .PARAMETER IncludeGitStatus
        Include git status summary. Default: true.
    .EXAMPLE
        Get-ProjectMap
    .EXAMPLE
        Get-ProjectMap -Depth 2 | clip
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [int]$Depth = 3,

        [Parameter()]
        [bool]$IncludeGitStatus = $true
    )

    Set-StrictMode -Version Latest

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("# Project Map")
    [void]$sb.AppendLine("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
    [void]$sb.AppendLine("")

    # Directory tree
    [void]$sb.AppendLine("## Directory Structure (depth $Depth)")
    [void]$sb.AppendLine('```')

    $exclude = @('node_modules', '.git', '.orca-git', 'build', 'dist', 'out', '__pycache__', '.venv')

    function Write-Tree {
        param([string]$Dir, [string]$Prefix, [int]$CurrentDepth, [int]$MaxDepth)
        if ($CurrentDepth -ge $MaxDepth) { return }

        $items = @(Get-ChildItem -Path $Dir -Force |
            Where-Object { $_.Name -notin $exclude -and -not $_.Name.StartsWith('.') } |
            Sort-Object @{E={$_.PSIsContainer};Descending=$true}, Name)

        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items[$i]
            $isLast = ($i -eq $items.Count - 1)
            $connector = if ($isLast) { '`-- ' } else { '|-- ' }
            $childPrefix = if ($isLast) { '    ' } else { '|   ' }

            $suffix = ''
            if ($item.PSIsContainer) { $suffix = '/' }
            elseif ($item.Name -match '\.(psd1|psm1)$') { $suffix = ' (PS module)' }
            elseif ($item.Name -eq 'package.json') { $suffix = ' (npm)' }

            [void]$sb.AppendLine("$Prefix$connector$($item.Name)$suffix")

            if ($item.PSIsContainer) {
                Write-Tree -Dir $item.FullName -Prefix "$Prefix$childPrefix" `
                    -CurrentDepth ($CurrentDepth + 1) -MaxDepth $MaxDepth
            }
        }
    }

    [void]$sb.AppendLine((Split-Path $script:RepoRoot -Leaf) + '/')
    Write-Tree -Dir $script:RepoRoot -Prefix '' -CurrentDepth 0 -MaxDepth $Depth
    [void]$sb.AppendLine('```')

    # Key files
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## Key Files")
    $keyFiles = @(
        'CLAUDE.md', 'AGENTS.md', 'package.json', '.env.example',
        'SECURITY.md', 'CONTRIBUTING.md', 'THIRD-PARTY-NOTICES.txt'
    )
    foreach ($kf in $keyFiles) {
        $fullPath = Join-Path $script:RepoRoot $kf
        if (Test-Path $fullPath) {
            $size = (Get-Item $fullPath).Length
            [void]$sb.AppendLine("- ``$kf`` ($([math]::Round($size / 1KB, 1)) KB)")
        }
    }

    # Git status
    if ($IncludeGitStatus) {
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("## Git Status")
        $branch = & git -C $script:RepoRoot rev-parse --abbrev-ref HEAD 2>$null
        $ahead = & git -C $script:RepoRoot rev-list --count '@{upstream}..HEAD' 2>$null
        $behind = & git -C $script:RepoRoot rev-list --count 'HEAD..@{upstream}' 2>$null
        $dirty = & git -C $script:RepoRoot status --porcelain 2>$null
        $dirtyCount = if ($dirty) { @($dirty).Count } else { 0 }

        [void]$sb.AppendLine("- Branch: ``$branch``")
        if ($ahead) { [void]$sb.AppendLine("- Ahead: $ahead / Behind: $($behind ?? 0)") }
        [void]$sb.AppendLine("- Uncommitted changes: $dirtyCount files")
    }

    $sb.ToString()
}

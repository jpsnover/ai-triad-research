# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    t/3869 — classify whether the data repo's git hooks are wired (core.hooksPath).
.DESCRIPTION
    Both data-repo guards (.githooks/pre-commit rationale-drop t/2945; commit-msg node-removal
    t/3851 once committed) enforce NOTHING unless that checkout has core.hooksPath = .githooks,
    and core.hooksPath is per-checkout local config: a fresh clone or new worktree has both guards
    silently absent, indistinguishable from the guards passing (Class-8).

    Split pure-from-I/O (mirrors BranchStrandVerdict.ps1 / OutletKeySetVerdict.ps1):
      Resolve-DataRepoRoot      PURE  — path resolution, same priority as the runtime
      Get-DataRepoHooksVerdict  PURE  — state from gathered facts
      Get-DataRepoHooksFacts    I/O   — git/filesystem reads for the live check (Verify-Config.ps1)

    STATES (t/3869#2 — enumerated so blanks are visible, not just wired/unwired):
      WIRED         hooksPath = .githooks and every expected hook present + executable  → PASS
      COMMITTED_NOT_PUSHED  wired + 100755 in local HEAD, but not 100755 on origin/<default>
                    (last-fetched) — fresh clones still get the old mode               → WARN
      UNWIRED       hooksPath unset                                                     → WARN
      MISWIRED      hooksPath set to anything other than .githooks                      → WARN
      HOOK_MISSING  wired, but an expected hook is absent OR not executable as COMMITTED
                    (HEAD tree mode != 100755 — on Linux/macOS git IGNORES a non-executable
                    hook)                                                                → WARN
                    Reads the COMMITTED mode (git ls-tree HEAD), not the index: with
                    core.fileMode=false a pathspec commit silently drops a staged +x, leaving
                    the index at 100755 while HEAD stays 100644 (TL p/331#1811, t/3851#9). An
                    index read would report WIRED there — a false green. A staged-but-
                    uncommitted +x is named explicitly in the reason.
      ABSENT        nothing exists at the resolved path (code-only / public-repo setup) → N/A
      UNDETERMINED  couldn't tell: malformed/missing .aitriad.json, env var pointing at a
                    path that doesn't exist, or a path that exists but isn't a git repo  → FAIL

    N/A is NOT a pass: it never counts toward PASSED (t/3869#2 — "all green" over a check that
    never ran is the empty-result-read-as-clean shape PowerShell fixed in a63244c7).

    GATE PROMOTION (Gate Co-Location, t/3869#2): UNWIRED / MISWIRED / HOOK_MISSING are WARN-ONLY.
    Making any of them FAIL is a new blocking gate → needs >=1 real warn cycle, t/3870 (push-side
    re-check) landed, evidence the warning is actually being ignored, TL GV, and a mandatory Second
    Opinion. LAPSE CONDITION: revisit only after all of those; until then this stays a warning.

    Does NOT assert (stated so a green isn't over-read): that the hooks FIRE CORRECTLY. Only that
    they are wired. A wired hook with a dead body passes this check (the t/3868 distinction).
#>

function Resolve-DataRepoRoot {
    <#
    .SYNOPSIS
        PURE. Resolve the data-repo root with the runtime's priority (Resolve-DataPath.ps1:Get-DataRoot):
        $env:AI_TRIAD_DATA_ROOT > .aitriad.json data_root (relative → anchored at the config's dir,
        GetFullPath-normalized) > (no dev-install fallback here: a missing/malformed config is the
        "couldn't determine" case — the runtime warns and falls back to '.', i.e. the CODE repo, so
        mirroring that would silently check the wrong repo's hooks).
    .OUTPUTS
        { Path; Source = env|config; Undetermined; Reason }
    #>
    [CmdletBinding()]
    param(
        [AllowEmptyString()][AllowNull()][string]$EnvValue,
        [AllowEmptyString()][AllowNull()][string]$ConfigText,   # raw .aitriad.json text; $null = file missing
        [Parameter(Mandatory)][string]$ConfigDir,               # dir holding .aitriad.json
        # The anchor for a RELATIVE data_root. Same precedence as the runtime's Get-DataRoot
        # (PR #2732): the main-checkout root from Get-WorktreeMainRoot when resolvable (correct
        # from nested AND sibling worktrees), else $ConfigDir. Passed in — not computed here — so
        # this function stays pure; the I/O layer obtains it by calling the SAME shared
        # Get-WorktreeMainRoot the runtime calls (no second implementation to drift).
        [AllowEmptyString()][AllowNull()][string]$AnchorRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($EnvValue)) {
        return [PSCustomObject]@{ Path = $EnvValue; Source = 'env'; Undetermined = $false; Reason = 'AI_TRIAD_DATA_ROOT' }
    }
    if ($null -eq $ConfigText) {
        return [PSCustomObject]@{ Path = $null; Source = 'config'; Undetermined = $true
            Reason = ".aitriad.json not found in $ConfigDir (runtime would fall back to the CODE repo)" }
    }
    try { $cfg = $ConfigText | ConvertFrom-Json -ErrorAction Stop }
    catch {
        return [PSCustomObject]@{ Path = $null; Source = 'config'; Undetermined = $true
            Reason = ".aitriad.json is not valid JSON: $($_.Exception.Message)" }
    }
    $root = if ($cfg -and $cfg.PSObject.Properties['data_root']) { [string]$cfg.data_root } else { '' }
    if ([string]::IsNullOrWhiteSpace($root)) {
        return [PSCustomObject]@{ Path = $null; Source = 'config'; Undetermined = $true
            Reason = '.aitriad.json has no data_root' }
    }
    $anchor = if (-not [string]::IsNullOrWhiteSpace($AnchorRoot)) { $AnchorRoot } else { $ConfigDir }
    $full = if ([System.IO.Path]::IsPathRooted($root)) { [System.IO.Path]::GetFullPath($root) }
            else { [System.IO.Path]::GetFullPath((Join-Path $anchor $root)) }
    return [PSCustomObject]@{ Path = $full; Source = 'config'; Undetermined = $false; Reason = '.aitriad.json data_root' }
}

function Test-HooksPathWired {
    # PURE. True when core.hooksPath points at the repo's own .githooks (relative or absolute).
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$HooksPath, [AllowNull()][string]$RepoPath)
    $norm = $HooksPath.Trim().Replace('\', '/').TrimEnd('/')
    $abs  = ([string]$RepoPath).Replace('\', '/').TrimEnd('/') + '/.githooks'
    return ($norm -eq '.githooks') -or ($norm -eq './.githooks') -or ($norm -ieq $abs)
}

function Get-HookFact {
    # PURE. Null-safe read of one key from a hook's fact hashtable.
    param([hashtable]$Hook, [string]$Key)
    if ($Hook.ContainsKey($Key)) { return $Hook[$Key] }
    return $null
}

function Get-HookModeProblems {
    # PURE. One message per expected hook that is absent or not 100755 as COMMITTED.
    [CmdletBinding()]
    param([hashtable]$Hooks = @{})
    foreach ($name in ($Hooks.Keys | Sort-Object)) {
        $h = $Hooks[$name]
        $committed = Get-HookFact $h 'CommittedMode'
        if (-not $h.Present) { "$name absent"; continue }
        if ($committed -eq '100755') { continue }
        $msg = "$name not executable as committed (HEAD mode $committed; git ignores it on Linux/macOS)"
        if ((Get-HookFact $h 'IndexMode') -eq '100755') { $msg += " — index says 100755: +x is STAGED but was never committed (a pathspec commit with core.fileMode=false drops it)" }
        $msg
    }
}

function Get-HookPushGaps {
    # PURE. Hooks whose mode on the last-fetched origin/<default> is not 100755.
    [CmdletBinding()]
    param([hashtable]$Hooks = @{})
    $remoteRef = $null; $gaps = [System.Collections.Generic.List[string]]::new()
    foreach ($name in ($Hooks.Keys | Sort-Object)) {
        $h = $Hooks[$name]
        $ref = Get-HookFact $h 'RemoteRef'
        if (-not $ref) { continue }
        $remoteRef = $ref
        $rm = Get-HookFact $h 'RemoteMode'
        if ($rm -eq '100755') { continue }
        $shown = if ($rm) { $rm } else { 'absent' }
        $gaps.Add("$name is 100755 in local HEAD but $shown on $ref")
    }
    return [PSCustomObject]@{ RemoteRef = $remoteRef; Gaps = $gaps }
}

function Get-DataRepoHooksVerdict {
    <#
    .SYNOPSIS
        PURE. Classify from gathered facts. See the header for states/severities.
    .PARAMETER Hooks
        hashtable: hook name -> @{ Present = bool; CommittedMode = '100755'|'100644'|$null; IndexMode = ...|$null }
        CommittedMode (HEAD tree) decides; IndexMode is diagnostic only.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][PSCustomObject]$Resolution,   # Resolve-DataRepoRoot output
        [bool]$PathExists,
        [bool]$IsGitRepo,
        [AllowNull()][AllowEmptyString()][string]$HooksPath, # `git config --get core.hooksPath`; $null = unset
        [hashtable]$Hooks = @{}
    )

    $mk = {
        param($State, $Severity, $Reason, $Remedy)
        [PSCustomObject]@{ State = $State; Severity = $Severity; Reason = $Reason; Remediation = $Remedy; Path = $Resolution.Path }
    }

    if ($Resolution.Undetermined) {
        return & $mk 'UNDETERMINED' 'FAIL' $Resolution.Reason 'Fix the data-root configuration (AI_TRIAD_DATA_ROOT or .aitriad.json data_root).'
    }
    if (-not $PathExists) {
        # An EXPLICIT env var pointing nowhere is a broken config, not a code-only setup.
        if ($Resolution.Source -eq 'env') {
            return & $mk 'UNDETERMINED' 'FAIL' "AI_TRIAD_DATA_ROOT points at '$($Resolution.Path)', which does not exist" 'Unset AI_TRIAD_DATA_ROOT or point it at the data checkout.'
        }
        return & $mk 'ABSENT' 'NA' "no data repo at '$($Resolution.Path)' (code-only checkout)" ''
    }
    if (-not $IsGitRepo) {
        return & $mk 'UNDETERMINED' 'FAIL' "'$($Resolution.Path)' exists but is not a git repo" 'Point the data root at a git checkout of ai-triad-data.'
    }

    $wire = "git -C `"$($Resolution.Path)`" config core.hooksPath .githooks"
    if ([string]::IsNullOrWhiteSpace($HooksPath)) {
        return & $mk 'UNWIRED' 'WARN' 'core.hooksPath is unset: both data-repo guards are silently inactive in this checkout' $wire
    }
    if (-not (Test-HooksPathWired -HooksPath $HooksPath -RepoPath $Resolution.Path)) {
        return & $mk 'MISWIRED' 'WARN' "core.hooksPath is '$HooksPath', not .githooks: the data-repo guards are not the hooks being run" $wire
    }

    $bad = @(Get-HookModeProblems -Hooks $Hooks)
    if ($bad.Count -gt 0) {
        # NOT `update-index --chmod=+x` + a pathspec commit: with core.fileMode=false that silently
        # commits 100644 anyway (TL p/331#1811). Use the tested private-index recipe.
        return & $mk 'HOOK_MISSING' 'WARN' ("wired, but: " + ($bad -join '; ')) 'Restore the hook / commit it as 100755 using the private-index + bare-commit recipe at t/3851#9 (a plain update-index --chmod=+x followed by a pathspec commit silently commits 100644 when core.fileMode=false), then verify with: git ls-tree HEAD -- .githooks/<hook>'
    }

    # COMMITTED_NOT_PUSHED (TL p/331#1813): local HEAD is the operator's record, but a FRESH
    # Linux/macOS clone gets the mode on origin/<default>. A local 100755 commit not yet pushed would
    # otherwise read WIRED here while every new clone still gets 100644 / no hook. Compared against
    # the LAST-FETCHED remote ref — verify:config deliberately does no network fetch.
    $push = Get-HookPushGaps -Hooks $Hooks
    $remoteRef = $push.RemoteRef; $unpushed = $push.Gaps
    if ($unpushed.Count -gt 0) {
        return & $mk 'COMMITTED_NOT_PUSHED' 'WARN' ("wired locally, but fresh clones won't get it: " + ($unpushed -join '; ') + ' (as of last fetch)') "Push the commit that sets the mode, then verify with: git ls-tree $remoteRef -- .githooks/<hook>"
    }
    $originNote = if ($remoteRef) { "; matches $remoteRef as of last fetch" } else { '; clone-facing mode NOT checked (no origin remote ref)' }
    return & $mk 'WIRED' 'PASS' ("core.hooksPath = .githooks; expected hooks present and executable as committed" + $originNote) ''
}

function Get-GitTreeMode {
    # First field of an ls-tree / ls-files -s line (the mode), or $null when git printed nothing.
    param($Line)
    if ($Line) { return (([string]$Line) -split '\s+')[0] }
    return $null
}

function Get-OriginDefaultRef {
    <#
    I/O. Clone-facing ref: origin's default branch, as of the last fetch (no network).
    NOT `rev-parse --abbrev-ref origin/HEAD`: when origin/HEAD is unset (e.g. a clone of an
    initially-empty repo) it ECHOES the literal 'origin/HEAD' and exits non-zero, which resolved
    to a nonexistent ref → "absent on origin" → a false COMMITTED_NOT_PUSHED that never cleared
    even after the push (caught live).
    #>
    param([Parameter(Mandatory)][string]$RepoPath)
    $sym = & git -C $RepoPath symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $sym) { return ([string]$sym).Trim() }
    $null = & git -C $RepoPath rev-parse --verify --quiet refs/remotes/origin/main 2>$null
    if ($LASTEXITCODE -eq 0) { return 'origin/main' }
    return $null
}

function Get-HookModeFacts {
    # I/O. COMMITTED mode decides (what every clone receives); index mode is diagnostic.
    param([Parameter(Mandatory)][string]$RepoPath, [Parameter(Mandatory)][string]$Name, [AllowNull()][string]$RemoteRef)
    $rel = ".githooks/$Name"
    $present = Test-Path -LiteralPath (Join-Path $RepoPath $rel) -PathType Leaf
    $cmode = Get-GitTreeMode (& git -C $RepoPath ls-tree HEAD -- $rel 2>$null)
    $imode = Get-GitTreeMode (& git -C $RepoPath ls-files -s -- $rel 2>$null)
    $rref = if ($RemoteRef) { $RemoteRef } else { $null }
    $rmode = if ($rref) { Get-GitTreeMode (& git -C $RepoPath ls-tree $rref -- $rel 2>$null) } else { $null }
    return @{ Present = $present; CommittedMode = $cmode; IndexMode = $imode; RemoteRef = $rref; RemoteMode = $rmode }
}

function Get-DataRepoHooksFacts {
    <#
    .SYNOPSIS
        I/O. Gather the facts for Get-DataRepoHooksVerdict from the live checkout. Used by
        scripts/Verify-Config.ps1 only — NOT from tests/ (a fresh CI data checkout never has
        hooksPath, so a live assertion there would be permanently red, t/3869#2).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$CodeRepoRoot,
        [string[]]$ExpectedHooks = @('pre-commit')   # add 'commit-msg' once t/3851 commits it
    )
    $cfgPath = Join-Path $CodeRepoRoot '.aitriad.json'
    $cfgText = if (Test-Path -LiteralPath $cfgPath) { Get-Content -Raw -LiteralPath $cfgPath } else { $null }
    # Call the runtime's OWN anchor resolver (PR #2732) rather than reimplementing it — the same
    # file Get-DataRoot uses, dot-sourced standalone (zero module-scope deps), so Verify-Config.ps1
    # still never imports the AITriad module.
    $mainRoot = $null
    $wmr = Join-Path $CodeRepoRoot 'scripts/AITriad/Public/Get-WorktreeMainRoot.ps1'
    if (Test-Path -LiteralPath $wmr) {
        . $wmr
        $mainRoot = Get-WorktreeMainRoot -Path $CodeRepoRoot
    }
    $res = Resolve-DataRepoRoot -EnvValue $env:AI_TRIAD_DATA_ROOT -ConfigText $cfgText -ConfigDir $CodeRepoRoot -AnchorRoot $mainRoot

    $exists = $false; $isRepo = $false; $hp = $null; $hooks = @{}
    if (-not $res.Undetermined) {
        $exists = Test-Path -LiteralPath $res.Path -PathType Container
        if ($exists) {
            $null = & git -C $res.Path rev-parse --git-dir 2>$null
            $isRepo = ($LASTEXITCODE -eq 0)
            if ($isRepo) {
                $raw = & git -C $res.Path config --get core.hooksPath 2>$null
                $hp = if ($LASTEXITCODE -eq 0 -and $raw) { ([string]$raw).Trim() } else { $null }
                $rref = Get-OriginDefaultRef -RepoPath $res.Path
                foreach ($name in $ExpectedHooks) {
                    $hooks[$name] = Get-HookModeFacts -RepoPath $res.Path -Name $name -RemoteRef $rref
                }
            }
        }
    }
    return [PSCustomObject]@{ Resolution = $res; PathExists = $exists; IsGitRepo = $isRepo; HooksPath = $hp; Hooks = $hooks }
}

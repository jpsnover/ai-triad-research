# Generates a unique doc-id by appending year + optional numeric suffix.

function Resolve-DocId {
    param(
        [string]$BaseSlug,
        [string]$Year = (Get-Date -Format 'yyyy')
    )

    $SourcesDir = Join-Path $script:RepoRoot 'sources'
    $Candidate  = "$BaseSlug-$Year"
    $Counter    = 1
    while (Test-Path (Join-Path $SourcesDir $Candidate)) {
        $Candidate = "$BaseSlug-$Year-$Counter"
        $Counter++
    }
    return $Candidate
}

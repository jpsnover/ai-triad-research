param([Parameter(Mandatory)][string]$Root)

$exts = @('.json','.md','.yml','.yaml','.txt','.csv')
$fixed = 0; $scanned = 0
$sep = [System.IO.Path]::DirectorySeparatorChar
$gitDir = "${sep}.git${sep}"

Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
    $exts -contains $_.Extension.ToLower() -and $_.FullName -notlike "*$gitDir*"
} | ForEach-Object {
    $scanned++
    $fs = [System.IO.File]::OpenRead($_.FullName)
    $buf = New-Object byte[] 3
    $n = $fs.Read($buf, 0, 3)
    $fs.Close()
    if ($n -eq 3 -and $buf[0] -eq 0xEF -and $buf[1] -eq 0xBB -and $buf[2] -eq 0xBF) {
        $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
        [System.IO.File]::WriteAllBytes($_.FullName, $bytes[3..($bytes.Length-1)])
        Write-Host "BOM stripped: $($_.FullName)"
        $fixed++
    }
}
Write-Host "--- scanned $scanned files, stripped BOM from $fixed ---"

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$scanRoots = @(
    (Join-Path $repoRoot "backend/src/agon"),
    (Join-Path $repoRoot "frontend/src/lib/agon"),
    (Join-Path $repoRoot "frontend/src/app/market"),
    (Join-Path $repoRoot "frontend/src/components/agon")
)
$legacyNames = "(?<!Agon)(?:AgentRegistry|ChallengeArena|ContestEngine|PrizeEscrow|SyndicateFactory|PointsLedger)"
$violations = @()

foreach ($scanRoot in $scanRoots) {
    if (-not (Test-Path -LiteralPath $scanRoot)) { continue }
    $violations += Get-ChildItem -LiteralPath $scanRoot -Recurse -File |
        Select-String -Pattern "(?:from|import).*($legacyNames)" |
        ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
}

if ($violations.Count -gt 0) {
    Write-Error ("Agon boundary violations detected:`n" + ($violations -join "`n"))
    exit 1
}

Write-Output "Agon boundary check passed: no direct legacy contract imports in active Agon surfaces."

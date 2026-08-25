$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()

function Require-Match {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Description
    )

    if (-not (Select-String -LiteralPath (Join-Path $repoRoot $Path) -Pattern $Pattern -Quiet)) {
        $failures.Add($Description)
    }
}

Require-Match "backend/Dockerfile" "FROM node:22-slim" "backend image must use Node 22"
Require-Match "frontend/Dockerfile" "FROM node:22-slim" "frontend image must use Node 22"
Require-Match "backend/docker-compose.local.yml" '3003:3000' "local frontend must be exposed on host port 3003"
Require-Match "backend/docker-compose.local.yml" '8082/health' "local auth healthcheck must be configured"
Require-Match "deploy/docker-compose.yml" '8082/health' "production auth healthcheck must be configured"

$productionCompose = Get-Content -LiteralPath (Join-Path $repoRoot "deploy/docker-compose.yml") -Raw
$authService = [regex]::Match($productionCompose, '(?ms)^  auth:\s*$.*?(?=^  \S|\z)').Value
$indexerService = [regex]::Match($productionCompose, '(?ms)^  indexer:\s*$.*?(?=^  \S|\z)').Value
if ($authService -notmatch '8082/health') {
    $failures.Add("production auth service must own the /health healthcheck")
}
if ($indexerService -match '8082/health') {
    $failures.Add("production indexer must not own the auth /health healthcheck")
}

$defaultOffFlags = @(
    "AGON_WRITES_ENABLED=false",
    "AGON_X402_EXECUTION_ENABLED=false",
    "AGON_X402_VERIFICATION_ENABLED=false",
    "AGON_X402_RECONCILIATION_ENABLED=false",
    "AGON_ARENA_VALIDATION_ENABLED=false",
    "AGON_ESCROW_ENABLED=false",
    "AGON_ESCROW_EXECUTION_ENABLED=false",
    "AGON_ESCROW_RECONCILIATION_ENABLED=false",
    "AGON_SYNDICATE_PRIZE_POOL_ENABLED=false",
    "CIRCLE_USER_CONTROLLED_ENABLED=false"
)

foreach ($envFile in @("backend/.env.example", "deploy/.env.example")) {
    foreach ($flag in $defaultOffFlags) {
        Require-Match $envFile ([regex]::Escape($flag)) "$envFile must keep $flag"
    }
}

if ($failures.Count -gt 0) {
    Write-Error ("Agon release-default check failed:`n" + ($failures -join "`n"))
    exit 1
}

Write-Output "Agon release-default check passed: Node 22, local port 3003, health checks, and execution kill switches are aligned."

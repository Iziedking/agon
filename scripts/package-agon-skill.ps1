param(
  [string]$OutputPath = "frontend/public/downloads/agon-asp.zip"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$source = Join-Path $repoRoot ".agents/skills/agon-asp"
$output = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "agon-asp-package"

if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
  throw "AGON skill source is missing: $source"
}

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $stage "agon-asp") -Force | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination (Join-Path $stage "agon-asp") -Recurse -Force
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}
Compress-Archive -LiteralPath (Join-Path $stage "agon-asp") -DestinationPath $output -CompressionLevel Optimal
if (-not (Test-Path -LiteralPath $output)) {
  throw "Skill archive was not created: $output"
}
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output "Created $output"

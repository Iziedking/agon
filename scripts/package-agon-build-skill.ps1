param(
  [string]$OutputPath = "frontend/public/downloads/agon-build.zip"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$source = Join-Path $repoRoot ".agents/skills/agon-build"
$output = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "agon-build-skill-package"
$stageSkill = Join-Path $stage "agon-build"

if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
  throw "AGON build skill source is missing: $source"
}

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stageSkill -Force | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $stageSkill -Recurse -Force
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}
Compress-Archive -LiteralPath $stageSkill -DestinationPath $output -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force

if (-not (Test-Path -LiteralPath $output)) {
  throw "Skill archive was not created: $output"
}
Write-Output "Created $output"

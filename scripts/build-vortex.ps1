[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$SkipSidecarBuild,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$arguments = @((Join-Path $repositoryRoot 'scripts\build-vortex.mjs'))
if ($Install) { $arguments += '--install' }
if ($SkipSidecarBuild) { $arguments += '--skip-sidecar-build' }
if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $arguments += '--output'
    $arguments += $OutputDirectory
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "The VORTEX build script failed with exit code $LASTEXITCODE."
}

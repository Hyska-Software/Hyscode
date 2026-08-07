[CmdletBinding()]
param(
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repositoryRoot
try {
    $buildScript = if ($Release) { 'build:release' } else { 'build' }
    npm run -w @hyscode/tui-client $buildScript

    $artifactDirectory = Join-Path $repositoryRoot 'tools/hyscode-tui/dist'
    New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    $launcher = Join-Path $artifactDirectory 'vortex.exe'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        throw "TUI launcher was not produced at $launcher"
    }

    $codexSidecar = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'apps/desktop/src-tauri/binaries') -Filter 'codex-sidecar*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($codexSidecar) {
        Copy-Item -Force $codexSidecar.FullName (Join-Path $artifactDirectory 'codex-sidecar.exe')
    }

    Write-Host "TUI artifacts written to $artifactDirectory"
} finally {
    Pop-Location
}

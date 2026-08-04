[CmdletBinding()]
param(
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$cargoProfile = if ($Release) { 'release' } else { 'debug' }
$cargoArguments = @('--manifest-path', 'tools/hyscode-tui/Cargo.toml')
if ($Release) { $cargoArguments += '--release' }

Push-Location $repositoryRoot
try {
    npm run -w @hyscode/tui-runtime build
    cargo build @cargoArguments

    $artifactDirectory = Join-Path $repositoryRoot 'tools/hyscode-tui/dist'
    New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    Copy-Item -Force (Join-Path $repositoryRoot "tools/hyscode-tui/target/$cargoProfile/hyscode-tui.exe") (Join-Path $artifactDirectory 'hyscode-tui.exe')
    Copy-Item -Force (Join-Path $repositoryRoot 'packages/tui-runtime/dist/hyscode-tui-bridge.exe') (Join-Path $artifactDirectory 'hyscode-tui-bridge.exe')

    $codexSidecar = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'apps/desktop/src-tauri/binaries') -Filter 'codex-sidecar*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($codexSidecar) {
        Copy-Item -Force $codexSidecar.FullName (Join-Path $artifactDirectory 'codex-sidecar.exe')
    }

    Write-Host "TUI artifacts written to $artifactDirectory"
} finally {
    Pop-Location
}

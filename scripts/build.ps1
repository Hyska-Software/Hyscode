#!/usr/bin/env pwsh
# ============================================================================
# HysCode — Unified Build Script (Windows / PowerShell)
# Detects platform and delegates to the appropriate build script.
# On Windows, delegates to build-windows.ps1.
# On Linux/macOS via WSL, delegates to the corresponding .sh script.
# ============================================================================

param(
    # Flags forwarded to build-windows.ps1
    [switch]$SkipInnoSetup,
    [switch]$NsisOnly,
    [switch]$InnoOnly,
    [switch]$Debug,
    [string]$Target = "x86_64-pc-windows-msvc",

    # Cross-platform via WSL
    [switch]$Linux,
    [switch]$macOS
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SCRIPT_DIR = $PSScriptRoot

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        HysCode Production Build          ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Detect platform ──────────────────────────────────────────────────────────
if ($Linux) {
    Write-Host "Target: Linux (via WSL)" -ForegroundColor Yellow
    Write-Host ""
    if (-not (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
        Write-Error "WSL is not installed or not available. Install from: https://aka.ms/wsl"
    }
    wsl bash "$($SCRIPT_DIR -replace '\\','/')/build-linux.sh"
    exit $LASTEXITCODE
}

if ($macOS) {
    Write-Host "Target: macOS (via WSL)" -ForegroundColor Yellow
    Write-Host ""
    if (-not (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
        Write-Error "WSL is not installed or not available. Install from: https://aka.ms/wsl"
    }
    wsl bash "$($SCRIPT_DIR -replace '\\','/')/build-macos.sh"
    exit $LASTEXITCODE
}

# ── Default: Windows ─────────────────────────────────────────────────────────
Write-Host "Detected: Windows" -ForegroundColor Green
Write-Host ""

$buildScript = Join-Path $SCRIPT_DIR "build-windows.ps1"

$forwardArgs = @{
    Target = $Target
}
if ($SkipInnoSetup) { $forwardArgs["SkipInnoSetup"] = $true }
if ($NsisOnly)      { $forwardArgs["NsisOnly"]      = $true }
if ($InnoOnly)      { $forwardArgs["InnoOnly"]       = $true }
if ($Debug)         { $forwardArgs["Debug"]          = $true }

& $buildScript @forwardArgs
exit $LASTEXITCODE

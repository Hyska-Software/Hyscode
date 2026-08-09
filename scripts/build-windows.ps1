#!/usr/bin/env pwsh
# ============================================================================
# HysCode Production Build Script — Windows
# Generates: NSIS installer (.exe) + Inno Setup installer + MSI
# ============================================================================

param(
    [switch]$SkipInnoSetup,
    [switch]$NsisOnly,
    [switch]$InnoOnly,
    [switch]$Debug,
    [string]$Target = "x86_64-pc-windows-msvc"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $PSScriptRoot
$DESKTOP = Join-Path $ROOT "apps" "desktop"
$TAURI_DIR = Join-Path $DESKTOP "src-tauri"
$RELEASE_DIR = Join-Path $TAURI_DIR "target" "release"
$BUNDLE_DIR = Join-Path $RELEASE_DIR "bundle"
$TARGET_BUNDLE_DIR = Join-Path $TAURI_DIR "target" $Target "release" "bundle"
$desktopPackage = Get-Content -LiteralPath (Join-Path $DESKTOP "package.json") -Raw | ConvertFrom-Json
$VERSION = [string]$desktopPackage.version

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  HysCode Production Build — Windows"       -ForegroundColor Cyan
Write-Host "  Version: $VERSION"                         -ForegroundColor Cyan
Write-Host "  Target:  $Target"                          -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check prerequisites ─────────────────────────────────────────────
function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Test-Command "rustc")) {
    Write-Error "Rust is not installed. Install from https://rustup.rs"
}
Write-Host "  ✓ Rust $(rustc --version)" -ForegroundColor Green

if (-not (Test-Command "pnpm")) {
    Write-Error "pnpm is not installed. Install with: npm install -g pnpm"
}
Write-Host "  ✓ pnpm $(pnpm --version)" -ForegroundColor Green

if (-not (Test-Command "bun")) {
    Write-Host "  ⚠ bun not found in PATH. Sidecar binaries (claude-agent, codex) will NOT be built." -ForegroundColor Yellow
    Write-Host "    Install from https://bun.sh/docs/installation and re-run." -ForegroundColor Yellow
} else {
    Write-Host "  ✓ bun $(bun --version)" -ForegroundColor Green
}

if (-not (Test-Command "cargo")) {
    Write-Error "Cargo not found."
}
Write-Host "  ✓ Cargo $(cargo --version)" -ForegroundColor Green

$tauriCli = pnpm tauri --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ⚠ Installing @tauri-apps/cli..." -ForegroundColor Yellow
    pnpm add -Dw @tauri-apps/cli
}
Write-Host "  ✓ Tauri CLI ready" -ForegroundColor Green

# ── Step 2: Install dependencies ─────────────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Installing dependencies..." -ForegroundColor Yellow
Push-Location $ROOT
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    pnpm install
}
Pop-Location
Write-Host "  ✓ Dependencies installed" -ForegroundColor Green

# ── Step 3: Build frontend ───────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/5] Building frontend..." -ForegroundColor Yellow
Push-Location $ROOT
pnpm build
Pop-Location
Write-Host "  ✓ Frontend built" -ForegroundColor Green

# ── Step 3.5: Copy sidecar binaries next to the app exe ─────────────────────
Write-Host ""
Write-Host "  Copying sidecar binaries..." -ForegroundColor Yellow
node scripts/copy-sidecars.mjs `
  --target (Join-Path $TAURI_DIR "target" $Target "release") `
  --target (Join-Path $TAURI_DIR "target" "release")

# ── Step 4: Build Tauri (NSIS + MSI) ────────────────────────────────────────
if (-not $InnoOnly) {
    Write-Host ""
    Write-Host "[4/5] Building Tauri bundles (NSIS + MSI)..." -ForegroundColor Yellow
    Push-Location $DESKTOP

    $env:TAURI_SIGNING_PRIVATE_KEY = ""
    
    if ($Debug) {
        pnpm tauri build --target $Target -- --verbose
    } else {
        pnpm tauri build --target $Target
    }
    
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Error "Tauri build failed!"
    }
    Pop-Location
    Write-Host "  ✓ Tauri build complete" -ForegroundColor Green

    # Show NSIS/MSI outputs
    Write-Host ""
    Write-Host "  Bundle outputs:" -ForegroundColor Cyan
    $nsisDir = Join-Path $BUNDLE_DIR "nsis"
    $msiDir = Join-Path $BUNDLE_DIR "msi"
    
    if (Test-Path $nsisDir) {
        Get-ChildItem $nsisDir -Filter "*.exe" | ForEach-Object {
            Write-Host "    NSIS: $($_.FullName)" -ForegroundColor Green
        }
    }
    if (Test-Path $msiDir) {
        Get-ChildItem $msiDir -Filter "*.msi" | ForEach-Object {
            Write-Host "    MSI:  $($_.FullName)" -ForegroundColor Green
        }
    }
}

# ── Step 5: Build Inno Setup installer ───────────────────────────────────────
if (-not $SkipInnoSetup -and -not $NsisOnly) {
    Write-Host ""
    Write-Host "[5/5] Building Inno Setup installer..." -ForegroundColor Yellow

    $issFile = Join-Path $TAURI_DIR "installer" "windows" "hyscode.iss"
    
    if (-not (Test-Path $issFile)) {
        Write-Error "Inno Setup script not found at: $issFile"
    }

    # Find Inno Setup compiler
    $iscc = $null
    $innoSearchPaths = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    
    foreach ($path in $innoSearchPaths) {
        if (Test-Path $path) {
            $iscc = $path
            break
        }
    }

    if (-not $iscc) {
        Write-Host "  ⚠ Inno Setup 6 not found. Skipping Inno Setup build." -ForegroundColor Yellow
        Write-Host "    Download from: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
        Write-Host "    After installing, re-run with: .\build-windows.ps1 -InnoOnly" -ForegroundColor Yellow
    } else {
        Write-Host "  Using ISCC: $iscc" -ForegroundColor Gray

        $innoOutDir = Join-Path $TARGET_BUNDLE_DIR "inno"
        if (-not (Test-Path $innoOutDir)) {
            New-Item -ItemType Directory -Path $innoOutDir -Force | Out-Null
        }

        & $iscc "/DMyAppVersion=$VERSION" $issFile
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Inno Setup build failed!"
        }
        
        Write-Host "  ✓ Inno Setup installer built" -ForegroundColor Green
        Get-ChildItem $innoOutDir -Filter "*.exe" | ForEach-Object {
            Write-Host "    Inno: $($_.FullName)" -ForegroundColor Green
        }
    }
} else {
    Write-Host ""
    Write-Host "[5/5] Skipping Inno Setup (flag set)" -ForegroundColor Gray
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output directory: $TARGET_BUNDLE_DIR" -ForegroundColor Cyan
Write-Host ""

$dirsToScan = @($BUNDLE_DIR, $TARGET_BUNDLE_DIR) | Sort-Object -Unique
$allFiles = foreach ($dir in $dirsToScan) {
    if (Test-Path $dir) {
        Get-ChildItem $dir -Recurse -File | Where-Object { $_.Extension -in @(".exe", ".msi") }
    }
}
$allFiles = $allFiles | Sort-Object FullName -Unique
if ($allFiles) {
    Write-Host "Generated files:" -ForegroundColor Yellow
    $allFiles | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name) ($size MB)" -ForegroundColor White
    }
}
Write-Host ""

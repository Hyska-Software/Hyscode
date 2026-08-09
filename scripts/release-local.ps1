#requires -Version 7.0

<#
.SYNOPSIS
    Builds HysCode release artifacts locally on Windows (x64).

.DESCRIPTION
    Mirrors the Windows job of .github/workflows/release.yml but keeps every
    artifact on disk instead of uploading it to a GitHub release:
      - HysCode-Setup-<version>-x64.exe        Inno Setup desktop installer
      - Vortex-CLI-Setup-<version>-x64.exe     Inno Setup standalone VORTEX CLI
      - vortex-cli-<version>-windows-x64.zip   Standalone VORTEX CLI archive

    No commit, tag, push, or GitHub release is created. When the resolved
    version differs from the tree, the version files are bumped exactly like
    the CI does (tauri.conf.json, Cargo.toml, apps/desktop/package.json and —
    when -Version is explicit — the root package.json), but nothing is
    committed.

.PARAMETER Version
    Version to ship (e.g. "1.2.3" or "0.9.0-beta.1"). Defaults to the root
    package.json version with the next "-build.<n>" number appended,
    mirroring the CI push trigger.

.PARAMETER NoBump
    Never write the version into source files. The binaries will report
    whatever version the tree currently has.

.PARAMETER SkipSidecarBuild
    Skip the explicit AI sidecar build step and reuse existing binaries.

.PARAMETER SkipDeps
    (Linux mode) Skip the npm ci step inside WSL and reuse the existing
    node_modules. Useful for iterative builds — run 'npm ci' once after a
    fresh checkout.

.PARAMETER Linux
    Build the Linux (x64) release artifacts inside WSL instead of the Windows
    ones. Requires a WSL2 distro with Rust, Node, npm, and Bun installed;
    system packages are installed via apt when missing. Assumes the standard
    /mnt/<drive> automount for the repository and output paths. For
    non-interactive sudo (missing apt packages), set the environment variable
    HYCODE_WSL_SUDO_PASSWORD; it is forwarded to WSL via WSLENV and never
    written to disk.

.PARAMETER OutputDirectory
    Directory that receives the produced installers and archives. Defaults to
    <repo>\dist\release\<version>.

.PARAMETER GenerateManifest
    Also generate the VORTEX update manifest from the output directory. This
    requires all six platform/architecture targets to be present, so on a
    Windows-only machine it only succeeds when artifacts from the other
    platforms were staged into the output directory as well.

.PARAMETER Force
    Skip the confirmation prompt when a version bump would modify files.

.EXAMPLE
    .\scripts\release-local.ps1
    .\scripts\release-local.ps1 -Version 0.9.0
    .\scripts\release-local.ps1 -Version 0.9.0-beta.1 -NoBump
    .\scripts\release-local.ps1 -Linux
#>

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$NoBump,
    [switch]$SkipSidecarBuild,
    [switch]$SkipDeps,
    [switch]$Linux,
    [string]$OutputDirectory,
    [switch]$GenerateManifest,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Desktop    = Join-Path $RepoRoot 'apps\desktop'
$TauriDir   = Join-Path $Desktop 'src-tauri'
$TargetTriple = 'x86_64-pc-windows-msvc'
$ReleaseBin = Join-Path $TauriDir "target\$TargetTriple\release"
$InnoOutDir = Join-Path $ReleaseBin 'bundle\inno'
$RootPkg    = Join-Path $RepoRoot 'package.json'
$DesktopPkg = Join-Path $Desktop 'package.json'
$TauriConf  = Join-Path $TauriDir 'tauri.conf.json'
$CargoToml  = Join-Path $TauriDir 'Cargo.toml'
$IssScript  = Join-Path $TauriDir 'installer\windows\hyscode.iss'
$VortexIssScript = Join-Path $RepoRoot 'scripts\installer\vortex-cli.iss'

if ($env:OS -ne 'Windows_NT') {
    throw 'release-local.ps1 is the Windows driver (Windows or WSL delegation). For a native Linux build, run scripts/release-local-linux.sh directly.'
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Write-Step([int]$Index, [int]$Total, [string]$Title) {
    Write-Host ''
    Write-Host "[$Index/$Total] $Title" -ForegroundColor Yellow
}

function ConvertTo-WslPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -match '^([A-Za-z]):\\(.*)$') {
        return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + ($Matches[2] -replace '\\', '/')
    }
    return $full -replace '\\', '/'
}

function Invoke-ManifestGeneration {
    Write-Host ''
    Write-Host '  Generating VORTEX update manifest from the output directory...' -ForegroundColor Yellow
    $manifestPath = Join-Path $OutputDirectory "vortex-cli-manifest-$Version.json"
    node (Join-Path $RepoRoot 'scripts\generate-vortex-update-manifest.mjs') `
      --asset-dir $OutputDirectory `
      --version $Version `
      --output $manifestPath
    if ($LASTEXITCODE -ne 0) {
        throw 'VORTEX update manifest generation failed — all six platform targets are required.'
    }
}

# ── Resolve version ─────────────────────────────────────────────────────────
$rootVersion = (Get-Content -Raw $RootPkg | ConvertFrom-Json).version
$explicitVersion = $PSBoundParameters.ContainsKey('Version')

if (-not $explicitVersion) {
    # Push-trigger semantics: root package.json base + next build number.
    $current = (Get-Content -Raw $TauriConf | ConvertFrom-Json).version
    $buildMatch = [regex]::Match($current, '-build\.(\d+)$')
    $build = if ($buildMatch.Success) { [int]$buildMatch.Groups[1].Value + 1 } else { 1 }
    $Version = "$rootVersion-build.$build"
    Write-Host "  No -Version given — shipping $Version (root base $rootVersion, next build number)" -ForegroundColor Gray
}

$Version = $Version.TrimStart('v')
if ($Version -notmatch '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<pre>[0-9A-Za-z.\-]+))?$') {
    throw "Invalid semver version: '$Version'"
}
$IsPrerelease = $Version -match '^[0-9]+\.[0-9]+\.[0-9]+-'

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $RepoRoot "dist\release\$Version"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
if ($Linux) {
    Write-Host '  HysCode — Local release build (Linux x64 via WSL)' -ForegroundColor Cyan
} else {
    Write-Host '  HysCode — Local release build (Windows x64)'       -ForegroundColor Cyan
}
Write-Host "  Version : $Version"                            -ForegroundColor Cyan
Write-Host ("  Channel : " + $(if ($IsPrerelease) { 'pre-release' } else { 'stable' })) -ForegroundColor Cyan
Write-Host "  Output  : $OutputDirectory"                    -ForegroundColor Cyan
Write-Host '  GitHub  : no interaction (local artifacts)'    -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''

# ── Step 1: Resolve and apply version ───────────────────────────────────────
Write-Step 1 9 'Resolve and apply version'

$currentTauri = (Get-Content -Raw $TauriConf | ConvertFrom-Json).version

if ($NoBump) {
    if ($currentTauri -ne $Version) {
        Write-Host "  ⚠ -NoBump: tree reports $currentTauri — the binaries will report that version, not $Version" -ForegroundColor Yellow
    } else {
        Write-Host "  ✓ Version files already at $Version" -ForegroundColor Green
    }
} elseif ($currentTauri -eq $Version) {
    Write-Host "  ✓ Version files already at $Version" -ForegroundColor Green
} else {
    Write-Host "  Version files are at $currentTauri — will bump to $Version (CI behavior, not committed)" -ForegroundColor Yellow
    if (-not $Force) {
        $answer = Read-Host '  Proceed? [y/N]'
        if ($answer -notin @('y', 'Y', 'yes', 'Yes', 'YES')) {
            Write-Host '  Aborted.' -ForegroundColor Yellow
            return
        }
    }

    $bumpTargets = @($RootPkg, $DesktopPkg, $TauriConf, $CargoToml)
    if (-not $explicitVersion) {
        # Push trigger: the root package.json stays as the clean base version.
        $bumpTargets = @($DesktopPkg, $TauriConf, $CargoToml)
    }
    foreach ($target in $bumpTargets) {
        $normalized = $target -replace '\\', '/'
        if ($normalized -like '*/Cargo.toml') {
            $text = [IO.File]::ReadAllText($target)
            $regex = [regex]'(?ms)(^\[package\][^\[]*?^version\s*=\s*)"[^"]*"'
            if (-not $regex.IsMatch($text)) {
                throw "Failed to update 'version' in $target — no [package] block found."
            }
            [IO.File]::WriteAllText($target, $regex.Replace($text, ('$1"' + $Version + '"'), 1))
        } else {
            $json = Get-Content -Raw $target | ConvertFrom-Json
            $json.version = $Version
            $out = (($json | ConvertTo-Json -Depth 100) -replace "`r?`n", "`n") + "`n"
            [IO.File]::WriteAllText($target, $out)
        }
    }
    Write-Host "  ✓ Bumped version files to $Version (working tree modified — not committed)" -ForegroundColor Green
    if ($explicitVersion) {
        Write-Host '    root package.json updated too (workflow_dispatch semantics)' -ForegroundColor Gray
    }
}

# ── Linux (via WSL) ─────────────────────────────────────────────────────────
if ($Linux) {
    if (-not (Test-Command 'wsl')) {
        throw 'WSL is not installed or not available. Install from: https://aka.ms/wsl'
    }
    $wslCheck = wsl bash -lc 'uname -s' 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "WSL did not respond ($wslCheck). Install a Linux distribution first: wsl --install -d Ubuntu"
    }

    # Forward HYCODE_WSL_SUDO_PASSWORD into the WSL session (used by
    # release-local-linux.sh for non-interactive sudo) without ever storing
    # the value in a file.
    if ($env:HYCODE_WSL_SUDO_PASSWORD) {
        $wslEnvKey = 'HYCODE_WSL_SUDO_PASSWORD'
        if (-not (($env:WSLENV -split ';') -contains $wslEnvKey)) {
            $env:WSLENV = (@($env:WSLENV -split ';' | Where-Object { $_ }) + $wslEnvKey) -join ';'
        }
    }

    $wslScript = ConvertTo-WslPath (Join-Path $PSScriptRoot 'release-local-linux.sh')
    $wslOutput = ConvertTo-WslPath $OutputDirectory

    $shArgs = @('bash', $wslScript, '--version', $Version, '--output', $wslOutput)
    if ($SkipSidecarBuild) { $shArgs += '--skip-sidecar-build' }
    if ($SkipDeps) { $shArgs += '--skip-deps' }

    Write-Host ''
    Write-Host "  Delegating to WSL: $wslScript" -ForegroundColor Yellow
    wsl @shArgs
    if ($LASTEXITCODE -ne 0) {
        throw 'Linux release build failed inside WSL.'
    }

    if ($GenerateManifest) {
        Invoke-ManifestGeneration
    }

    Write-Host ''
    Write-Host '  Local release complete (Linux x64)' -ForegroundColor Green
    Write-Host "  Output  : $OutputDirectory" -ForegroundColor Cyan
    Write-Host '  Notes:' -ForegroundColor Yellow
    Write-Host '    • Nothing was committed, tagged, pushed, or uploaded.' -ForegroundColor Gray
    Write-Host '    • ARM64, Windows, and macOS assets are produced by CI only.' -ForegroundColor Gray
    Write-Host ''
    return
}

# ── Step 2: Check prerequisites ─────────────────────────────────────────────
Write-Step 2 9 'Check prerequisites'

foreach ($tool in @('node', 'npm', 'rustc', 'cargo')) {
    if (-not (Test-Command $tool)) {
        throw "Missing required tool: $tool"
    }
    Write-Host "  ✓ $tool" -ForegroundColor Green
}
if (Test-Command 'bun') {
    Write-Host "  ✓ bun $(bun --version)" -ForegroundColor Green
} else {
    Write-Host '  ⚠ bun not found — the VORTEX CLI steps will fail. Install from https://bun.sh/docs/installation' -ForegroundColor Yellow
}

$iscc = $null
$innoSearchPaths = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
foreach ($path in $innoSearchPaths) {
    if (Test-Path $path) { $iscc = $path; break }
}
if (-not $iscc) {
    if (Test-Command 'choco') {
        Write-Host '  ⚠ Inno Setup 6 not found — installing via Chocolatey...' -ForegroundColor Yellow
        choco install innosetup --no-progress -y
        if ($LASTEXITCODE -ne 0) { throw 'Chocolatey failed to install Inno Setup.' }
        foreach ($path in $innoSearchPaths) {
            if (Test-Path $path) { $iscc = $path; break }
        }
    }
    if (-not $iscc) {
        throw "Inno Setup 6 not found. Install it (https://jrsoftware.org/isdl.php) or via 'choco install innosetup'."
    }
}
Write-Host "  ✓ Inno Setup: $iscc" -ForegroundColor Green

# ── Step 3: Install dependencies ────────────────────────────────────────────
Write-Step 3 9 'Install dependencies'
Push-Location $RepoRoot
try {
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  ⚠ npm ci failed — falling back to npm install' -ForegroundColor Yellow
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    }
} finally {
    Pop-Location
}
Write-Host '  ✓ Dependencies installed' -ForegroundColor Green

# ── Step 4: Build AI sidecars ───────────────────────────────────────────────
if ($SkipSidecarBuild) {
    Write-Step 4 9 'Skip AI sidecar build (-SkipSidecarBuild)'
    Write-Host '  Reusing existing binaries in apps/desktop/src-tauri/binaries' -ForegroundColor Gray
} else {
    Write-Step 4 9 'Build AI sidecars'
    Push-Location $RepoRoot
    try {
        npm run build:sidecars
        if ($LASTEXITCODE -ne 0) { throw 'Sidecar build failed.' }
    } finally {
        Pop-Location
    }
    Write-Host '  ✓ Sidecars built' -ForegroundColor Green
}

# ── Step 5: Build Tauri (binary only) ───────────────────────────────────────
Write-Step 5 9 'Build Tauri (Windows x64 — binary only)'
Push-Location $Desktop
try {
    # --no-bundle: MSI rejects semver pre-release identifiers (same as CI).
    npm run tauri build -- --target $TargetTriple --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
} finally {
    Pop-Location
}
Write-Host "  ✓ Binary: $(Join-Path $ReleaseBin 'HysCode.exe')" -ForegroundColor Green

# ── Step 6: Copy sidecars next to release binary ────────────────────────────
Write-Step 6 9 'Copy sidecars next to release binary'
node (Join-Path $RepoRoot 'scripts\copy-sidecars.mjs') --target (Join-Path $TauriDir "target\$TargetTriple\release")
if ($LASTEXITCODE -ne 0) { throw 'Sidecar copy failed.' }
Write-Host '  ✓ Sidecars copied' -ForegroundColor Green

# ── Step 7: Build and stage VORTEX CLI bundle ───────────────────────────────
Write-Step 7 9 'Build and stage VORTEX CLI bundle'
Push-Location $RepoRoot
try {
    npm run build:vortex -- --skip-sidecar-build --version $Version
    if ($LASTEXITCODE -ne 0) { throw 'VORTEX CLI build failed.' }
} finally {
    Pop-Location
}
$cliBundle = (Resolve-Path (Join-Path $RepoRoot 'tools\hyscode-tui\dist\vortex-production')).Path
$cliVersion = & (Join-Path $cliBundle 'vortex.exe') --version
if ($LASTEXITCODE -ne 0 -or $cliVersion -notmatch [regex]::Escape("vortex $Version")) {
    throw "VORTEX version smoke test failed: $cliVersion"
}
Write-Host "  ✓ VORTEX smoke test: $cliVersion" -ForegroundColor Green

# Stage the bundle for the desktop installer wizard (hyscode.iss task).
$desktopCliDir = Join-Path $ReleaseBin 'vortex-cli'
if (Test-Path $desktopCliDir) { Remove-Item -LiteralPath $desktopCliDir -Recurse -Force }
New-Item -ItemType Directory -Path $desktopCliDir -Force | Out-Null
Copy-Item -Path (Join-Path $cliBundle '*') -Destination $desktopCliDir -Recurse -Force
Write-Host "  ✓ Staged VORTEX CLI for desktop installer: $desktopCliDir" -ForegroundColor Green

# Standalone archive (staging dir is consumed by the installers step).
$cliOutDir = Join-Path $OutputDirectory 'vortex-cli'
New-Item -ItemType Directory -Path $cliOutDir -Force | Out-Null
node (Join-Path $RepoRoot 'scripts\package-vortex-cli.mjs') `
  --bundle $cliBundle `
  --output-dir $cliOutDir `
  --version $Version `
  --platform win32 `
  --arch x64
if ($LASTEXITCODE -ne 0) { throw 'VORTEX CLI packaging failed.' }

# ── Step 8: Build Inno Setup installers ─────────────────────────────────────
Write-Step 8 9 'Build Inno Setup installers'

if (-not (Test-Path $InnoOutDir)) {
    New-Item -ItemType Directory -Path $InnoOutDir -Force | Out-Null
}
& $iscc "/DMyAppVersion=$Version" "/FHysCode-Setup-$Version-x64" "/O$InnoOutDir" $IssScript
if ($LASTEXITCODE -ne 0) { throw 'Desktop Inno Setup build failed.' }

& $iscc "/DMyAppVersion=$Version" "/FVortex-CLI-Setup-$Version-x64" "/O$cliOutDir" $VortexIssScript
if ($LASTEXITCODE -ne 0) { throw 'VORTEX Inno Setup build failed.' }

# ── Step 9: Stage release artifacts ─────────────────────────────────────────
Write-Step 9 9 'Stage release artifacts'

$innoInstaller = Join-Path $InnoOutDir "HysCode-Setup-$Version-x64.exe"
if (-not (Test-Path $innoInstaller)) {
    $innoInstaller = Get-ChildItem $InnoOutDir -Filter '*.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
$vortexInstaller = Join-Path $cliOutDir "Vortex-CLI-Setup-$Version-x64.exe"
if (-not (Test-Path $vortexInstaller)) {
    $vortexInstaller = Get-ChildItem $cliOutDir -Filter 'Vortex-CLI-Setup-*.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
$vortexArchive = Join-Path $cliOutDir "vortex-cli-$Version-windows-x64.zip"

foreach ($artifact in @($innoInstaller, $vortexInstaller, $vortexArchive)) {
    if (-not $artifact -or -not (Test-Path $artifact)) {
        throw "Expected artifact not found: $artifact"
    }
}
Copy-Item -LiteralPath $innoInstaller, $vortexInstaller, $vortexArchive -Destination $OutputDirectory
Remove-Item -LiteralPath $cliOutDir -Recurse -Force

if ($GenerateManifest) {
    Invoke-ManifestGeneration
}

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
Write-Host '  Local release complete'                         -ForegroundColor Green
Write-Host "  Version : $Version"                             -ForegroundColor Cyan
Write-Host "  Channel : $(if ($IsPrerelease) { 'pre-release' } else { 'stable' })" -ForegroundColor Cyan
Write-Host "  Output  : $OutputDirectory"                     -ForegroundColor Cyan
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  Generated files:' -ForegroundColor Yellow
Get-ChildItem $OutputDirectory -File | Sort-Object Name | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 2)
    Write-Host ("    {0,-55} {1} MB" -f $_.Name, $size) -ForegroundColor White
}
Write-Host ''
Write-Host '  Notes:' -ForegroundColor Yellow
Write-Host '    • Nothing was committed, tagged, pushed, or uploaded.' -ForegroundColor Gray
Write-Host '    • ARM64, Linux, and macOS assets are produced by CI only.' -ForegroundColor Gray
Write-Host '    • The VORTEX update manifest is generated in CI after all' -ForegroundColor Gray
Write-Host '      platforms upload (it requires all six platform targets).' -ForegroundColor Gray
Write-Host ''

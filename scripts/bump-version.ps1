#requires -Version 7.0

<#
.SYNOPSIS
    Bumps the HysCode application version across all source files.

.DESCRIPTION
    Updates the application version in the package and runtime metadata tracked
    by the release workflow, including both lockfiles:
      1. package.json and package-lock.json (root — used as build base)
      2. apps/desktop/package.json and its package-lock entry
      3. apps/desktop/src-tauri/tauri.conf.json
      4. apps/desktop/src-tauri/Cargo.toml and the hyscode package in Cargo.lock

    The next push to main will append "-build.<run_number>" to the
    desktop/runtime files via .github/workflows/release.yml while retaining
    the clean root package version as the build base.

    Run with no arguments for an interactive menu.

.PARAMETER Type
    Bump type: major, minor, or patch. Mutually exclusive with -Version.

.PARAMETER Version
    Explicit semver (e.g. "1.2.3" or "0.5.0-beta.1"). Mutually exclusive
    with -Type.

.PARAMETER DryRun
    Show the changes that would be made without writing any files.

.PARAMETER Force
    Skip the confirmation prompt.

.PARAMETER SkipRoot
    CI build mode. Keep the root package.json version and its package-lock
    metadata at the clean base version while updating the desktop/runtime files
    to the generated build version.

.EXAMPLE
    .\scripts\bump-version.ps1              # interactive menu
    .\scripts\bump-version.ps1 -Type minor  # CLI: bump minor
    .\scripts\bump-version.ps1 -Type patch -DryRun
    .\scripts\bump-version.ps1 -Version "1.0.0"
#>

[CmdletBinding()]
param(
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Type,

    [string]$Version,

    [switch]$DryRun,

    [switch]$Force,

    [switch]$SkipRoot
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# ─────────────────────────────────────────────────────────────────────────────
# File targets
# ─────────────────────────────────────────────────────────────────────────────
$RootPkg          = Join-Path $RepoRoot 'package.json'
$PackageLock      = Join-Path $RepoRoot 'package-lock.json'
$DesktopPkg       = Join-Path $RepoRoot 'apps/desktop/package.json'
$TauriConf        = Join-Path $RepoRoot 'apps/desktop/src-tauri/tauri.conf.json'
$CargoToml        = Join-Path $RepoRoot 'apps/desktop/src-tauri/Cargo.toml'
$CargoLock        = Join-Path $RepoRoot 'apps/desktop/src-tauri/Cargo.lock'

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
function Read-RootVersion {
    $pkg = [System.IO.File]::ReadAllText($RootPkg) | ConvertFrom-Json
    return $pkg.version
}

function Read-JsonVersion {
    param([Parameter(Mandatory)][string]$Path)

    $json = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if (-not $json.version) {
        throw "Could not find a top-level version in $Path."
    }
    return [string]$json.version
}

function Read-PackageLockVersions {
    $lock = [System.IO.File]::ReadAllText($PackageLock) | ConvertFrom-Json -AsHashtable
    $rootEntry = $lock.packages['']
    $desktopEntry = $lock.packages['apps/desktop']
    if (-not $rootEntry -or -not $desktopEntry) {
        throw "package-lock.json is missing the root or apps/desktop package entry."
    }
    return [pscustomobject]@{
        TopLevel = [string]$lock.version
        Root     = [string]$rootEntry.version
        Desktop  = [string]$desktopEntry.version
    }
}

function Read-CargoLockVersion {
    $text = [System.IO.File]::ReadAllText($CargoLock)
    $regex = [regex]'(?ms)^\[\[package\]\]\s*\r?\n(?:(?!^\[\[package\]\]).)*?^name\s*=\s*"hyscode"\s*$\r?\n^version\s*=\s*"(?<version>[^"]+)"'
    $match = $regex.Match($text)
    if (-not $match.Success) {
        throw "Could not find the hyscode package in $CargoLock."
    }
    return $match.Groups['version'].Value
}

function Read-CargoTomlVersion {
    $text = [System.IO.File]::ReadAllText($CargoToml)
    $regex = [regex]'(?ms)^\[package\].*?^version\s*=\s*"(?<version>[^"]+)"'
    $match = $regex.Match($text)
    if (-not $match.Success) {
        throw "Could not find the [package] version in $CargoToml."
    }
    return $match.Groups['version'].Value
}

function Replace-RequiredVersion {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][regex]$Regex,
        [Parameter(Mandatory)][string]$Replacement,
        [Parameter(Mandatory)][string]$Description
    )

    if (-not $Regex.IsMatch($Text)) {
        throw "Failed to update $Description."
    }
    return $Regex.Replace($Text, $Replacement, 1)
}

function Update-PackageLock {
    param([Parameter(Mandatory)][string]$TargetVersion)

    $text = [System.IO.File]::ReadAllText($PackageLock)

    if (-not $SkipRoot) {
        $text = Replace-RequiredVersion `
            -Text $text `
            -Regex ([regex]'(?m)^  "version"\s*:\s*"[^"]*"') `
            -Replacement ('  "version": "' + $TargetVersion + '"') `
            -Description 'the package-lock.json top-level version'

        $text = Replace-RequiredVersion `
            -Text $text `
            -Regex ([regex]'(?ms)(^    ""\s*:\s*\{\s*\r?\n(?:(?!^    "[^"\r\n]+"\s*:).)*?^      "version"\s*:\s*)"[^"]*"') `
            -Replacement ('$1"' + $TargetVersion + '"') `
            -Description 'the root package entry in package-lock.json'
    }

    $text = Replace-RequiredVersion `
        -Text $text `
        -Regex ([regex]'(?ms)(^    "apps/desktop"\s*:\s*\{\s*\r?\n(?:(?!^    "[^"\r\n]+"\s*:).)*?^      "version"\s*:\s*)"[^"]*"') `
        -Replacement ('$1"' + $TargetVersion + '"') `
        -Description 'the apps/desktop package entry in package-lock.json'

    [System.IO.File]::WriteAllText($PackageLock, $text)
}

function Update-CargoLock {
    param([Parameter(Mandatory)][string]$TargetVersion)

    $text = [System.IO.File]::ReadAllText($CargoLock)
    $regex = [regex]'(?ms)(^\[\[package\]\]\s*\r?\n(?:(?!^\[\[package\]\]).)*?^name\s*=\s*"hyscode"\s*$\r?\n^version\s*=\s*)"[^"]+"'
    $updated = Replace-RequiredVersion `
        -Text $text `
        -Regex $regex `
        -Replacement ('$1"' + $TargetVersion + '"') `
        -Description 'the hyscode package version in Cargo.lock'
    [System.IO.File]::WriteAllText($CargoLock, $updated)
}

function Assert-SynchronizedVersions {
    param(
        [Parameter(Mandatory)][string]$TargetVersion,
        [Parameter(Mandatory)][string]$ExpectedRootVersion
    )

    $actualRoot = Read-RootVersion
    $desktop = Read-JsonVersion -Path $DesktopPkg
    $tauri = Read-JsonVersion -Path $TauriConf
    $lock = Read-PackageLockVersions
    $cargoToml = Read-CargoTomlVersion
    $cargoLock = Read-CargoLockVersion

    $mismatches = @()
    if ($SkipRoot) {
        if ($actualRoot -ne $ExpectedRootVersion) { $mismatches += "package.json=$actualRoot (expected unchanged $ExpectedRootVersion)" }
        if ($lock.TopLevel -ne $ExpectedRootVersion) { $mismatches += "package-lock.json top-level=$($lock.TopLevel) (expected unchanged $ExpectedRootVersion)" }
        if ($lock.Root -ne $ExpectedRootVersion) { $mismatches += "package-lock.json root=$($lock.Root) (expected unchanged $ExpectedRootVersion)" }
    } else {
        if ($actualRoot -ne $TargetVersion) { $mismatches += "package.json=$actualRoot" }
        if ($lock.TopLevel -ne $TargetVersion) { $mismatches += "package-lock.json top-level=$($lock.TopLevel)" }
        if ($lock.Root -ne $TargetVersion) { $mismatches += "package-lock.json root=$($lock.Root)" }
    }
    if ($desktop -ne $TargetVersion) { $mismatches += "apps/desktop/package.json=$desktop" }
    if ($lock.Desktop -ne $TargetVersion) { $mismatches += "package-lock.json apps/desktop=$($lock.Desktop)" }
    if ($tauri -ne $TargetVersion) { $mismatches += "tauri.conf.json=$tauri" }
    if ($cargoToml -ne $TargetVersion) { $mismatches += "Cargo.toml=$cargoToml" }
    if ($cargoLock -ne $TargetVersion) { $mismatches += "Cargo.lock hyscode=$cargoLock" }

    if ($mismatches.Count -gt 0) {
        throw "Version metadata is not synchronized: $($mismatches -join '; ')"
    }
}

function Split-Semver {
    param([Parameter(Mandatory)][string]$Raw)

    $clean = $Raw.Trim()
    if ($clean -notmatch '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<pre>[0-9A-Za-z.\-]+))?$') {
        throw "Invalid semver: '$Raw'"
    }
    return [pscustomobject]@{
        Major = [int]$Matches.major
        Minor = [int]$Matches.minor
        Patch = [int]$Matches.patch
        Pre   = if ($Matches.pre) { $Matches.pre } else { '' }
        Raw   = $clean
    }
}

function Format-Semver {
    param([Parameter(Mandatory)] $Semver)
    $base = "$($Semver.Major).$($Semver.Minor).$($Semver.Patch)"
    if ($Semver.Pre) { $base += "-$($Semver.Pre)" }
    return $base
}

function Bump-Semver {
    param(
        [Parameter(Mandatory)] $Semver,
        [Parameter(Mandatory)][ValidateSet('major', 'minor', 'patch')][string]$Type
    )
    $next = [pscustomobject]@{
        Major = $Semver.Major
        Minor = $Semver.Minor
        Patch = $Semver.Patch
        Pre   = ''
    }
    switch ($Type) {
        'major' { $next.Major += 1; $next.Minor = 0; $next.Patch = 0 }
        'minor' { $next.Minor += 1; $next.Patch = 0 }
        'patch' { $next.Patch += 1 }
    }
    return $next
}

function Read-Choice {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][int[]]$Valid
    )
    while ($true) {
        $raw = (Read-Host $Prompt).Trim()
        if ($raw -match '^\d+$' -and ($raw -as [int]) -in $Valid) {
            return [int]$raw
        }
        Write-Host "  ✗ Invalid choice. Enter one of: $($Valid -join ', ')" -ForegroundColor Yellow
    }
}

function Read-ValidatedVersion {
    while ($true) {
        $raw = (Read-Host "  Enter version (e.g. 1.2.3 or 0.5.0-beta.1)").Trim()
        if ([string]::IsNullOrWhiteSpace($raw)) {
            Write-Host "  ✗ Empty input." -ForegroundColor Yellow
            continue
        }
        try {
            return (Split-Semver -Raw $raw) | ForEach-Object { Format-Semver -Semver $_ }
        } catch {
            Write-Host "  ✗ $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Read current state
# ─────────────────────────────────────────────────────────────────────────────
$currentRaw = Read-RootVersion
$current    = Split-Semver -Raw $currentRaw

if ($current.Pre) {
    Write-Warning "Root package.json currently has a pre-release identifier ('$($current.Pre)'). Numeric base will be used as the starting point."
}

# ─────────────────────────────────────────────────────────────────────────────
# Interactive menu (runs when no CLI args are provided)
# ─────────────────────────────────────────────────────────────────────────────
$useMenu = -not $Type -and -not $Version -and -not $DryRun -and -not $Force

if ($useMenu) {
    if ([Environment]::UserInteractive) {
        try { Clear-Host } catch { <# non-interactive host #> }
    }
    Write-Host ''
    Write-Host '  HysCode — version bump' -ForegroundColor Cyan
    Write-Host '  ─────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ("  Current base : {0}" -f $currentRaw)
    Write-Host '  ─────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ''

    Write-Host '   [1] Major bump  ' -NoNewline -ForegroundColor White
    Write-Host ('→ ' + (Format-Semver -Semver (Bump-Semver -Semver $current -Type major))) -ForegroundColor Yellow
    Write-Host '   [2] Minor bump  ' -NoNewline -ForegroundColor White
    Write-Host ('→ ' + (Format-Semver -Semver (Bump-Semver -Semver $current -Type minor))) -ForegroundColor Yellow
    Write-Host '   [3] Patch bump  ' -NoNewline -ForegroundColor White
    Write-Host ('→ ' + (Format-Semver -Semver (Bump-Semver -Semver $current -Type patch))) -ForegroundColor Yellow
    Write-Host '   [4] Custom version' -ForegroundColor White
    Write-Host '   [5] Preview all options (dry run)' -ForegroundColor White
    Write-Host '   [0] Cancel' -ForegroundColor DarkGray
    Write-Host ''

    $choice = Read-Choice -Prompt '  Select' -Valid @(0, 1, 2, 3, 4, 5)

    switch ($choice) {
        0 { Write-Host '  Aborted.' -ForegroundColor Yellow; return }
        1 { $Type = 'major' }
        2 { $Type = 'minor' }
        3 { $Type = 'patch' }
        4 { $Version = Read-ValidatedVersion }
        5 {
            Write-Host ''
            Write-Host '  ── Preview ─────────────────────────────────────────' -ForegroundColor DarkGray
            foreach ($t in 'major', 'minor', 'patch') {
                $next = Format-Semver -Semver (Bump-Semver -Semver $current -Type $t)
                Write-Host ("  {0,-6} {1}  →  {2}" -f $t, $currentRaw, $next) -ForegroundColor Gray
            }
            Write-Host '  ────────────────────────────────────────────────────' -ForegroundColor DarkGray
            Write-Host ''
            $postChoice = Read-Choice -Prompt '  Now pick a bump type (1-3), 4=custom, 0=cancel' -Valid @(0, 1, 2, 3, 4)
            switch ($postChoice) {
                0 { Write-Host '  Aborted.' -ForegroundColor Yellow; return }
                1 { $Type = 'major' }
                2 { $Type = 'minor' }
                3 { $Type = 'patch' }
                4 { $Version = Read-ValidatedVersion }
            }
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Final validation
# ─────────────────────────────────────────────────────────────────────────────
if (-not $Type -and -not $Version) {
    Write-Error "Specify either -Type (major|minor|patch) or -Version <semver>." -ErrorAction Stop
}
if ($Type -and $Version) {
    Write-Error "-Type and -Version are mutually exclusive." -ErrorAction Stop
}

# ─────────────────────────────────────────────────────────────────────────────
# Resolve target version
# ─────────────────────────────────────────────────────────────────────────────
if ($Version) {
    $target = Split-Semver -Raw $Version
} else {
    $target = Bump-Semver -Semver $current -Type $Type
}

$targetRaw = Format-Semver -Semver $target

# ─────────────────────────────────────────────────────────────────────────────
# Build the change plan
# ─────────────────────────────────────────────────────────────────────────────
$lockVersions = Read-PackageLockVersions
$changes = @()
if (-not $SkipRoot) {
    $changes += @{ File = $RootPkg; Current = $currentRaw; Next = $targetRaw }
    $changes += @{ File = $PackageLock; Current = "top-level=$($lockVersions.TopLevel), root=$($lockVersions.Root)"; Next = $targetRaw }
}
$changes += @{ File = $DesktopPkg; Current = (Read-JsonVersion -Path $DesktopPkg); Next = $targetRaw }
$changes += @{ File = $PackageLock; Current = "apps/desktop=$($lockVersions.Desktop)"; Next = $targetRaw }
$changes += @{ File = $TauriConf; Current = (Read-JsonVersion -Path $TauriConf); Next = $targetRaw }
$changes += @{ File = $CargoToml; Current = (Select-String -LiteralPath $CargoToml -Pattern '^version\s*=\s*".*"' | Select-Object -First 1).Line -replace '^version\s*=\s*"?', '' -replace '"$', ''; Next = $targetRaw }
$changes += @{ File = $CargoLock; Current = (Read-CargoLockVersion); Next = $targetRaw }

# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '──────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host "  HysCode version bump" -ForegroundColor Cyan
Write-Host '──────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host ("  Current base : {0}" -f $currentRaw)
Write-Host ("  Bump         : {0}" -f $(if ($Version) { "explicit → $Version" } else { $Type }))
Write-Host ("  Next base    : {0}" -f $targetRaw)
Write-Host '──────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host '  Files that will be updated:'
foreach ($c in $changes) {
    $rel = $c.File.Substring($RepoRoot.Length).TrimStart('\', '/')
    Write-Host ("    {0,-55} {1}  →  {2}" -f $rel, $c.Current, $c.Next)
}
Write-Host '──────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host ''

if ($DryRun) {
    Write-Host "Dry run — no files modified." -ForegroundColor Yellow
    return
}

# ─────────────────────────────────────────────────────────────────────────────
# Confirm
# ─────────────────────────────────────────────────────────────────────────────
if (-not $Force) {
    $answer = Read-Host "Proceed? [y/N]"
    if ($answer -notin @('y', 'Y', 'yes', 'Yes', 'YES')) {
        Write-Host "Aborted." -ForegroundColor Yellow
        return
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Apply changes
# ─────────────────────────────────────────────────────────────────────────────
# 1) Root package.json — only manual releases update the clean build base.
if (-not $SkipRoot) {
    $rootJson = [System.IO.File]::ReadAllText($RootPkg) | ConvertFrom-Json
    $rootJson.version = $targetRaw
    $rootOut = (($rootJson | ConvertTo-Json -Depth 100) -replace "`r?`n", "`n") + "`n"
    [System.IO.File]::WriteAllText($RootPkg, $rootOut)
}

# 2) apps/desktop/package.json
$deskJson = [System.IO.File]::ReadAllText($DesktopPkg) | ConvertFrom-Json
$deskJson.version = $targetRaw
$deskOut = (($deskJson | ConvertTo-Json -Depth 100) -replace "`r?`n", "`n") + "`n"
[System.IO.File]::WriteAllText($DesktopPkg, $deskOut)

# 3) apps/desktop/src-tauri/tauri.conf.json
$tauriJson = [System.IO.File]::ReadAllText($TauriConf) | ConvertFrom-Json
$tauriJson.version = $targetRaw
$tauriOut = (($tauriJson | ConvertTo-Json -Depth 100) -replace "`r?`n", "`n") + "`n"
[System.IO.File]::WriteAllText($TauriConf, $tauriOut)

# 4) apps/desktop/src-tauri/Cargo.toml — only the first [package] block.
# Read raw text and do a targeted string replace to preserve the file's
# original line endings (LF vs CRLF) and any other byte-level quirks.
$cargoText = [System.IO.File]::ReadAllText($CargoToml)
$cargoRegex = [regex]'(?ms)(^\[package\][^\[]*?^version\s*=\s*)"[^"]*"'
if (-not $cargoRegex.IsMatch($cargoText)) {
    throw "Failed to update 'version' line in $CargoToml — no [package] block found."
}
$cargoNew = $cargoRegex.Replace($cargoText, ('$1"' + $targetRaw + '"'), 1)
[System.IO.File]::WriteAllText($CargoToml, $cargoNew)

# 5) Lockfiles — update only the exact package metadata that carries the
# application version, preserving the rest of each generated lockfile.
Update-PackageLock -TargetVersion $targetRaw
Update-CargoLock -TargetVersion $targetRaw

# The release workflow commits immediately after this script returns. Fail
# before that commit if any runtime version is inconsistent.
Assert-SynchronizedVersions -TargetVersion $targetRaw -ExpectedRootVersion $currentRaw

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host "✓ Bumped to $targetRaw" -ForegroundColor Green
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host "  git add package.json package-lock.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock"
Write-Host "  git commit -m 'chore: bump version to $targetRaw'"
Write-Host "  git push   # triggers the Release workflow using the clean root base"
Write-Host ''

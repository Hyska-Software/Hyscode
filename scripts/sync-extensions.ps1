#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Syncs workspace extension source files → ~/.hyscode/extensions/
  Run this after editing any extension in the extensions/ folder.
  Supports both top-level extensions and category sub-folders (e.g. extensions/themes/).
#>

$src   = Join-Path $PSScriptRoot "..\extensions"
$dest  = Join-Path $HOME ".hyscode\extensions"

if (-not (Test-Path $dest)) {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
}

# Collect all extension source directories:
#   1. Top-level dirs that contain extension.json directly
#   2. Dirs one level inside category sub-folders (e.g. extensions/themes/tokyo-night/)
$extDirs = [System.Collections.Generic.List[System.IO.DirectoryInfo]]::new()

foreach ($item in Get-ChildItem $src -Directory) {
  if (Test-Path (Join-Path $item.FullName "extension.json")) {
    # Top-level extension
    $extDirs.Add($item)
  } else {
    # Category folder — scan one level deep
    foreach ($sub in Get-ChildItem $item.FullName -Directory -ErrorAction SilentlyContinue) {
      if (Test-Path (Join-Path $sub.FullName "extension.json")) {
        $extDirs.Add($sub)
      }
    }
  }
}

$count = 0
foreach ($extDir in $extDirs) {
  $target = Join-Path $dest $extDir.Name
  if (Test-Path $target) {
    Copy-Item -Path (Join-Path $extDir.FullName "*") -Destination $target -Recurse -Force
    Write-Host "  ✓ $($extDir.Name)"
    $count++
  } else {
    Write-Host "  ⚠  $($extDir.Name) not installed — skipping (install first via the app)"
  }
}

Write-Host ""
Write-Host "Synced $count extension(s). Reload the app to pick up changes."

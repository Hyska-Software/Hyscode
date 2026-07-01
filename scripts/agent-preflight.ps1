# ─────────────────────────────────────────────────────────────────────
# HysCode — Agent pre-flight check (Windows PowerShell)
#
# Equivalent of scripts/agent-preflight.sh. Run before:
#   git push -u <remote> HEAD
#   gh pr create ...
#
# Usage:
#   pwsh -ExecutionPolicy Bypass -File scripts/agent-preflight.ps1
# ─────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Continue'

$failed = 0

function Ok([string]$msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Err([string]$msg)  { Write-Host "✗ $msg" -ForegroundColor Red; $script:failed = 1 }

Write-Host "── HysCode agent pre-flight ──"

# 0. Inside a git repo
try {
  git rev-parse --is-inside-work-tree | Out-Null
} catch {
  Err "Not inside a git repository"
  exit 1
}

# 1. gh auth
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  try {
    gh auth status | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Ok "gh authenticated"
    } else {
      Err "gh not authenticated — run: gh auth login"
    }
  } catch {
    Err "gh not authenticated — run: gh auth login"
  }
} else {
  Warn "gh CLI not installed — skipping auth check"
}

# 2. Branch
$branch = git rev-parse --abbrev-ref HEAD 2>$null
if (-not $branch) {
  Err "Cannot determine current branch"
} elseif ($branch -in @('main', 'master')) {
  Err "On $branch — agents must work on a feature branch"
} elseif ($branch -match '^(feat|fix|chore|refactor|perf|docs|test)/[0-9]+-[a-z0-9][a-z0-9-]*$') {
  Ok "Branch pattern ok: $branch"
} else {
  Err "Branch '$branch' does not match <type>/<issue#>-<scope>-<slug> (e.g. feat/142-agent-harness-streaming)"
}

# 3. Working tree
$staged = (git diff --cached --name-only 2>$null | Measure-Object).Count
$unstaged = (git diff --name-only 2>$null | Measure-Object).Count
if ($staged -eq 0 -and $unstaged -eq 0) {
  Ok "Working tree clean"
} elseif ($staged -gt 0 -and $unstaged -eq 0) {
  Ok "Working tree staged ($staged files)"
} else {
  Warn "Working tree dirty — staged=$staged unstaged=$unstaged"
}

# 4 & 5. PR exists checks
if ($gh) {
  try {
    $prJson = gh pr view --json title,body,number,baseRefName 2>$null | ConvertFrom-Json
    if ($prJson -and $prJson.title) {
      $title = $prJson.title
      $body = if ($prJson.body) { $prJson.body } else { '' }
      $base = $prJson.baseRefName

      if ($base -ne 'main') {
        Err "PR base is '$base' — should be 'main'"
      } else {
        Ok "PR base is main"
      }

      if ($title -match '^(feat|fix|chore|refactor|perf|docs|test)(\([a-z0-9-]+\))?!?:\s.{3,72}$') {
        Ok "PR title ok: $title"
      } else {
        Err "PR title '$title' does not follow Conventional Commits (type(scope): subject, 3-72 chars)"
      }

      if ($body -match '(Closes|Fixes|Resolves|Refs)\s+#\d+') {
        Ok "PR body references an issue"
      } else {
        Err "PR body missing 'Closes #N' or 'Refs #N'"
      }
    } else {
      Warn "No PR found for current branch yet"
    }
  } catch {
    Warn "No PR found for current branch yet"
  }
}

Write-Host "────────────────────────────────"
if ($failed -eq 0) {
  Write-Host "Pre-flight passed." -ForegroundColor Green
  Write-Host "Safe to push and open PR."
  exit 0
} else {
  Write-Host "Pre-flight failed." -ForegroundColor Red
  Write-Host "Fix errors above before pushing."
  exit 1
}

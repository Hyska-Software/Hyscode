# ─────────────────────────────────────────────────────────────────────
# HysCode — Set branch protection on main (PowerShell)
#
# Idempotent. Re-run safely. Requires admin token on the org.
#
# Repo: Hyska-Software/Hyscode (Organization)
#
# Usage:
#   gh auth switch --user <admin-keyring-name>
#   pwsh -ExecutionPolicy Bypass -File scripts/set-branch-protection.ps1
# ─────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

$REPO = if ($env:REPO) { $env:REPO } else { 'Hyska-Software/Hyscode' }
$BRANCH = if ($env:BRANCH) { $env:BRANCH } else { 'main' }
$OWNER_BYPASS = if ($env:OWNER_BYPASS) { $env:OWNER_BYPASS } else { 'Estevaobonatto' }

Write-Host "── Checking permissions on $REPO ──"
$permsJson = gh api "repos/$REPO" --jq '.permissions.admin // false' 2>$null
if ($LASTEXITCODE -ne 0) { throw "gh api failed" }
if ($permsJson -ne 'true') {
  Write-Host "✗ Active gh account does not have admin on $REPO" -ForegroundColor Red
  Write-Host "  Run: gh auth switch --user <admin-account>"
  exit 1
}
Write-Host "✓ admin access confirmed"

$ownerType = gh api "repos/$REPO" --jq '.owner.type // "User"' 2>$null
if ($LASTEXITCODE -ne 0) { throw "gh api failed" }
if ($ownerType -ne 'Organization') {
  Write-Host "✗ Repo is not under an Organization (type=$ownerType)." -ForegroundColor Red
  Write-Host "  CODEOWNERS bypass requires an Organization."
  exit 1
}
Write-Host "✓ organization confirmed"

# 1. Repo-level merge options
Write-Host ""
Write-Host "── Patching repo merge options (squash-only) ──"
$mergeBody = @{
  allow_squash_merge = $true
  allow_merge_commit = $false
  allow_rebase_merge = $false
  allow_auto_merge = $true
  delete_branch_on_merge = $false
}
$mergeBody | ConvertTo-Json -Compress | gh api --method PATCH "repos/$REPO" --input - | Out-Null
if ($LASTEXITCODE -ne 0) { throw "PATCH repos/$REPO failed" }
Write-Host "✓ squash-only enabled, auto-merge enabled, branch kept on merge"

# 2. Branch protection
Write-Host ""
Write-Host "── Setting branch protection on $BRANCH ──"
$protBody = @{
  required_status_checks = @{
    strict = $true
    contexts = @('ci-success')
  }
  enforce_admins = $true
  required_pull_request_reviews = @{
    dismiss_stale_reviews = $true
    require_code_owner_reviews = $true
    required_approving_review_count = 1
    bypass_pull_request_allowances = @{
      users = @($OWNER_BYPASS)
      teams = @()
      apps = @()
    }
  }
  restrictions = $null
  required_linear_history = $true
  allow_force_pushes = $false
  allow_deletions = $false
  block_creations = $false
  required_conversation_resolution = $true
  lock_branch = $false
  allow_fork_syncing = $false
}
$protBody | ConvertTo-Json -Depth 10 -Compress | gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" --input - | Out-Null
if ($LASTEXITCODE -ne 0) { throw "PUT branch protection failed" }
Write-Host "✓ branch protection set on $BRANCH"
Write-Host "  - 1 approval required (CODEOWNERS review required)"
Write-Host "  - bypass: @$OWNER_BYPASS"
Write-Host "  - dismiss stale on push"
Write-Host "  - linear history required"
Write-Host "  - force-pushes: blocked"
Write-Host "  - deletions: blocked"
Write-Host "  - conversations: must be resolved"
Write-Host "  - required check: ci-success"

# 3. Verify
Write-Host ""
Write-Host "── Verifying ──"
Write-Host ""
Write-Host "Repo merge options:"
$mergeView = gh api "repos/$REPO" --jq '{
  squash: .allow_squash_merge,
  merge_commit: .allow_merge_commit,
  rebase: .allow_rebase_merge,
  auto_merge: .allow_auto_merge,
  delete_branch_on_merge: .delete_branch_on_merge
}' | ConvertFrom-Json
$mergeView | Format-Table | Out-String | Write-Host

Write-Host "Branch protection on $BRANCH:"
$protView = gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{
  enforce_admins: .enforce_admins.enabled,
  required_approvals: .required_pull_request_reviews.required_approving_review_count,
  code_owner_reviews: .required_pull_request_reviews.require_code_owner_reviews,
  dismiss_stale: .required_pull_request_reviews.dismiss_stale_reviews,
  bypass_users: [.required_pull_request_reviews.bypass_pull_request_allowances.users[].login],
  required_checks: .required_status_checks.contexts,
  linear_history: .required_linear_history.enabled,
  allow_force_pushes: .allow_force_pushes.enabled,
  allow_deletions: .allow_deletions.enabled,
  require_conversation_resolution: .required_conversation_resolution.enabled
}' | ConvertFrom-Json
$protView | Format-Table | Out-String | Write-Host

Write-Host "✓ Done." -ForegroundColor Green

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# HysCode — Set branch protection on main
#
# Idempotent. Re-run safely. Requires admin token on the org.
#
# Repo: Hyska-Software/Hyscode (Organization)
#
# Configures (REPO level):
#   - allow_squash_merge:    true
#   - allow_merge_commit:    false  (squash-only)
#   - allow_rebase_merge:    false  (squash-only)
#   - allow_auto_merge:      true
#   - delete_branch_on_merge:false  (keep branches after merge)
#
# Configures (BRANCH PROTECTION on main):
#   - 1 approval required
#   - CODEOWNERS review: required
#   - bypass: @Estevaobonatto (org member)
#   - dismiss stale reviews on push
#   - enforce admins
#   - linear history required
#   - allow force pushes: NO
#   - allow deletions: NO
#   - require conversation resolution: YES
#   - required status check: ci-success
#
# Usage:
#   gh auth switch --user <admin-keyring-name>
#   ./scripts/set-branch-protection.sh
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO="${REPO:-Hyska-Software/Hyscode}"
BRANCH="${BRANCH:-main}"
OWNER_BYPASS="${OWNER_BYPASS:-Estevaobonatto}"

# Pre-flight: check admin permission
echo "── Checking permissions on $REPO ──"
PERMS=$(gh api "repos/$REPO" --jq '.permissions.admin // false')
if [ "$PERMS" != "true" ]; then
  echo "✗ Active gh account does not have admin on $REPO"
  echo "  Run: gh auth switch --user <admin-account>"
  exit 1
fi
echo "✓ admin access confirmed"

# Verify org
OWNER_TYPE=$(gh api "repos/$REPO" --jq '.owner.type // "User"')
if [ "$OWNER_TYPE" != "Organization" ]; then
  echo "✗ Repo is not under an Organization (type=$OWNER_TYPE)."
  echo "  CODEOWNERS bypass requires an Organization. Migrate in"
  echo "  GitHub Settings → Accounts → Convert to Organization first."
  exit 1
fi
echo "✓ organization confirmed"

# ─────────────────────────────────────────────────────────────────────
# 1. Repo-level merge options: squash-only + auto-merge
# ─────────────────────────────────────────────────────────────────────
echo ""
echo "── Patching repo merge options (squash-only) ──"
gh api --method PATCH "repos/$REPO" --input - <<'EOF' >/dev/null
{
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_auto_merge": true,
  "delete_branch_on_merge": false
}
EOF
echo "✓ squash-only enabled, auto-merge enabled, branch kept on merge"

# ─────────────────────────────────────────────────────────────────────
# 2. Branch protection on main
# ─────────────────────────────────────────────────────────────────────
echo ""
echo "── Setting branch protection on $BRANCH ──"
gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" --input - <<EOF >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci-success"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "bypass_pull_request_allowances": {
      "users": ["$OWNER_BYPASS"],
      "teams": [],
      "apps": []
    }
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
echo "✓ branch protection set on $BRANCH"
echo "  - 1 approval required (CODEOWNERS review required)"
echo "  - bypass: @$OWNER_BYPASS"
echo "  - dismiss stale on push"
echo "  - linear history required"
echo "  - force-pushes: blocked"
echo "  - deletions: blocked"
echo "  - conversations: must be resolved"
echo "  - required check: ci-success"

# ─────────────────────────────────────────────────────────────────────
# 3. Verify
# ─────────────────────────────────────────────────────────────────────
echo ""
echo "── Verifying ──"
echo ""
echo "Repo merge options:"
gh api "repos/$REPO" --jq '{
  squash: .allow_squash_merge,
  merge_commit: .allow_merge_commit,
  rebase: .allow_rebase_merge,
  auto_merge: .allow_auto_merge,
  delete_branch_on_merge: .delete_branch_on_merge
}'
echo ""
echo "Branch protection on $BRANCH:"
gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{
  enforce_admins: .enforce_admins.enabled,
  required_approvals: .required_pull_request_reviews.required_approving_review_count,
  code_owner_reviews: .required_pull_request_reviews.require_code_owner_reviews,
  dismiss_stale: .required_pull_request_reviews.dismiss_stale_reviews,
  bypass_users: [.required_pull_request_reviews.bypass_pull_request_allowances.users[].login] | tostring,
  required_checks: .required_status_checks.contexts,
  linear_history: .required_linear_history.enabled,
  allow_force_pushes: .allow_force_pushes.enabled,
  allow_deletions: .allow_deletions.enabled,
  require_conversation_resolution: .required_conversation_resolution.enabled
}'

echo ""
echo "✓ Done."

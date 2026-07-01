#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# HysCode — Agent pre-flight check
#
# Validates that the current working state is ready to push/open PR.
# Run before: git push -u <remote> HEAD && gh pr create ...
#
# Checks:
#   1. gh auth status
#   2. Branch name follows <type>/<issue#>-<scope>-<slug>
#   3. Working tree is clean (or only staged)
#   4. PR title (if exists) follows Conventional Commits
#   5. PR body (if exists) contains Closes/Refs #N
#   6. On main → refuse (must be on feature branch)
#
# Exit code: 0 = all OK, 1 = at least one failure
# ─────────────────────────────────────────────────────────────────────

set -uo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[0;33m'
NC='\033[0m' # No Color

failed=0

ok()   { echo -e "${GRN}✓${NC} $1"; }
warn() { echo -e "${YEL}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; failed=1; }

echo "── HysCode agent pre-flight ──"

# 0. We're inside a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "Not inside a git repository"
  exit 1
fi

# 1. gh auth
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    ok "gh authenticated"
  else
    err "gh not authenticated — run: gh auth login"
  fi
else
  warn "gh CLI not installed — skipping auth check"
fi

# 2. Branch
BR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -z "$BR" ]; then
  err "Cannot determine current branch"
elif [ "$BR" = "main" ] || [ "$BR" = "master" ]; then
  err "On $BR — agents must work on a feature branch"
elif [[ "$BR" =~ ^(feat|fix|chore|refactor|perf|docs|test)/[0-9]+-[a-z0-9][a-z0-9-]*$ ]]; then
  ok "Branch pattern ok: $BR"
else
  err "Branch '$BR' does not match <type>/<issue#>-<scope>-<slug> (e.g. feat/142-agent-harness-streaming)"
fi

# 3. Working tree
if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  ok "Working tree clean"
else
  staged=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
  unstaged=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  if [ "$staged" -gt 0 ] && [ "$unstaged" -eq 0 ]; then
    ok "Working tree staged ($staged files)"
  else
    warn "Working tree dirty — staged=$staged unstaged=$unstaged"
  fi
fi

# 4 & 5. PR exists checks
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  PR_INFO=$(gh pr view --json title,body,number,baseRefName 2>/dev/null || echo "")
  if [ -n "$PR_INFO" ] && [ "$PR_INFO" != "null" ] && [ "$PR_INFO" != "{}" ]; then
    TITLE=$(echo "$PR_INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('title',''))" 2>/dev/null || echo "")
    BODY=$(echo "$PR_INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('body','') or '')" 2>/dev/null || echo "")
    BASE=$(echo "$PR_INFO" | python3 -c "import json,sys; print(json.load(sys.stdin).get('baseRefName',''))" 2>/dev/null || echo "")

    if [ "$BASE" != "main" ]; then
      err "PR base is '$BASE' — should be 'main'"
    else
      ok "PR base is main"
    fi

    if [[ "$TITLE" =~ ^(feat|fix|chore|refactor|perf|docs|test)(\([a-z0-9-]+\))?!?:[[:space:]].{3,72}$ ]]; then
      ok "PR title ok: $TITLE"
    else
      err "PR title '$TITLE' does not follow Conventional Commits (type(scope): subject, 3-72 chars)"
    fi

    if grep -qE '(Closes|Fixes|Resolves|Refs)[[:space:]]+#[0-9]+' <<<"$BODY"; then
      ok "PR body references an issue"
    else
      err "PR body missing 'Closes #N' or 'Refs #N'"
    fi
  else
    warn "No PR found for current branch yet"
  fi
fi

# 6. Quick lint/typecheck (best-effort, non-blocking)
if [ -f "package.json" ] && command -v npm >/dev/null 2>&1; then
  if [ -f "node_modules" ] || [ -d "node_modules" ]; then
    :
  else
    warn "node_modules missing — run 'npm ci' before CI"
  fi
fi

echo "────────────────────────────────"
if [ "$failed" -eq 0 ]; then
  echo -e "${GRN}Pre-flight passed.${NC} Safe to push and open PR."
  exit 0
else
  echo -e "${RED}Pre-flight failed.${NC} Fix errors above before pushing."
  exit 1
fi

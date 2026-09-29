#!/usr/bin/env bash
# Installs a post-commit hook that pushes each commit to `origin` in the background.
#   bash scripts/install-git-hooks.sh            install / update (idempotent)
#   bash scripts/install-git-hooks.sh --uninstall
# An existing post-commit hook is preserved: it is renamed to post-commit.local and still runs first.
# Skip a single push with:  KASA_NO_AUTOPUSH=1 git commit …   Log: .git/auto-push.log
set -euo pipefail

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' N=$'\033[0m'; else G='' Y='' R='' N=''; fi
ok() { printf '    %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '    %s!%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%s✖ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

MARKER='# kasa-pos auto-push hook'
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_DIR"
git rev-parse --git-dir >/dev/null 2>&1 || die "$REPO_DIR is not a git repository"

HOOKS_DIR="$(git rev-parse --git-path hooks)" # honours core.hooksPath
mkdir -p "$HOOKS_DIR"
HOOK="$HOOKS_DIR/post-commit"
LOCAL_HOOK="$HOOKS_DIR/post-commit.local"

if [[ "${1:-}" == --uninstall ]]; then
  if [[ -f "$HOOK" ]] && grep -qF "$MARKER" "$HOOK"; then
    rm -f "$HOOK"
    if [[ -f "$LOCAL_HOOK" ]]; then mv "$LOCAL_HOOK" "$HOOK"; ok "Restored your previous post-commit hook"; fi
    ok "Auto-push hook removed"
  else
    warn "No OpenPOS auto-push hook installed"
  fi
  exit 0
fi

if [[ -f "$HOOK" ]] && ! grep -qF "$MARKER" "$HOOK"; then
  [[ -e "$LOCAL_HOOK" ]] && die "Both $HOOK and $LOCAL_HOOK exist; merge them by hand first."
  mv "$HOOK" "$LOCAL_HOOK"
  chmod +x "$LOCAL_HOOK"
  ok "Kept your existing post-commit hook (now post-commit.local, still runs first)"
fi

cat >"$HOOK" <<'HOOK'
#!/bin/sh
# kasa-pos auto-push hook
# Installed by scripts/install-git-hooks.sh — pushes every commit to origin in the background.
hook_dir=$(dirname "$0")
if [ -x "$hook_dir/post-commit.local" ]; then
  "$hook_dir/post-commit.local" "$@" || exit $?
fi

[ "${KASA_NO_AUTOPUSH:-}" = 1 ] && exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0 # no remote yet: nothing to do
git symbolic-ref -q HEAD >/dev/null 2>&1 || exit 0  # detached HEAD
git_dir=$(git rev-parse --git-dir) || exit 0
[ -d "$git_dir/rebase-merge" ] || [ -d "$git_dir/rebase-apply" ] && exit 0 # mid-rebase

log="$git_dir/auto-push.log"
(
  printf '[%s] push %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --short HEAD)"
  GIT_TERMINAL_PROMPT=0 git push -q origin HEAD && echo "  ok" || echo "  FAILED (will be retried with the next push)"
) >>"$log" 2>&1 </dev/null &
exit 0
HOOK
chmod +x "$HOOK"
ok "post-commit hook installed ($HOOK)"
git remote get-url origin >/dev/null 2>&1 || warn "No 'origin' remote yet: the hook does nothing until one exists (run scripts/github-setup.sh)."

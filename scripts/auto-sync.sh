#!/usr/bin/env bash
# Keeps GitHub in sync with the working tree: commit everything that changed and push.
#   bash scripts/auto-sync.sh              watch mode (every $INTERVAL s, or on file change)
#   bash scripts/auto-sync.sh --once       a single sync cycle
#   options: --interval N (default 30), --no-push, --pull (rebase onto origin before pushing)
# Respects .gitignore, skips while a merge/rebase/cherry-pick is in progress, stops on Ctrl+C.
# Uses inotifywait (Linux, inotify-tools) or fswatch (macOS) when installed, else polls.
set -euo pipefail

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' D=$'\033[2m' N=$'\033[0m'; else G='' Y='' R='' D='' N=''; fi
ts() { date '+%H:%M:%S'; }
log() { printf '%s[%s]%s %s\n' "$D" "$(ts)" "$N" "$*"; }
ok() { printf '%s[%s]%s %s✔%s %s\n' "$D" "$(ts)" "$N" "$G" "$N" "$*"; }
warn() { printf '%s[%s]%s %s!%s %s\n' "$D" "$(ts)" "$N" "$Y" "$N" "$*" >&2; }
die() { printf '%s✖ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

ONCE=0 PUSH=1 PULL=0
INTERVAL="${INTERVAL:-30}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) ONCE=1 ;;
    --no-push) PUSH=0 ;;
    --pull) PULL=1 ;;
    --interval) [[ $# -ge 2 ]] || die "--interval needs a value"; INTERVAL="$2"; shift ;;
    --interval=*) INTERVAL="${1#*=}" ;;
    -h | --help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done
[[ "$INTERVAL" =~ ^[0-9]+$ && "$INTERVAL" -ge 1 ]] || die "--interval must be a positive number of seconds"

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$REPO_DIR is not a git repository"
REPO_DIR="$(git rev-parse --show-toplevel)"
cd "$REPO_DIR"
GIT_DIR_PATH="$(git rev-parse --absolute-git-dir)"

busy_reason() {
  local f
  for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG rebase-merge rebase-apply index.lock; do
    [[ -e "$GIT_DIR_PATH/$f" ]] && { echo "$f"; return 0; }
  done
  git symbolic-ref -q HEAD >/dev/null || { echo "detached HEAD"; return 0; }
  return 1
}

push_changes() {
  [[ "$PUSH" == 1 ]] || return 0
  git remote get-url origin >/dev/null 2>&1 || { warn "No 'origin' remote — commit kept locally (run scripts/github-setup.sh)"; return 0; }
  local branch ahead
  branch="$(git symbolic-ref --short HEAD)"
  if git rev-parse -q --verify "@{upstream}" >/dev/null 2>&1; then
    if [[ "$PULL" == 1 ]]; then
      GIT_TERMINAL_PROMPT=0 git pull -q --rebase --autostash origin "$branch" || { warn "git pull --rebase failed — resolve it, then sync resumes"; return 0; }
    fi
    ahead="$(git rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo 1)"
    [[ "$ahead" == 0 ]] && return 0
  fi
  if GIT_TERMINAL_PROMPT=0 git push -q -u origin "$branch" 2>"$GIT_DIR_PATH/auto-sync-push.err"; then
    ok "Pushed $branch to origin"
  else
    warn "Push failed: $(tail -n 3 "$GIT_DIR_PATH/auto-sync-push.err" | tr '\n' ' ')"
    if [[ "$PULL" == 1 ]]; then warn "Retrying next cycle"; else warn "Retrying next cycle (use --pull if the remote has new commits)"; fi
  fi
}

sync_once() {
  local reason
  if reason="$(busy_reason)"; then
    warn "Skipping: $reason in progress"
    return 0
  fi
  if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    git add -A
    if git diff --cached --quiet; then
      :
    else
      local stamp files
      stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      files="$(git diff --cached --name-only | wc -l | tr -d ' ')"
      # KASA_NO_AUTOPUSH: the post-commit hook must not race with the push below.
      if KASA_NO_AUTOPUSH=1 git commit -q -m "Auto-sync: $stamp"; then
        ok "Committed $files file(s) — Auto-sync: $stamp"
      else
        warn "git commit failed (a pre-commit hook?) — will retry"
        return 0
      fi
    fi
  fi
  push_changes
}

WATCHER=""
if command -v inotifywait >/dev/null 2>&1; then WATCHER=inotifywait
elif command -v fswatch >/dev/null 2>&1; then WATCHER=fswatch; fi
IGNORE_RE='(^|/)(\.git|node_modules|dist|release|coverage|android/app/build|android/\.gradle|ios/App/build)(/|$)'

WAIT_PID=""
wait_for_change() {
  # Returns after a file change or after $INTERVAL seconds, whichever comes first.
  case "$WATCHER" in
    inotifywait)
      inotifywait -qq -r -t "$INTERVAL" -e modify,create,delete,move --exclude "$IGNORE_RE" "$REPO_DIR" >/dev/null 2>&1 &
      ;;
    fswatch)
      (fswatch -1 -r -l 1 -E --exclude "$IGNORE_RE" "$REPO_DIR" >/dev/null 2>&1 & fpid=$!
        sleep "$INTERVAL" & spid=$!
        while kill -0 "$fpid" 2>/dev/null && kill -0 "$spid" 2>/dev/null; do sleep 0.5; done
        kill "$fpid" "$spid" 2>/dev/null || true) &
      ;;
    *) sleep "$INTERVAL" & ;;
  esac
  WAIT_PID=$!
  wait "$WAIT_PID" 2>/dev/null || true
  WAIT_PID=""
  [[ -n "$WATCHER" ]] && sleep 2 # let editors finish writing (debounce)
  return 0
}

LOCK="$GIT_DIR_PATH/auto-sync.pid"
cleanup() {
  [[ -n "$WAIT_PID" ]] && kill "$WAIT_PID" 2>/dev/null
  [[ -f "$LOCK" && "$(cat "$LOCK" 2>/dev/null)" == "$$" ]] && rm -f "$LOCK"
  return 0
}

if [[ "$ONCE" == 1 ]]; then
  sync_once
  exit 0
fi

if [[ -f "$LOCK" ]] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  die "auto-sync is already running for this repository (pid $(cat "$LOCK"))"
fi
echo $$ >"$LOCK"
trap cleanup EXIT
trap 'echo; log "Stopped."; exit 0' INT TERM

log "Auto-sync for $REPO_DIR — every ${INTERVAL}s${WATCHER:+ or on change ($WATCHER)}. Ctrl+C to stop."
while true; do
  sync_once
  wait_for_change
done

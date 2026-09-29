#!/usr/bin/env bash
# One-command GitHub setup for OpenPOS.
#
#   bash scripts/github-setup.sh [--name kasa-pos] [--public|--private] [--no-hooks]
#   (or: npm run github:setup -- --name my-shop-pos)
#
# 1. installs the GitHub CLI (gh) into ~/.local/bin if it is missing
# 2. signs you in to GitHub (browser/device-code flow) unless already signed in
# 3. lets git use gh for credentials (no passwords or tokens to paste)
# 4. creates the GitHub repository and pushes, or pushes to the existing `origin`
# 5. installs a post-commit hook that pushes every commit automatically
# 6. prints the repository URL
#
# Safe to run again at any time. Env overrides: REPO_NAME, VISIBILITY (private|public),
# REPO_DESCRIPTION, GH_TOKEN (non-interactive sign-in).
set -euo pipefail

# ---------------------------------------------------------------- output helpers
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m' C_BOLD=$'\033[1m' C_DIM=$'\033[2m' C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi
step() { printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die() {
  printf '\n%s✖ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2
  exit 1
}

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ---------------------------------------------------------------- arguments
REPO_NAME="${REPO_NAME:-kasa-pos}"
VISIBILITY="${VISIBILITY:-private}"
REPO_DESCRIPTION="${REPO_DESCRIPTION:-OpenPOS - offline-first point of sale for web, Windows, macOS, Linux, Android and iOS}"
INSTALL_HOOKS=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) [[ $# -ge 2 ]] || die "--name needs a value"; REPO_NAME="$2"; shift 2 ;;
    --name=*) REPO_NAME="${1#*=}"; shift ;;
    --public) VISIBILITY=public; shift ;;
    --private) VISIBILITY=private; shift ;;
    --no-hooks) INSTALL_HOOKS=0; shift ;;
    -h | --help) usage 0 ;;
    *) warn "Unknown option: $1"; usage 1 ;;
  esac
done
[[ "$VISIBILITY" == public || "$VISIBILITY" == private ]] || die "VISIBILITY must be 'public' or 'private'"
[[ "$REPO_NAME" =~ ^([A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+$ ]] || die "Invalid repository name: $REPO_NAME"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

command -v git >/dev/null 2>&1 || die "git is not installed. Install it first (https://git-scm.com/downloads)."
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "curl or wget is required."

download() { # download <url> <output-file|-> [header]
  local url="$1" out="$2" header="${3:-}"
  if command -v curl >/dev/null 2>&1; then
    if [[ -n "$header" ]]; then curl -fsSL --retry 3 -H "$header" -o "$out" "$url"; else curl -fsSL --retry 3 -o "$out" "$url"; fi
  else
    if [[ -n "$header" ]]; then wget -q --header="$header" -O "$out" "$url"; else wget -q -O "$out" "$url"; fi
  fi
}

# ---------------------------------------------------------------- 1. GitHub CLI
step "GitHub CLI"
GH="$(command -v gh || true)"
if [[ -z "$GH" && -x "$HOME/.local/bin/gh" ]]; then GH="$HOME/.local/bin/gh"; fi

install_gh() {
  local os arch ext pattern api json url tmp
  case "$(uname -s)" in
    Linux) os=linux ext=tar.gz ;;
    Darwin) os=macOS ext=zip ;;
    *) die "Automatic gh install supports Linux and macOS. On Windows run: winget install GitHub.cli (then re-run this script from Git Bash)." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    armv6* | armv7*) arch=armv6 ;;
    i386 | i686) arch=386 ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
  [[ "$os" == macOS && "$ext" == zip ]] && { command -v unzip >/dev/null 2>&1 || die "unzip is required"; }
  pattern="_${os}_${arch}\\.${ext//./\\.}\$"
  api="https://api.github.com/repos/cli/cli/releases/latest"
  info "Looking up the latest gh release for ${os}/${arch}…"
  json="$(download "$api" - "Accept: application/vnd.github+json")" || die "Could not reach $api"
  url="$(printf '%s\n' "$json" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"$/\1/' | grep -E "$pattern" | head -n 1 || true)"
  [[ -n "$url" ]] || die "No gh download found for ${os}/${arch} in the latest release."

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/kasa-gh.XXXXXX")"
  # shellcheck disable=SC2064  # expand $tmp now: it is local to this function
  trap "rm -rf '$tmp'" EXIT
  info "Downloading $(basename "$url")…"
  download "$url" "$tmp/gh.$ext" || die "Download failed: $url"
  if [[ "$ext" == zip ]]; then unzip -q "$tmp/gh.$ext" -d "$tmp/x"; else mkdir -p "$tmp/x" && tar -xzf "$tmp/gh.$ext" -C "$tmp/x"; fi
  local bin
  bin="$(find "$tmp/x" -type f -path '*/bin/gh' | head -n 1)"
  [[ -n "$bin" ]] || die "gh binary not found in the archive"
  mkdir -p "$HOME/.local/bin"
  install -m 0755 "$bin" "$HOME/.local/bin/gh" 2>/dev/null || { cp "$bin" "$HOME/.local/bin/gh" && chmod 0755 "$HOME/.local/bin/gh"; }
  rm -rf "$tmp"
  trap - EXIT
  GH="$HOME/.local/bin/gh"
}

if [[ -z "$GH" ]]; then
  install_gh
  ok "Installed $("$GH" --version | head -n 1) to ~/.local/bin/gh"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "$HOME/.local/bin is not on your PATH. Add this to your shell profile:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
else
  ok "$("$GH" --version | head -n 1) ($GH)"
fi
GH_DIR="$(dirname "$GH")"
export PATH="$GH_DIR:$PATH"

# ---------------------------------------------------------------- 2. sign in
step "GitHub sign-in"
if "$GH" auth status --hostname github.com >/dev/null 2>&1; then
  ok "Already signed in"
else
  [[ -t 0 ]] || die "Not signed in and no terminal for the browser login. Run interactively, or set GH_TOKEN."
  info "A browser window (or a one-time code) will be used to sign in to GitHub."
  "$GH" auth login --hostname github.com --git-protocol https --web || die "GitHub sign-in failed"
  ok "Signed in"
fi
GH_USER="$("$GH" api user --jq .login 2>/dev/null || true)"
[[ -n "$GH_USER" ]] || die "Could not read your GitHub user (check: gh auth status)"
info "Account: ${C_BOLD}${GH_USER}${C_RESET}"

# ---------------------------------------------------------------- 3. git credentials
step "Git credentials"
"$GH" auth setup-git --hostname github.com >/dev/null || die "gh auth setup-git failed"
ok "git uses gh for github.com (HTTPS)"

# ---------------------------------------------------------------- repository state
step "Local repository"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q -b main 2>/dev/null || { git init -q && git symbolic-ref HEAD refs/heads/main; }
  ok "Initialised a git repository"
fi

# Commits need an identity; default to the GitHub account (private noreply address).
if [[ -z "$(git config user.name || true)" ]]; then
  name="$("$GH" api user --jq '.name // .login' 2>/dev/null || echo "$GH_USER")"
  git config user.name "${name:-$GH_USER}"
  ok "git user.name = $(git config user.name) (this repository only)"
fi
if [[ -z "$(git config user.email || true)" ]]; then
  uid="$("$GH" api user --jq .id 2>/dev/null || true)"
  git config user.email "${uid:+$uid+}${GH_USER}@users.noreply.github.com"
  ok "git user.email = $(git config user.email) (this repository only)"
fi

GIT_DIR_PATH="$(git rev-parse --git-dir)"
for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  [[ -e "$GIT_DIR_PATH/$f" ]] && die "A merge/rebase is in progress. Finish it (git status) and run this again."
done

if ! git rev-parse --verify -q HEAD >/dev/null; then
  git add -A
  git commit -q -m "Initial commit" || die "Could not create the initial commit"
  ok "Created the initial commit"
fi

BRANCH="$(git symbolic-ref --short -q HEAD || true)"
[[ -n "$BRANCH" ]] || die "HEAD is detached. Check out a branch first (e.g. git switch main)."
info "Branch: $BRANCH"
if [[ -n "$(git status --porcelain)" ]]; then
  warn "You have uncommitted changes; they stay local until you commit (or run: npm run sync:watch)."
fi

# ---------------------------------------------------------------- 4. remote + push
step "GitHub repository"
if [[ "$REPO_NAME" == */* ]]; then FULL_NAME="$REPO_NAME"; else FULL_NAME="$GH_USER/$REPO_NAME"; fi

if git remote get-url origin >/dev/null 2>&1; then
  ok "Remote origin: $(git remote get-url origin)"
elif "$GH" repo view "$FULL_NAME" >/dev/null 2>&1; then
  git remote add origin "https://github.com/$FULL_NAME.git"
  ok "Connected to existing repository $FULL_NAME"
else
  info "Creating $VISIBILITY repository $FULL_NAME…"
  "$GH" repo create "$FULL_NAME" "--$VISIBILITY" --source=. --remote=origin --push --description "$REPO_DESCRIPTION" ||
    die "Could not create $FULL_NAME (does the name already exist in another account?)"
  ok "Created https://github.com/$FULL_NAME and pushed $BRANCH"
fi

info "Pushing $BRANCH…"
if git push -u origin "$BRANCH"; then
  ok "origin/$BRANCH is up to date"
else
  die "Push failed. If the remote has commits you don't have, run: git pull --rebase origin $BRANCH  and try again."
fi
git push -q origin --tags 2>/dev/null || true

# ---------------------------------------------------------------- 5. hooks
if [[ "$INSTALL_HOOKS" == 1 ]]; then
  step "Auto-push on commit"
  bash "$SCRIPT_DIR/install-git-hooks.sh"
fi

# ---------------------------------------------------------------- 6. summary
REPO_URL="$("$GH" repo view --json url --jq .url 2>/dev/null || git remote get-url origin)"
OWNER_REPO="$("$GH" repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo "$FULL_NAME")"
step "Done"
printf '\n    %sRepository:%s %s\n\n' "$C_BOLD" "$C_RESET" "$REPO_URL"
cat <<EOF
    How syncing works now:
      • Every ${C_BOLD}git commit${C_RESET} is pushed to GitHub in the background
        (post-commit hook; log: .git/auto-push.log; skip once with KASA_NO_AUTOPUSH=1).
      • ${C_BOLD}npm run sync:watch${C_RESET} commits and pushes all changes automatically every 30 s
        (${C_DIM}bash scripts/auto-sync.sh --once${C_RESET} for a single sync, INTERVAL=60 to change the pace).
      • Releases: ${C_BOLD}git tag v1.0.0 && git push origin v1.0.0${C_RESET} builds Windows/macOS/Linux/
        Android/iOS/web in GitHub Actions (see docs/DEPLOYMENT.md).

    Optional: add this to package.json so desktop builds know where to publish updates:
      ${C_DIM}"repository": "github:${OWNER_REPO}"${C_RESET}
EOF

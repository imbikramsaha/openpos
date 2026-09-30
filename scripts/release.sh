#!/usr/bin/env bash
# Publishes a release under the repository owner's own GitHub account.
#   bash scripts/release.sh 1.2.0        (or: npm run release -- 1.2.0)
#
# Bumps the version, commits, creates the draft GitHub Release as you and then pushes the tag, so
# .github/workflows/release.yml builds every installer into that draft and publishes it. A release
# the workflow has to create itself shows "github-actions released this"; one made here shows you.
# It stops before changing anything unless git commits and the gh CLI both use the owner's account.
set -euo pipefail

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then G=$'\033[32m' R=$'\033[31m' N=$'\033[0m'; else G='' R='' N=''; fi
ok() { printf '    %s✔%s %s\n' "$G" "$N" "$*"; }
die() { printf '%s✖ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."
VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "Usage: bash scripts/release.sh <version>, e.g. 1.2.0"
TAG="v$VERSION"

# Commits, the tag and the release all belong to the repository owner, nobody else.
command -v gh >/dev/null || die "Install the GitHub CLI (gh), then run: gh auth login"
OWNER="$(gh repo view --json owner --jq .owner.login)" || die "gh can't see this repository: run gh auth login"
LOGIN="$(gh api user --jq .login)"
[[ "$LOGIN" == "$OWNER" ]] || die "gh is signed in as $LOGIN, not $OWNER: run gh auth switch"
EMAIL="$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
[[ "$(git config user.email)" == "$EMAIL" ]] || die "Commits would use $(git config user.email). Run: git config user.email $EMAIL"
ok "Releasing $TAG as $OWNER"

# A clean main that matches GitHub, and a version nobody has released yet.
[[ "$(git symbolic-ref --short HEAD)" == main ]] || die "Switch to main first"
[[ -z "$(git status --porcelain)" ]] || die "Commit or stash your changes first"
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "main differs from GitHub: pull or push first"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "Tag $TAG already exists here"
[[ -n "$(git ls-remote --tags origin "refs/tags/$TAG")" ]] && die "Tag $TAG is already on GitHub"
gh release view "$TAG" >/dev/null 2>&1 && die "A release for $TAG already exists"

npm version "$VERSION" --no-git-tag-version >/dev/null
KASA_NO_AUTOPUSH=1 git commit -q -am "Release $VERSION"
git push -q origin main
ok "Committed and pushed version $VERSION"

# The draft has to exist before the tag arrives: the workflow then fills it instead of making its own.
gh release create "$TAG" --draft --title "OpenPOS $TAG" --generate-notes --target "$(git rev-parse HEAD)" >/dev/null
ok "Created the draft release as $OWNER"

git tag -a "$TAG" -m "OpenPOS $VERSION"
git push -q origin "$TAG"
ok "Pushed $TAG. The installers build and publish in about 20 minutes:"
echo "      gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"

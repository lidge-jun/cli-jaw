#!/usr/bin/env bash
# release.sh — 빌드 + 버전업 + npm publish + GitHub Release 한 번에 처리
# Auto-detects npm latest and bumps patch only (minor/major via explicit arg).
# Usage:
#   ./release.sh          → patch bump (1.6.9 → 1.6.10)
#   ./release.sh minor    → minor bump (1.6.9 → 1.7.0)
#   ./release.sh major    → major bump (1.6.9 → 2.0.0)
#   ./release.sh 1.8.0    → explicit version
set -e

echo "🦈 cli-jaw release script"
echo "========================="

cd "$(dirname "$0")/.."

# ─── Version detection ─────────────────────────────────
NPM_LATEST=$(npm view cli-jaw dist-tags.latest 2>/dev/null || echo "0.0.0")
PKG_VERSION=$(node -p "require('./package.json').version")
echo "📡 npm latest:   $NPM_LATEST"
echo "📦 package.json: $PKG_VERSION"

# Sync package.json to npm latest if behind (strip prerelease)
CLEAN_NPM=$(echo "$NPM_LATEST" | sed 's/-.*//')
CLEAN_PKG=$(echo "$PKG_VERSION" | sed 's/-.*//')
if [ "$CLEAN_PKG" != "$CLEAN_NPM" ] && [ "$CLEAN_NPM" != "0.0.0" ]; then
  echo "⚠️  package.json ($CLEAN_PKG) differs from npm ($CLEAN_NPM). Syncing..."
  npm version "$CLEAN_NPM" --no-git-tag-version --allow-same-version
fi

# ─── Build ─────────────────────────────────────────────
echo "📦 Building backend (tsc)..."
./node_modules/.bin/tsc

echo "📦 Building frontend (vite)..."
npx vite build

# ─── Version bump ──────────────────────────────────────
BUMP_ARG="${1:-patch}"

# If arg looks like a semver (x.y.z), use it directly
if [[ "$BUMP_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  npm version "$BUMP_ARG" --no-git-tag-version
else
  # patch (default), minor, or major
  npm version "$BUMP_ARG" --no-git-tag-version
fi

VERSION=$(node -p "require('./package.json').version")
echo "📌 New version: $VERSION"

# ─── Collect changelog ─────────────────────────────────
PREV_TAG=$(git tag --sort=-v:refname | grep -E '^v[0-9]' | head -1)
if [ -n "$PREV_TAG" ]; then
  CHANGELOG=$(git log "$PREV_TAG"..HEAD --pretty=format:"- %s" --no-merges | head -50)
  COMMIT_COUNT=$(git rev-list "$PREV_TAG"..HEAD --count)
else
  CHANGELOG=$(git log --oneline -20 --pretty=format:"- %s" --no-merges)
  COMMIT_COUNT="?"
fi

echo ""
echo "📝 Changes since ${PREV_TAG:-'(none)'} ($COMMIT_COUNT commits):"
echo "$CHANGELOG" | head -15
echo ""

# ─── Commit + Tag + Push ──────────────────────────────
echo "🏷️  Creating git tag v$VERSION..."
git add package.json package-lock.json
git commit -m "[agent] chore: release v$VERSION" --allow-empty
git tag "v$VERSION"
git push origin master
git push origin "v$VERSION"

# ─── npm publish ───────────────────────────────────────
echo "🚀 Publishing to npm..."
npm publish --access public

# ─── GitHub Release with changelog ─────────────────────
echo "📋 Creating GitHub Release..."
RELEASE_BODY="## Release v$VERSION

**Previous**: ${PREV_TAG:-'(first release)'}
**Commits**: $COMMIT_COUNT

### Changes
$CHANGELOG"

if [ -n "$PREV_TAG" ] && command -v gh &>/dev/null; then
    gh release create "v$VERSION" \
        --title "v$VERSION" \
        --notes "$RELEASE_BODY" \
        --latest
    echo "✅ GitHub Release v$VERSION created!"
else
    echo "⚠️  Skipped GitHub Release (gh CLI not found or no previous tag)"
fi

echo ""
echo "✅ cli-jaw@$VERSION published!"
echo "   Install: npm install -g cli-jaw"
echo "   Release: https://github.com/lidge-jun/cli-jaw/releases/tag/v$VERSION"

#!/usr/bin/env bash
# release-preview.sh — build + preview semver bump + npm publish --tag preview
# Auto-detects npm latest, bumps (default patch +1), then appends -preview.TIMESTAMP
# Usage:
#   ./release-preview.sh                 → patch bump (1.6.9 → 1.6.10-preview.*)
#   ./release-preview.sh --minor         → minor bump (1.6.9 → 1.7.0-preview.*)
#   ./release-preview.sh --major         → major bump (1.6.9 → 2.0.0-preview.*)
#   ./release-preview.sh 1.8.0           → explicit base version
# Desktop artifacts are built and attached by GitHub Actions after the
# GitHub prerelease is published.
set -euo pipefail

cd "$(dirname "$0")/.."

# ─── Flag parsing ──────────────────────────────────────
BUMP_KIND="patch"
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --with-desktop)
      echo "ℹ️  --with-desktop is no longer needed; GitHub Actions builds desktop assets after release publication."
      ;;
    --major|major)
      BUMP_KIND="major"
      ;;
    --minor|minor)
      BUMP_KIND="minor"
      ;;
    --patch|patch)
      BUMP_KIND="patch"
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"

run_electron_release_checks() {
  echo "🖥️  Checking Electron npm boundary..."
  npm run check:electron-no-native

  echo "🖥️  Type checking Electron shell..."
  npm --prefix electron run typecheck

  echo "🖥️  Building Electron shell..."
  npm --prefix electron run build
}

ELECTRON_RELEASE_NOTES_BASE="### Desktop / Electron
- Electron shell validated with \`npm --prefix electron run typecheck\` and \`npm --prefix electron run build\`.
- npm package boundary validated with \`npm run check:electron-no-native\`; Electron app artifacts remain outside the npm package.
- Desktop app distribution remains separate from \`npm install -g cli-jaw\`.
- macOS, Windows, and Linux desktop assets are built by GitHub Actions after this prerelease is published, then attached to this GitHub Release."

ELECTRON_RELEASE_NOTES_UNSIGNED="
#### ⚠️ Desktop app downloads are unsigned
The desktop assets attached by GitHub Actions are **unsigned** (no Apple Developer ID / Windows code-signing cert configured).

- macOS: Gatekeeper will block first launch. Either right-click → Open → Open, or remove the quarantine attribute:
  \`\`\`sh
  xattr -d com.apple.quarantine /Applications/cli-jaw.app
  \`\`\`
- Windows: SmartScreen will warn on first run. Click \"More info\" → \"Run anyway\".
- Linux: AppImage downloads may need execute permission before launch.
- For trusted distribution, install via \`npm install -g cli-jaw\` instead."

ELECTRON_RELEASE_NOTES="$ELECTRON_RELEASE_NOTES_BASE$ELECTRON_RELEASE_NOTES_UNSIGNED"

# ─── Version detection ─────────────────────────────────
NPM_LATEST=$(npm view cli-jaw dist-tags.latest 2>/dev/null || echo "")
PKG_VERSION=$(node -p "require('./package.json').version")

# Use npm latest > package.json, strip prerelease suffix
RAW_VERSION="${NPM_LATEST:-$PKG_VERSION}"
RAW_VERSION=$(echo "$RAW_VERSION" | sed 's/-.*//')

# Bump per BUMP_KIND so preview > latest in semver
IFS='.' read -r MAJOR MINOR PATCH <<< "$RAW_VERSION"
case "$BUMP_KIND" in
  major) BASE_VERSION="$((MAJOR + 1)).0.0" ;;
  minor) BASE_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) BASE_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
esac

# Allow explicit override: ./release-preview.sh 2.0.0
if [ "${1:-}" != "" ]; then
  BASE_VERSION="$1"
fi

PREID="${PREID:-preview}"
STAMP="${STAMP:-$(date +%Y%m%d%H%M%S)}"

if [[ ! "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ BASE_VERSION must look like 1.6.10 (got: $BASE_VERSION)"
  exit 1
fi

PREVIEW_VERSION="${BASE_VERSION}-${PREID}.${STAMP}"

echo "🦈 cli-jaw preview release script"
echo "================================="
echo "npm latest:      ${NPM_LATEST:-'(not found)'}"
echo "package.json:    $PKG_VERSION"
echo "Preview version: $PREVIEW_VERSION  (base $RAW_VERSION + $BUMP_KIND bump)"
echo "Dist-tag:        preview"

# ─── Collect changelog from commits since last tag ─────
PREV_TAG=$(git tag --sort=-v:refname | grep -E '^v[0-9]' | head -1)
if [ -n "$PREV_TAG" ]; then
  CHANGELOG=$(git log "$PREV_TAG"..HEAD -n 30 --pretty=format:"- %s" --no-merges)
  COMMIT_COUNT=$(git rev-list "$PREV_TAG"..HEAD --count)
else
  CHANGELOG=$(git log --oneline -10 --pretty=format:"- %s" --no-merges)
  COMMIT_COUNT="?"
fi

echo ""
echo "📝 Changes since $PREV_TAG ($COMMIT_COUNT commits):"
head -n 10 <<< "$CHANGELOG"
echo ""

# ─── Build ─────────────────────────────────────────────
echo "⬆️  Setting preview version..."
npm version "$PREVIEW_VERSION" --no-git-tag-version

VERSION=$(node -p "require('./package.json').version")
echo "📌 package.json version: $VERSION"

echo "🔎 Type checking..."
pnpm exec tsc --noEmit

echo "📦 Building backend..."
npm run build

echo "📦 Building frontend..."
npm run build:frontend

run_electron_release_checks

echo "🧪 Verifying npm package contents..."
npm pack --dry-run >/dev/null

# ─── Commit + Publish ─────────────────────────────────
echo "📝 Creating local commit..."
git add package.json package-lock.json
git commit -m "[agent] chore: preview v$VERSION" --allow-empty

echo "🚀 Publishing preview to npm..."
TARBALL="$(npm pack | tail -1)"
trap 'rm -f "$TARBALL"' EXIT
npm publish "$TARBALL" --tag preview --access public

echo "🏷️  Creating preview tag..."
git tag "v$VERSION"

echo "⬆️  Pushing branch + tag..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$CURRENT_BRANCH"
git push origin "v$VERSION"

# ─── GitHub Prerelease with changelog ──────────────────
echo "📋 Creating GitHub prerelease..."
RELEASE_BODY="## Preview Release v$VERSION

**Base**: $RAW_VERSION → preview patch $BASE_VERSION
**Commits since $PREV_TAG**: $COMMIT_COUNT

### Changes
$CHANGELOG

$ELECTRON_RELEASE_NOTES"

if command -v gh &>/dev/null; then
  gh release create "v$VERSION" \
    --title "v$VERSION (preview)" \
    --notes "$RELEASE_BODY" \
    --prerelease
  echo "✅ GitHub prerelease v$VERSION created!"
  echo "🖥️  Desktop assets will be built by the Desktop Release GitHub Actions workflow."
else
  echo "⚠️  Skipped GitHub prerelease (gh CLI not found)"
fi

echo ""
echo "✅ Preview published: cli-jaw@$VERSION"
echo "   Install: npm install -g cli-jaw@preview"
echo "   Exact:   npm install -g cli-jaw@$VERSION"
echo "   Release: https://github.com/lidge-jun/cli-jaw/releases/tag/v$VERSION"

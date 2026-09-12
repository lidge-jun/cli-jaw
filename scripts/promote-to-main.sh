#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."
# shellcheck source=scripts/promotion-checkout.sh
source "$SCRIPT_DIR/promotion-checkout.sh"

command -v gh >/dev/null 2>&1 || { echo "ERROR: gh is required" >&2; exit 1; }
gh auth status >/dev/null
git fetch origin main preview --tags --prune

LIVE_PREVIEW_SHA="$(git rev-parse 'refs/remotes/origin/preview^{commit}')"
PREVIEW_SHA="$(git rev-parse "${1:-$LIVE_PREVIEW_SHA}^{commit}")"
if [ "$PREVIEW_SHA" != "$LIVE_PREVIEW_SHA" ]; then
  echo "ERROR: requested SHA is not the live origin/preview head" >&2
  exit 1
fi

PREVIEW_VERSION="$(git show "$PREVIEW_SHA:package.json" \
  | node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).version)')"

# The version alone cannot decide what to do here. This script writes to the
# remote in the middle of its own run: it lease-pushes preview to the stable bump
# and only then waits for CI before touching main. When that wait gave up,
# preview already carried X.Y.Z while main sat at its parent, and a re-run was
# refused by the prerelease check that used to live on this line, so the release
# was finished by hand. Loosening that check alone would be worse: the run would
# fall into npm version --allow-same-version below and lease-push a SECOND commit
# for a version CI had already certified. Classify the situation instead; the
# rules and their fixtures live in scripts/promotion-state.mjs.
MAIN_IS_ANCESTOR=false
if git merge-base --is-ancestor refs/remotes/origin/main "$PREVIEW_SHA" 2>/dev/null; then
  MAIN_IS_ANCESTOR=true
fi
PREVIEW_PARENT_VERSION="$(git show "$PREVIEW_SHA^:package.json" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).version)}catch{process.stdout.write("")}})' || true)"
PREVIEW_SUBJECT="$(git log -1 --format=%s "$PREVIEW_SHA")"
PREVIEW_DIFF="$(git diff --name-only "$PREVIEW_SHA^" "$PREVIEW_SHA" 2>/dev/null || true)"
MAIN_HEAD_SHA="$(git rev-parse refs/remotes/origin/main^{commit})"
PROMOTION_STATE_LINE="$(
  node -e '
    // node -e puts the FIRST user argument at argv[1]; there is no script path
    // to skip, so slicing at 2 silently drops previewVersion and hands the SHA
    // to the classifier as a version.
    const v = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      previewVersion: v[0], previewSha: v[1], mainSha: v[2],
      mainIsAncestor: v[3] === "true", parentVersion: v[4], previewSubject: v[5],
      changedFiles: v[6] ? v[6].split(String.fromCharCode(10)).filter(Boolean) : [],
    }));
  ' \
    "$PREVIEW_VERSION" "$PREVIEW_SHA" "$MAIN_HEAD_SHA" \
    "$MAIN_IS_ANCESTOR" "$PREVIEW_PARENT_VERSION" "$PREVIEW_SUBJECT" "$PREVIEW_DIFF" \
  | node scripts/promotion-state.mjs
)"
PROMOTION_STATE="${PROMOTION_STATE_LINE%% *}"
STABLE_VERSION="$(echo "$PROMOTION_STATE_LINE" | awk '{print $2}')"
RESUME=false
case "$PROMOTION_STATE" in
  prerelease)
    ;;
  resume)
    # preview already holds the bump this script writes and main has not taken
    # it. Skip the mint and the lease push; run the certification tail only.
    RESUME=true
    echo "NOTE: resuming an unfinished promotion of v$STABLE_VERSION at $PREVIEW_SHA" >&2
    ;;
  already_on_main)
    echo "Nothing to do: main and preview are both v$STABLE_VERSION at $PREVIEW_SHA." >&2
    exit 0
    ;;
  *)
    echo "ERROR: ${PROMOTION_STATE_LINE#* }" >&2
    exit 1
    ;;
esac

TESTS_URL="$(gh run list \
  --workflow test.yml \
  --branch preview \
  --commit "$PREVIEW_SHA" \
  --event push \
  --status success \
  --limit 1 --json url --jq '.[0].url // ""')"
if [ -z "$TESTS_URL" ]; then
  echo "ERROR: no successful Tests run for $PREVIEW_SHA on preview" >&2
  exit 1
fi

MAIN_SHA="$(git rev-parse 'refs/remotes/origin/main^{commit}')"
if ! git merge-base --is-ancestor "$MAIN_SHA" "$PREVIEW_SHA"; then
  echo "ERROR: origin/main is not an ancestor of the certified preview SHA" >&2
  exit 1
fi

# ─── Build the stable version bump ON TOP OF preview (#480) ─────────────────
# The bump commit used to be minted on a side branch and squashed onto main,
# which folded preview's history into one NEW commit. main then stopped being
# an ancestor of preview the instant the promotion succeeded, and the guard
# above demanded that ancestry back on the next cycle: the script broke its own
# precondition every release, and #468 had to bolt a realignment onto the end.
#
# Extending preview instead makes the whole chain fast-forwardable. main never
# gains a commit preview does not have, so there is nothing to realign, and the
# SHA that npm publishes is the SHA CI certified rather than a same-tree copy.
REMOTE_URL="$(git remote get-url origin)"
PROMOTION_TMP_ROOT="$(promotion_tmp_root)"
WORKTREE="$(mktemp -d "$PROMOTION_TMP_ROOT/cli-jaw-promote.XXXXXX")"
cleanup() {
  local status=$?
  if ! cleanup_promotion_checkout "$WORKTREE"; then
    echo "WARNING: failed to clean promotion checkout: $WORKTREE" >&2
  fi
  # The trap runs on every exit, including the failure it is cleaning up after.
  # Re-raise the original status so cleanup never rewrites the script's result.
  exit "$status"
}
trap cleanup EXIT
if [ "$RESUME" = true ]; then
  # Resume takes the commit preview already holds. Minting again would produce a
  # second commit for the same version, and lease-pushing it would replace a tree
  # CI had already certified, so neither the bump nor the preview push happens on
  # this path. The clone exists only so the main push below has the object: a push
  # from this repository would fail with "fatal: bad object".
  PROMOTION_COMMIT="$PREVIEW_SHA"
  git clone --quiet --no-checkout "$REMOTE_URL" "$WORKTREE"
  git -C "$WORKTREE" fetch --quiet origin "$PROMOTION_COMMIT"
  echo "resuming at the commit preview already carries: $PROMOTION_COMMIT"
else
  prepare_promotion_checkout "$REMOTE_URL" "$PREVIEW_SHA" preview "$WORKTREE"

  (
    cd "$WORKTREE"
    npm ci --ignore-scripts
    npm version "$STABLE_VERSION" --no-git-tag-version --allow-same-version
    node scripts/sync-electron-version.cjs
    npm run gate:all
    node scripts/require-release-evidence.mjs --accept-ci-evidence
    git add package.json package-lock.json electron/package.json electron/package-lock.json
    git commit -m "chore: promote v$STABLE_VERSION"
    assert_promotion_checkout_ready_to_push "$WORKTREE" "$PREVIEW_SHA" preview
  )
  PROMOTION_COMMIT="$(git -C "$WORKTREE" rev-parse HEAD)"

  # Fast-forward preview first. preview is where the release CI that publish.yml
  # gates on actually runs, so the bump has to be certified there before main can
  # take it. --force-with-lease pins the push to the SHA this run certified: if
  # preview moved while the gates ran, the push is refused instead of silently
  # discarding whatever landed.
  #
  # Every push here runs from the promotion checkout. The promotion commit exists
  # only in that clone, so pushing from the main repository fails with
  # "fatal: bad object" -- the object it is asked to send was never written here.
  git -C "$WORKTREE" push --force-with-lease="refs/heads/preview:$PREVIEW_SHA" \
    origin "$PROMOTION_COMMIT:refs/heads/preview"
  echo "preview fast-forwarded to the promotion commit: $PROMOTION_COMMIT"
fi

wait_for_run() {
  # $5 is the event filter. Tests must stay push-only: publish.yml accepts a
  # certifying Tests run only from a preview/main push, so waiting on any other
  # event here would wait for evidence the gate then rejects. The platform
  # workflow is the opposite: publish.yml and require-release-evidence.mjs both
  # look it up by commit with no event filter, so insisting on push here made a
  # legal re-dispatch unable to finish a promotion it had already satisfied.
  local workflow="$1" label="$2" branch="$3" sha="$4" event="${5:-push}"
  local url="" states="" live="" failed=""
  local -a event_filter=()
  [ -n "$event" ] && event_filter=(--event "$event")

  # The budget bounds DISCOVERY, not execution. It used to bound both at 1200s,
  # which is shorter than the 1500s the windows-wsl job alone is allowed, so a
  # slow-but-legal platform run could exhaust it while still running. Once a run
  # for this SHA exists, it carries its own timeout-minutes and that is the bound
  # we respect; a run that never appears is what this deadline is for.
  local discovery_deadline=$((SECONDS + 1200))
  while :; do
    url="$(gh run list \
      --workflow "$workflow" \
      --branch "$branch" \
      --commit "$sha" \
      "${event_filter[@]}" \
      --status success \
      --limit 1 --json url --jq '.[0].url // ""')"
    [ -n "$url" ] && { echo "$label certified by: $url" >&2; return 0; }

    # One listing, newest first, so liveness and failure are judged against the
    # same snapshot. Both workflows set cancel-in-progress, so a superseded run
    # leaves a cancelled conclusion next to a live replacement; reading only the
    # newest completed row called the SHA dead while it was still being tested.
    states="$(gh run list \
      --workflow "$workflow" \
      --branch "$branch" \
      --commit "$sha" \
      "${event_filter[@]}" \
      --limit 20 --json status,conclusion --jq '.[] | "\(.status) \(.conclusion // "")"')"
    live="$(printf '%s\n' "$states" | grep -c -E '^(queued|in_progress|waiting|requested|pending)' || true)"
    failed="$(printf '%s\n' "$states" | grep -m1 -E '^completed (failure|cancelled|timed_out|startup_failure|action_required)$' || true)"
    if [ -n "$failed" ] && [ "${live:-0}" -eq 0 ]; then
      echo "ERROR: $branch $label completed with ${failed#completed }" >&2
      return 1
    fi
    if [ "${live:-0}" -eq 0 ] && [ "$SECONDS" -ge "$discovery_deadline" ]; then
      echo "ERROR: no $branch $label run appeared for $sha within 1200s" >&2
      return 1
    fi
    sleep 10
  done
}

# postinstall-platform.yml carries paths: filters, so it never runs for a SHA
# that touches no installer-sensitive path. Waiting unconditionally would burn
# the full deadline on a run that will never exist, so the wait is gated on the
# same detector publish.yml uses.
PLATFORM_REQUIRED=false
PREVIOUS_TAG="$(git -C "$WORKTREE" tag --merged "$PROMOTION_COMMIT" --sort=-v:refname \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
if [ -n "$PREVIOUS_TAG" ]; then
  DETECTOR_STATUS=0
  git -C "$WORKTREE" diff --name-only "$PREVIOUS_TAG..$PROMOTION_COMMIT" \
    | node scripts/require-release-evidence.mjs --changed-files-stdin || DETECTOR_STATUS=$?
  [ "$DETECTOR_STATUS" -eq 1 ] && PLATFORM_REQUIRED=true
fi

# Printed on every path that gives up after preview already moved, so the
# operator resumes instead of reconstructing the tail by hand. The script is
# resumable now: re-running it classifies this exact state and skips the bump.
promote_resume_hint() {
  echo "" >&2
  echo "preview already carries v$STABLE_VERSION at $PROMOTION_COMMIT; main was not moved." >&2
  echo "Resume once the required runs are green (the bump is not repeated):" >&2
  echo "  bash scripts/promote-to-main.sh" >&2
}

wait_for_run test.yml "Tests" preview "$PROMOTION_COMMIT" push || { promote_resume_hint; exit 1; }
if [ "$PLATFORM_REQUIRED" = true ]; then
  # No event filter: publish.yml and require-release-evidence.mjs both accept any
  # successful platform run for the commit, so promote must not be stricter than
  # the gate it is feeding.
  wait_for_run postinstall-platform.yml "Postinstall Platform Checks" preview "$PROMOTION_COMMIT" "" \
    || { promote_resume_hint; exit 1; }
fi

# ─── Fast-forward main onto the certified commit ────────────────────────────
# No PR, no squash: main takes the exact SHA preview just certified. A plain
# push refuses anything that is not a fast-forward, so main can never gain a
# commit preview lacks, and the ancestry guard at the top of this script stays
# true for the next cycle without any repair step.
LIVE_PREVIEW_AFTER="$(git ls-remote origin refs/heads/preview | cut -f1)"
if [ "$LIVE_PREVIEW_AFTER" != "$PROMOTION_COMMIT" ]; then
  echo "ERROR: origin/preview moved while waiting for release CI" >&2
  exit 1
fi
git -C "$WORKTREE" push origin "$PROMOTION_COMMIT:refs/heads/main"

git fetch origin main
MERGED_MAIN_SHA="$(git ls-remote origin refs/heads/main | cut -f1)"
if [ "$MERGED_MAIN_SHA" != "$PROMOTION_COMMIT" ]; then
  echo "ERROR: origin/main is $MERGED_MAIN_SHA, expected the certified $PROMOTION_COMMIT" >&2
  exit 1
fi
MERGED_VERSION="$(git show "$MERGED_MAIN_SHA:package.json" \
  | node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).version)')"
if [ "$MERGED_VERSION" != "$STABLE_VERSION" ]; then
  echo "ERROR: merged main version is $MERGED_VERSION, expected $STABLE_VERSION" >&2
  exit 1
fi

# main and preview are now the same commit, so the preview push runs waited on
# above certify main too. publish.yml resolves them by SHA, not by branch, which
# is why the certified-sha tree-identity workaround is gone.
gh workflow run publish.yml \
  --ref main \
  -f version="$STABLE_VERSION" \
  -f tag=latest \
  -f expected-sha="$MERGED_MAIN_SHA" \
  -f dry-run=false \
  -f create-github-release=true

echo "stable publish dispatched: cli-jaw@$STABLE_VERSION from $MERGED_MAIN_SHA"

# Keep dev on the released line. dev is where work continues, so if it does not
# carry the bump the next release-preview.sh cuts from a branch that is behind
# main, and the ancestry guard above fails on the following cycle.
DEV_SHA="$(git ls-remote origin refs/heads/dev | cut -f1)"
if [ -n "$DEV_SHA" ] && git merge-base --is-ancestor "$DEV_SHA" "$PROMOTION_COMMIT"; then
  if git -C "$WORKTREE" push origin "$PROMOTION_COMMIT:refs/heads/dev" 2>/dev/null; then
    echo "dev fast-forwarded onto the release: $PROMOTION_COMMIT"
  else
    echo "WARN: could not fast-forward dev; merge origin/main into dev by hand" >&2
  fi
else
  echo "NOTE: dev has advanced past the release; merge origin/main into dev to keep it fast-forwardable" >&2
fi

#!/usr/bin/env bash
# Tags a release for every merge to main. Runs in CI on pushes to main,
# before the deploy, so the build sees the new tag (see docs/versioning.md).
#
#   [major] in the PR's title or description -> next major (vX+1.0.0);
#   [minor]                                   -> next minor (vX.Y+1.0);
#   neither                                   -> next patch (vX.Y.Z+1).
# So each merge is exactly one release, and `git describe` is always 0 commits ahead.
#
# Text inside <!-- comments --> is ignored, so the PR template can mention the
# markers without triggering them. [major] beats [minor].
#
# Usage: tag-release.sh [--dry-run]
# Env:   PR_TEXT  the PR's title and body (CI fills it from the GitHub API)
set -euo pipefail

dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

text="$(printf '%s' "${PR_TEXT:-}" | perl -0pe 's/<!--.*?-->//gs')"
if printf '%s' "$text" | grep -qiF '[major]'; then
    bump=major
elif printf '%s' "$text" | grep -qiF '[minor]'; then
    bump=minor
else
    bump=patch
fi

# Re-running a workflow on a commit that already carries a release tag is a no-op
if existing="$(git tag --points-at HEAD --list 'v[0-9]*')" && [ -n "$existing" ]; then
    echo "HEAD is already tagged $existing"
    exit 0
fi

latest="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
if [ -z "$latest" ]; then
    echo "no vX.Y.Z tag reachable from HEAD (is this a shallow checkout?)" >&2
    exit 1
fi
IFS=. read -r major minor patch <<< "${latest#v}"
case "$bump" in
    major) next="v$((major + 1)).0.0" ;;
    minor) next="v$major.$((minor + 1)).0" ;;
    patch) next="v$major.$minor.$((patch + 1))" ;;
esac

title="$(printf '%s' "${PR_TEXT:-}" | head -n1)"
echo "$bump release: $latest -> $next ($title)"
[ "$dry" = 1 ] && exit 0

git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    tag -a "$next" -m "${next#v} - $title"
git push origin "refs/tags/$next"

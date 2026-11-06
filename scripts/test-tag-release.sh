#!/usr/bin/env bash
# Tests scripts/tag-release.sh against a throwaway repo (no network, no push).
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/tag-release.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q . && git config user.email t@t && git config user.name t
git commit -q --allow-empty -m one && git tag -a v1.1.0 -m 1.1.0
git commit -q --allow-empty -m two

fail=0
check() { # name, expected output fragment, PR text
    local out
    out="$(PR_TEXT="$3" "$script" --dry-run 2>&1)" || true
    if printf '%s' "$out" | grep -qF -- "$2"; then echo "ok   $1"; else echo "FAIL $1: want '$2', got: $out"; fail=1; fi
}

check "no marker"            "patch release, no tag"  $'Fix a typo\n\nSmall.'
check "minor in title"       "v1.1.0 -> v1.2.0"       $'Avatars [minor]\n\nBody'
check "minor in body"        "v1.1.0 -> v1.2.0"       $'Avatars\n\nThis is a [Minor] release'
check "major in body"        "v1.1.0 -> v2.0.0"       $'Reset\n\n[major]'
check "major beats minor"    "v1.1.0 -> v2.0.0"       $'Reset [minor]\n\n[major]'
check "comment is ignored"   "patch release, no tag"  $'Fix\n\n<!-- Add [minor] or [major] if this is a release. -->'
check "multiline comment"    "patch release, no tag"  $'Fix\n\n<!--\n[major]\n[minor]\n-->'
check "unbracketed ignored"  "patch release, no tag"  $'Minor fix\n\nA major cleanup'

# A minor bump zeroes the patch of the nearest tag
git commit -q --allow-empty -m three
git tag -a v1.1.5 -m x HEAD~1
check "minor from 1.1.5"     "v1.1.5 -> v1.2.0"       $'x [minor]'
git tag -d v1.1.5 > /dev/null

git tag -a v1.2.0 -m x
check "already tagged"       "HEAD is already tagged v1.2.0" $'x [minor]'
exit $fail

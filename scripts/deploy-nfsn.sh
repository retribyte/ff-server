#!/usr/bin/env bash
# Build ff-server on this (Linux) machine and upload it to the NearlyFreeSpeech
# host. Prisma's CLI can't run on FreeBSD, so the client is generated here and
# copied over; everything the server runs is plain JS + wasm.
#
#   scripts/deploy-nfsn.sh            build, upload, install prod dependencies
#
# It ends by restarting the "ffserver" daemon (the host's `nfsn` CLI) and waiting
# until https://vortox.space/api/register answers again (~5 s of downtime).
#
# On the host (see docs/deploy-nfsn.md):
#   /home/protected/ff-server/   dist/, package*.json, node_modules/, REVISION
#                                plus .env and run.sh, which this never touches
# Env: NFSN_SSH (user@host), NFSN_KEY (ssh key path) override the defaults.
set -euo pipefail

SSH_TARGET="${NFSN_SSH:-retri_vortox@ssh.nyc1.nearlyfreespeech.net}"
KEY="${NFSN_KEY:-$HOME/.ssh/booru}"
DEST=/home/protected/ff-server
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes "$SSH_TARGET")
RSYNC_SSH="ssh -i $KEY -o IdentitiesOnly=yes"

cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then
    echo "ff-server has uncommitted changes; commit them first so REVISION means something" >&2
    exit 1
fi
REVISION="$(git rev-parse --short HEAD)"

echo "== build $REVISION"
npm ci --no-audit --no-fund
npx prisma generate
rm -rf dist
npx tsc

echo "== upload"
"${SSH[@]}" "mkdir -p $DEST"
rsync -a --delete -e "$RSYNC_SSH" dist package.json package-lock.json "$SSH_TARGET:$DEST/"

# Reinstall dependencies only when the lockfile changed. --ignore-scripts:
# Prisma's install hooks would try (and fail) to fetch FreeBSD engines.
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
"${SSH[@]}" "cd $DEST && if [ \"\$(cat node_modules/.lock-hash 2>/dev/null)\" != '$LOCK_HASH' ]; then
    echo '== npm ci on host (lockfile changed)'
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund && echo '$LOCK_HASH' > node_modules/.lock-hash
else
    echo '== dependencies unchanged'
fi"

# The generated client (npm ci on the host wipes it, so always copy)
rsync -a --delete -e "$RSYNC_SSH" node_modules/.prisma/ "$SSH_TARGET:$DEST/node_modules/.prisma/"
"${SSH[@]}" "echo $REVISION > $DEST/REVISION"
# New files take the uploader's group here, not the directory's; the daemon
# runs as web and needs group read
"${SSH[@]}" "chgrp -R web $DEST && chmod -R g+rX,o-rwx $DEST"

echo "== restart ffserver"
"${SSH[@]}" "nfsn stop-daemon ffserver > /dev/null; sleep 2; nfsn start-daemon ffserver > /dev/null"
# CI runs outside the US, so Cloudflare blocks it; CF_BYPASS_KEY (the x-bypass-key
# value its rules let through) gets the health check past
CF_BYPASS_KEY="$(printf %s "${CF_BYPASS_KEY:-}" | tr -d '[:space:]')"   # a pasted secret may carry a newline
CURL_AUTH=(); [ -n "$CF_BYPASS_KEY" ] && CURL_AUTH=(-H "x-bypass-key: $CF_BYPASS_KEY")
code=000
for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${CURL_AUTH[@]}" https://vortox.space/api/register)"
    [ "$code" = 200 ] && { echo "== deployed $REVISION, live"; exit 0; }
    sleep 2
done
[ "$code" != 200 ] && curl -s -D - -o /dev/null "${CURL_AUTH[@]}" https://vortox.space/api/register | grep -iE '^(HTTP|server|cf-mitigated|cf-ray)' >&2
echo "deployed $REVISION, but https://vortox.space/api/register answered $code, not 200; check /home/logs/daemon_ffserver.log" >&2
exit 1

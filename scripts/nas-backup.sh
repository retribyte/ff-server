#!/bin/bash
# Weekly pull backup of the Final Frontier site and the booru, run by cron on
# the home NAS ("watcher", /home/trey/scripts/vortox-backup.sh; this file in
# ff-server is the source copy). Everything is pulled over SSH: nothing new is
# stored on the NearlyFreeSpeech hosts, which bill for storage.
#
# ── What it takes ─────────────────────────────────────────────────────────
# site  (retri_vortox@NFSN): a pg_dump of the `ff` database, plus the host-only
#        config that isn't in git (.env, run scripts, Postgres config, DB
#        passwords). SSH runs on a different machine from the daemons and can't
#        reach Postgres, so the dump is made by a job on the daemon machine (the
#        `jobs` daemon, see ff-server/docs/deploy-nfsn.md), written to
#        /home/private/nas-backup/, pulled, then deleted (a ~2 MB file for a
#        minute).
# booru (retri_vortox-booru@NFSN): a consistent SQL dump of the Shimmie SQLite
#        DB (sqlite3 .dump streamed over SSH, nothing written remotely) and an
#        rsync mirror of /home/public: images, thumbs, data/bulk, the theme, the
#        locally edited .htaccess and config. The live .sqlite file itself is
#        excluded (a copy taken mid-write can be corrupt); the dump replaces it.
#        So is data/thumbs: thumbnails regenerate from the images (Shimmie admin
#        → regenerate thumbnails), and the ones made for web uploads are mode 600
#        and owned by the web user, so this SSH user can't read them anyway.
#
# Each run mirrors into STAGING_DIR/{site,booru} (rsync --delete), then writes
# a dated tar.gz of each into ARCHIVE_DIR/{site,booru} and prunes the oldest.
# The two halves are independent: one failing doesn't stop the other, but the
# script exits non-zero.
#
# ── Remote-side setup (once) ──────────────────────────────────────────────
# The NAS's key (SSH_KEY) must be authorized for both NFSN sites: NFSN member
# panel → Profile → SSH keys (member keys apply to every site).
#
# ── Restore ───────────────────────────────────────────────────────────────
# See "Backups" in ff-server/docs/deploy-nfsn.md.
# ──────────────────────────────────────────────────────────────────────────

# ── Config (each can be overridden from the environment, e.g. for a test run) ──
SITE_SSH="${SITE_SSH:-retri_vortox@ssh.nyc1.nearlyfreespeech.net}"
BOORU_SSH="${BOORU_SSH:-retri_vortox-booru@ssh.nyc1.nearlyfreespeech.net}"
SSH_KEY="${SSH_KEY:-/home/trey/.ssh/nfsn_backup}"
STAGING_DIR="${STAGING_DIR:-/home/trey/vortox}"
ARCHIVE_DIR="${ARCHIVE_DIR:-/volume1/media/backup/vortox}"
MAX_SITE_BACKUPS="${MAX_SITE_BACKUPS:-26}"
MAX_BOORU_BACKUPS="${MAX_BOORU_BACKUPS:-8}"
LOG_DIR="${LOG_DIR:-$STAGING_DIR/logs}"
MAX_LOGS=30
DATE=$(date +%Y-%m-%d)
STAMP=$(date +%Y%m%dT%H%M%S)
LOG="$LOG_DIR/vortox-backup-${DATE}.log"   # one file per day; same-day reruns append
# ──────────────────────────────────────────────────────────────────────────

SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

log() { echo "[$(date)] $*" >> "$LOG"; }
site() { ssh "${SSH_OPTS[@]}" "$SITE_SSH" "$@"; }
booru() { ssh "${SSH_OPTS[@]}" "$BOORU_SSH" "$@"; }

# rsync exit 23/24 (some files unreadable / vanished mid-transfer) are warnings
rsync_ok() {
  case $1 in
    0) return 0 ;;
    23|24) log "$2: rsync completed with warnings (exit $1)"; return 0 ;;
    *) log "$2: rsync FAILED (exit $1)"; return 1 ;;
  esac
}

archive() {   # archive <name> <max>
  mkdir -p "$ARCHIVE_DIR/$1"
  local file="$ARCHIVE_DIR/$1/vortox-$1-${DATE}.tar.gz"
  tar -czf "$file.part" -C "$STAGING_DIR" "$1" && mv "$file.part" "$file" \
    || { log "$1: tar FAILED"; rm -f "$file.part"; return 1; }
  log "$1: archive $(basename "$file") ($(du -h "$file" | cut -f1))"
  ls -t "$ARCHIVE_DIR/$1"/vortox-"$1"-*.tar.gz | tail -n +$(($2 + 1)) | xargs -r rm -f
}

backup_site() {
  local dest="$STAGING_DIR/site" job="nas-dump-$STAMP" dump="/home/private/nas-backup/ff-$STAMP.dump"
  mkdir -p "$dest/db" "$dest/config"

  # 1. Queue the dump on the daemon machine (write .tmp, then rename: the job
  #    runner only picks up complete *.sh files)
  site "umask 077; mkdir -p /home/private/nas-backup; cat > /home/private/jobs/$job.tmp && mv /home/private/jobs/$job.tmp /home/private/jobs/$job.sh" <<EOF || { log "site: couldn't queue the dump job"; return 1; }
set -e
umask 077
export PGHOST=/home/protected/pgsock PGUSER=ff PGDATABASE=ff PGPASSWORD="\$(cat /home/private/ff-db.pw)"
pg_dump -Fc -f "$dump.part"
mv "$dump.part" "$dump"
# housekeeping: old job logs from these runs, and dumps a failed run left behind
find /home/private/jobs/done -name 'nas-dump-*' -mtime +60 -delete
find /home/private/nas-backup -name 'ff-*.dump*' ! -name 'ff-$STAMP.dump' -mtime +1 -delete
EOF

  # 2. Wait for the job (it runs within ~5 s; the dump takes a few more)
  local status=""
  for _ in $(seq 1 60); do
    sleep 5
    status=$(site "tail -1 /home/private/jobs/done/$job.*.log 2>/dev/null")
    case "$status" in "== exit"*) break ;; esac
  done
  case "$status" in
    "== exit 0"*) ;;
    "") log "site: dump job never finished (is the jobs daemon running?)"; return 1 ;;
    *) log "site: dump job failed: $(site "cat /home/private/jobs/done/$job.*.log" 2>&1 | tail -5 | tr '\n' ' ')"; return 1 ;;
  esac

  # 3. Pull it, then delete it from the host
  rsync -az -e "$RSYNC_SSH" "$SITE_SSH:$dump" "$dest/db/ff.dump.part" 2>>"$LOG"
  rsync_ok $? "site dump" || return 1
  mv "$dest/db/ff.dump.part" "$dest/db/ff.dump"
  site "rm -f '$dump'" || log "site: WARNING: couldn't delete $dump on the host"
  log "site: database dump $(du -h "$dest/db/ff.dump" | cut -f1)"

  # 4. Host-only config (paths relative to /)
  printf '%s\n' \
    home/protected/ff-server/.env home/protected/ff-server/run.sh home/protected/ff-server/REVISION \
    home/protected/ff-site/run.sh home/protected/ff-site/app/REVISION \
    home/private/bin/ home/private/postgres-superuser.pw home/private/ff-db.pw \
    home/private/pgdata/postgresql.conf home/private/pgdata/pg_hba.conf \
    | rsync -az --delete -r --files-from=- -e "$RSYNC_SSH" "$SITE_SSH:/" "$dest/config/" 2>>"$LOG"
  rsync_ok $? "site config" || return 1
  chmod -R go-rwx "$dest"

  archive site "$MAX_SITE_BACKUPS"
}

backup_booru() {
  local dest="$STAGING_DIR/booru"
  mkdir -p "$dest/db" "$dest/public"

  # 1. Consistent SQL dump of the live SQLite DB, streamed (nothing written remotely)
  local db
  db=$(booru "ls /home/public/data/shimmie.*.sqlite") || { log "booru: can't find the SQLite DB"; return 1; }
  [ "$(echo "$db" | wc -l)" = 1 ] || { log "booru: expected one shimmie.*.sqlite, found: $db"; return 1; }
  set -o pipefail
  booru "sqlite3 -readonly -bail '$db' .dump" | gzip > "$dest/db/shimmie.sql.gz.part"
  local dump_exit=$?
  set +o pipefail
  if [ $dump_exit -ne 0 ] || [ "$(zcat "$dest/db/shimmie.sql.gz.part" | tail -1)" != "COMMIT;" ]; then
    log "booru: SQLite dump FAILED or incomplete (exit $dump_exit)"; rm -f "$dest/db/shimmie.sql.gz.part"; return 1
  fi
  mv "$dest/db/shimmie.sql.gz.part" "$dest/db/shimmie.sql.gz"
  log "booru: database dump $(du -h "$dest/db/shimmie.sql.gz" | cut -f1) (from $(basename "$db"))"

  # 2. Mirror the site: images, thumbs, bulk, theme, config, .htaccess
  rsync -az --delete -e "$RSYNC_SSH" \
    --exclude="/data/cache/" \
    --exclude="/data/temp/" \
    --exclude="/data/thumbs/" \
    --exclude="/data/*.sqlite" \
    --exclude="/data/*.sqlite-journal" \
    --exclude="/shimmie2-*.tgz" \
    "$BOORU_SSH:/home/public/" "$dest/public/" 2>>"$LOG"
  rsync_ok $? "booru files" || return 1
  log "booru: files $(du -sh "$dest/public" | cut -f1)"

  archive booru "$MAX_BOORU_BACKUPS"
}

mkdir -p "$LOG_DIR"
exec 9>"$STAGING_DIR/.backup.lock"
if ! flock -n 9; then
  log "Skipped: another vortox backup is running"
  exit 1
fi

log "Starting vortox backup..."
FAILED=""
backup_site || FAILED="$FAILED site"
backup_booru || FAILED="$FAILED booru"

ls -t "$LOG_DIR"/vortox-backup-*.log | tail -n +$((MAX_LOGS + 1)) | xargs -r rm -f

if [ -n "$FAILED" ]; then
  log "Done with FAILURES:$FAILED"
  exit 1
fi
log "Done. Archives: site $(ls "$ARCHIVE_DIR"/site/*.tar.gz | wc -l), booru $(ls "$ARCHIVE_DIR"/booru/*.tar.gz | wc -l)"

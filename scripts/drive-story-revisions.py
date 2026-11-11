#!/usr/bin/env python3
"""Suggest a Story.publishedDate for each story from its Google Doc's revision history.

For every doc below it lists the revisions (Drive API v3), exports each one as
plain text, diffs consecutive revisions, and calls a revision "substantial"
when it changed at least --threshold of the text (and at least --min-chars
characters). The suggested date is the date of the LAST substantial revision.

Read-only against Drive. Writes nothing to the database: it produces a CSV for
review and, with --sql, an UPDATE script you can read before running.

Stdlib only (run with `python3 -I`). You need a Drive OAuth access token with
the drive.readonly scope, in the DRIVE_TOKEN environment variable:

  - Easiest, no Cloud project: open https://developers.google.com/oauthplayground,
    pick "Drive API v3" -> .../auth/drive.readonly, Authorize APIs, then
    "Exchange authorization code for tokens", and copy the Access token.
    It lasts an hour; rerun with a fresh one if it expires (exports are cached,
    so a rerun only fetches what's missing).
  - Or: gcloud auth login --enable-gdrive-access && export DRIVE_TOKEN=$(gcloud auth print-access-token)

  DRIVE_TOKEN=ya29... python3 -I scripts/drive-story-revisions.py --out revisions-report

Caveats: Drive may have merged or dropped old revisions, so the first listed
revision of an old doc can be much later than the doc's creation. Docs whose
history is a single revision fall back to that revision's date, flagged
"single-revision". Only docs you can read are returned; a 403/404 is reported
and skipped.
"""
import argparse
import csv
import difflib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# slug -> (title, Drive file id). Stories with no Doc found in Drive
# (a_beginning, the_interviews, vm, zombification) are not listed.
DOCS = {
    "a_bad_day_for_everyone": ("A Bad Day for Everyone (NC)", "1fdSwFsFRn6XPehzRkIG9lv9Zl27P4v929X3iPVnnQYs"),
    "a_fateful_date": ("A Fateful Date", "1EKrdfNHXTlZNdkJ9pv68qP7s3IyMwakQfRwH2_0nBpg"),
    "a_quick_break": ("A Quick Break", "1WBZQQlfejWefNGNW7Z7jUnqRGJWCYVq7xNJOsQKj1Tc"),
    "a_wonderful_family_reunion": ("A Wonderful Family Reunion", "1GngNbJep0RA3gDGdioYN8k6hkRVO6mj_Ll2VKdj_NHg"),
    "aftermath_of_an_assassination": ("Aftermath of an Assassination", "1PRBr6pwDxnTPrQBfP3vDYAsH-07ugfruBCDg30VbZ7Q"),
    "any_means_necessary": ("Any Means Necessary", "1fISeY-V24WaOBpWiO84OyU8MflpCFrSoBBH_W7mdU2Q"),
    "ballistic_bonanza": ("Ballistic Bonanza", "1nTpbj3sDfGN4UR4IIPdMdb68FMpzQnot97cXrZRvKeA"),
    "bellow_and_zach_train": ("Bellow and Zach Train", "1JpysLwOXmj-0YSqZnXcswAFpmgNbNo_hpRee43jZ-0k"),
    "bellows_journal_and_audio_logs": ("Bellow's Journal and Audio Logs", "1tXvNEuLK6hBJsgFr0fJUugV4PfdHUDO7UG1N65oWuiQ"),
    "cold_comfort": ("Cold Comfort", "1EFvPWBT6J953YH2naHzoz5w9lDq0LtDhLRRPYPpggGg"),
    "cultural_spotlight": ("Cultural Spotlight", "196FbDlQtZdTXNChADWKetrjq9MktVaehajA4Uzh4-XU"),
    "deafening_silence": ("Deafening Silence", "1CrOdFv_KD8U9uEb0LJVcfKQcMMj9jh_VdH0hhjqJ9-c"),
    "deep_pockets": ("Deep Pockets", "1l7XmAvug15UT0tSYcb_gm0eOS8CJOvfOoX_yBL6ioG4"),
    "do_emmetts_dream_of_llamanian_sheep": ("Do Emmetts Dream of Llamanian Sheep?", "1fyOGjTO7e_hZ5DeFDM78hgMW2VwmCA77T_3GUwhANvg"),
    "give_no_quarter": ("Give No Quarter", "1DTNaBr1-Kdih9E_PtO-cCa1TDlOlEZa65qd0zHGwzE0"),
    "hesitation": ("Hesitation", "1FJ4pFZVplN2ZSaYNNfr9DDHklWvosrUf6Fzv49qa3ts"),
    "knocked_and_rocked_asleep": ("Knocked and Rocked Asleep", "1kO_CuvXNYZAVjCXcAhHiBekIHFLzvF_Mig6LbuvUDNA"),
    "omg_zachs_gay_shocker": ("Omg Zach's Gay, Shocker", "1OABbkQxVQqvXqDj1MZnwGXtMnEzly2NdomzIqoSzlqQ"),
    "one_whole_week": ("One Whole Week", "1FvVF_uuPYFv2IyMs-4_yU8YIw-RbUnGZb8BaMZNK7QY"),
    "psychotherapy": ("Psychotherapy", "1r7q1cshvIE98KYIeQsgSCT_aPtRo5QemyYFtS5NYudo"),
    "the_moon_comes_over_the_tower": ("The Moon Comes Over the Tower", "1iGRA-gLPT2eEl7u0ZbZwI2ImmKraPT6oA48_c-q_FBk"),
    "wes_romaw_the_incident": ("Wes Romaw - The Incident", "1ZRIIPWUyBdKVHh2XiT7AVyB5wMkS3KwKQnO_hXMTxrM"),
    "zachs_journey": ("Zach's Journey", "1T4ZnpK0HRxlFCLZ-I8hdQSyphPtgcyZOcspEL8Ukn3s"),
}

API = "https://www.googleapis.com/drive/v3"


def http_get(url, token, *, binary=False, tries=5):
    """GET with bearer auth and backoff on 429/5xx. Raises urllib.error.HTTPError otherwise."""
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
        except urllib.error.URLError:
            if attempt < tries - 1:
                time.sleep(2 ** attempt)
                continue
            raise


def list_revisions(file_id, token):
    revs, page = [], None
    while True:
        q = {
            "fields": "nextPageToken,revisions(id,modifiedTime,exportLinks,lastModifyingUser(displayName))",
            "pageSize": "1000",
        }
        if page:
            q["pageToken"] = page
        body = json.loads(http_get(f"{API}/files/{file_id}/revisions?{urllib.parse.urlencode(q)}", token))
        revs += body.get("revisions", [])
        page = body.get("nextPageToken")
        if not page:
            break
    revs.sort(key=lambda r: r["modifiedTime"])
    return revs


def revision_text(file_id, rev, token, cache_dir):
    """Plain text of one revision, cached on disk. None if it can't be exported."""
    cached = cache_dir / f"{file_id}.{rev['id']}.txt"
    if cached.exists():
        return cached.read_text(encoding="utf-8")
    link = (rev.get("exportLinks") or {}).get("text/plain")
    if not link:
        return None
    try:
        text = http_get(link, token)
    except urllib.error.HTTPError as e:
        print(f"    revision {rev['id']}: export failed ({e.code})", file=sys.stderr)
        return None
    cached.write_text(text, encoding="utf-8")
    return text


def changed_chars(prev, cur):
    """Characters inserted or deleted between two texts, compared paragraph by paragraph
    (fast enough for the 1 MB docs; a reworded paragraph counts as old + new)."""
    a = [p for p in prev.splitlines() if p.strip()]
    b = [p for p in cur.splitlines() if p.strip()]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    n = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            n += sum(len(p) for p in a[i1:i2]) + sum(len(p) for p in b[j1:j2])
    return n


def analyse(texts, threshold, min_chars):
    """texts: list of (revision, text-or-None) oldest first.
    Returns (rows, index of last substantial revision or None).
    Row = dict(rev, change_chars, change_frac, substantial). The first revision counts
    as substantial (it is the doc being written); revisions with no text are skipped."""
    rows, prev, last = [], None, None
    for rev, text in texts:
        if text is None:
            rows.append({"rev": rev, "change_chars": None, "change_frac": None, "substantial": False})
            continue
        if prev is None:
            row = {"rev": rev, "change_chars": len(text), "change_frac": 1.0, "substantial": True}
        else:
            n = changed_chars(prev, text)
            frac = n / max(len(prev), len(text), 1)
            row = {"rev": rev, "change_chars": n, "change_frac": frac,
                   "substantial": frac >= threshold and n >= min_chars}
        rows.append(row)
        prev = text
        if row["substantial"]:
            last = len(rows) - 1
    return rows, last


def local_date(iso, tz):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz).date().isoformat()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="revisions-report", help="output dir for CSV, SQL and the export cache")
    ap.add_argument("--threshold", type=float, default=0.05,
                    help="fraction of the text a revision must change to be substantial (default 0.05)")
    ap.add_argument("--min-chars", type=int, default=200,
                    help="and at least this many characters changed (default 200)")
    ap.add_argument("--tz", default="America/Chicago", help="timezone for revision dates (default America/Chicago)")
    ap.add_argument("--only", help="comma-separated slugs to process (default: all)")
    ap.add_argument("--sql", action="store_true", help="also write update-published-dates.sql")
    args = ap.parse_args()

    token = os.environ.get("DRIVE_TOKEN")
    if not token:
        sys.exit("Set DRIVE_TOKEN to a Drive OAuth access token (see the top of this file).")
    tz = ZoneInfo(args.tz)
    out = Path(args.out)
    cache = out / "cache"
    cache.mkdir(parents=True, exist_ok=True)

    slugs = [s.strip() for s in args.only.split(",")] if args.only else list(DOCS)
    unknown = [s for s in slugs if s not in DOCS]
    if unknown:
        sys.exit(f"Unknown slug(s): {', '.join(unknown)}")

    summary = []
    detail = []
    for slug in slugs:
        title, fid = DOCS[slug]
        print(f"{title} ({slug})", file=sys.stderr)
        try:
            revs = list_revisions(fid, token)
        except urllib.error.HTTPError as e:
            print(f"  cannot list revisions: HTTP {e.code} ({'token expired?' if e.code == 401 else 'no access?'})",
                  file=sys.stderr)
            summary.append([slug, title, fid, "", "", "", "", f"error-{e.code}"])
            if e.code == 401:
                sys.exit("Token rejected or expired; get a fresh one and rerun (cached exports are kept).")
            continue
        if not revs:
            summary.append([slug, title, fid, 0, "", "", "", "no-revisions"])
            continue
        texts = [(r, revision_text(fid, r, token, cache)) for r in revs]
        rows, last = analyse(texts, args.threshold, args.min_chars)
        for row in rows:
            r = row["rev"]
            detail.append([slug, r["id"], local_date(r["modifiedTime"], tz), r["modifiedTime"],
                           (r.get("lastModifyingUser") or {}).get("displayName", ""),
                           "" if row["change_chars"] is None else row["change_chars"],
                           "" if row["change_frac"] is None else f"{row['change_frac']:.3f}",
                           "yes" if row["substantial"] else ""])
        if last is None:
            note, suggested = "no-text-exports", ""
        else:
            suggested = local_date(rows[last]["rev"]["modifiedTime"], tz)
            note = "single-revision" if len(revs) == 1 else ""
        summary.append([slug, title, fid, len(revs),
                        local_date(revs[0]["modifiedTime"], tz), local_date(revs[-1]["modifiedTime"], tz),
                        suggested, note])
        print(f"  {len(revs)} revisions; first {summary[-1][4]}, last {summary[-1][5]}, "
              f"suggested {suggested or '-'} {note}", file=sys.stderr)

    with open(out / "summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["slug", "title", "drive_id", "revisions", "first_revision", "last_revision",
                    "suggested_published", "note"])
        w.writerows(summary)
    with open(out / "revisions.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["slug", "revision_id", "date", "modified_time_utc", "modified_by",
                    "changed_chars", "changed_fraction", "substantial"])
        w.writerows(detail)

    if args.sql:
        with open(out / "update-published-dates.sql", "w") as f:
            f.write("-- Review before running. Only fills stories that have no date yet.\nBEGIN;\n")
            for row in summary:
                if row[6]:
                    f.write(f"UPDATE stories SET \"publishedDate\" = '{row[6]}' "
                            f"WHERE slug = '{row[0]}' AND \"publishedDate\" IS NULL;\n")
            f.write("COMMIT;\n")
    print(f"\nWrote {out}/summary.csv and {out}/revisions.csv"
          + (f" and {out}/update-published-dates.sql" if args.sql else ""), file=sys.stderr)


if __name__ == "__main__":
    main()

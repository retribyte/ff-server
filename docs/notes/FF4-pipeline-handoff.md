# FF4 Blacklist / Attribution — Handoff

Picks up from `FF4-relevance-scores-second-pass.md`. That file's own analysis
is done; this tracks what happened *after* it — applying it to the real
blacklist, a misattribution bug it led to, and one new bug it surfaced along
the way. Written 2026-09-05 to resume later.

## Done this session

### 1. Applied the second-pass corrections to the real blacklist

`ff-site-new/archive-to-markdown/meta/ff4.json`'s `messageBlacklist` went
from 819 → **1246** entries across the 24 FF4 episodes:

- **Reverted 3** entries the Aug-15 pass had wrongly blacklisted, per the
  second-pass "modest bump" findings: L182 (`Ol' Dreadflower was hoppin
  around`, ep 4), L1311 (`NEW MORRA POWER`, ep 16), L1339 (`AND FOREVER
  AGAIN...`, ep 16).
- **Added 430** new entries: every row in `FF4-relevance-scores.md` scored 1
  or 2, *excluding* the ~50 line numbers the second-pass notes flagged as
  "recommend raising" or "modest bump" (i.e. rows whose own reasoning
  contradicted their score) — those aren't genuinely junk, so they were left
  off the sweep. `L1294` was deliberately *not* excluded — the notes
  explicitly walked that one back to "keep low" on a closer read.
- **Left untouched**: 762 pre-existing blacklist entries that don't map to
  any row in `FF4-relevance-scores.md` at all — those came from a separate,
  earlier curation pass against the fuller non-character-message corpus, not
  this scores table.

Done via a one-off script driving `ff4_score_editor.py`'s functions directly
(`load()` / `match_message_numbers()` / `load_blacklist_context()` /
`save_blacklist()`), not the browser GUI — no code changes to the editor
itself.

### 2. Found and fixed a real misattribution: "Marv. Take care of them."

While explaining messageNo mechanics, traced this line (ep 3 "Ambush", raw
Discord msg-idx 426) to a **bare, unlabeled ` ``` ` fence with no
Ravens-prefix character** — unlike every other Marv/Sascha/Odran/Ravens
Leader line, which is voiced via a `+`/`[`/`-`/`>` prefix inside a
`diff`/`ini`/`md`-highlighted fence (`RAVENS_PREFIXES` in
`discord-json-to-api.py`). A bare fence never reaches that prefix check at
all, so it fell into the generic fenced-block catch-all as a characterless
`OTHER` line. Confirmed by Trey as intended Ravens Leader dialogue.

Fixed in `ff-site-new/archive-to-markdown/discord-json-to-api.py`:
- New `FORCE_QUOTE_CONTAINING` tuple (mirrors the existing
  `FORCE_ACTION_CONTAINING` pattern) mapping this exact text to Ravens
  Leader / QUOTE.
- Wired into `emit_line()`: an `OTHER` line matching an entry gets
  `msg_type = "QUOTE"` and the mapped character, before the existing
  `FORCE_CHARACTER_CONTAINING` loop runs.
- Verified against a fresh regen of episode 3's `api/ff4/3_ambush.json`:
  the line now emits as `{"character": "Ravens Leader", "type": "QUOTE", ...}`.
  Single-entry relabel (no split/merge), so no messageNo shift for anything
  in that episode — confirmed safe re: the off-by-N question that started
  this thread.

**Scanned for others like it**: every bare (no-language) fence from
`retribyte` (the only author who voices these four characters) across all 24
episodes — only 5 exist total, and only the Marv one was a genuine miss. The
other 4 (ep 1 ×2, ep 13, ep 14) are DM narration/joke content — chronologically
impossible or tonally wrong as Ravens dialogue — so no further fix needed there.

## Found, NOT yet fixed: recap/briefing narration misclassified as OTHER

Also systematic, not a one-off. Every episode's `is_recap_fence()`-guarded
`ini`-fenced blocks ("Last episode, the [HORIZONERS]..." recaps, plus
scattered "Attention/ATTENTION [HORIZONERS]..." in-fiction transmissions in
ep 2/5/6) — **23 blocks across episodes 2–23** — plus the **2 bare-fence
blocks in episode 1** (same content shape, predates the `ini`-fence
convention) all currently type as `OTHER`, authored by Trey.

Checked both of Trey's proposed fixes against the data — neither holds up:
- **Attribute to the bot**: no. Every one of these 25 blocks is authored by
  `retribyte` in the raw export. `Vortox`'s messages across the *entire*
  archive are exclusively `Episode Turn`/`8ball Response` embeds — it never
  sends narrative content.
- **Type as EMBED**: no. A real Discord embed is a distinct message
  structure (title/description/fields) — exactly what Vortox's real embeds
  use. These are plain fenced text, not embeds; typing them EMBED would
  misrepresent the underlying data.

**Recommended fix (pending go-ahead)**: retype OTHER→ACTION at the point
`is_recap_fence()` already identifies these (plus a small rule for the 2
bare ep-1 blocks) — same convention the rest of the pipeline already uses
for unmarked narration prose. Author stays Trey; no bot/embed reattribution.
Not yet implemented.

## Open risk to fix before more blacklist editing: messageNo drift in the editor tool

`discord-json-to-api.py` itself is fine — it always rebuilds each episode's
full (pre-filter) message list from the raw export before interpreting
`messageBlacklist` against it, every time, so the real pipeline never drifts.

`ff4_score_editor.py`'s `match_message_numbers()` is the problem: it derives
messageNo by reading the **already-converted** `api/ff4/*.json` output file.
That's fine as long as that file was generated against an *empty* blacklist
(a straight 1:1 position match) — but once an episode's blacklist is
non-empty and its `api/ff4/*.json` gets regenerated, that file reflects the
**post-filter** (shorter) list, not the true pre-filter positions the
blacklist array actually references. Any new candidate matched against it
from that point on gets a shifted-down, wrong messageNo. (This is exactly
why the tool already flags any episode with pre-existing blacklist entries
as "untrusted" — but that's a warning banner, not a block.)

**Concretely: this already happened to episode 3.** Regenerating it this
session to verify the Marv fix means `api/ff4/3_ambush.json` on disk is now
the post-filter, 839-message version (24 blacklisted messages removed from
the 863-message full list). The other 23 episodes are still safe — their
`api/ff4/*.json` hasn't been regenerated since blacklist entries existed —
but that changes the moment any of them get regenerated for real deployment.

**Fix needed before trusting the tool's matching again**: make
`match_message_numbers()` reconstruct the full unfiltered list itself
(e.g. call `discord-json-to-api.py`'s conversion functions directly against
the raw export with an empty blacklist) instead of reading whatever's
currently on disk in `api/ff4/`.

## Uncommitted state right now

- **`ff-server`** (this repo): `FF4-relevance-scores-second-pass.md` —
  untracked, the analysis notes this all started from.
- **`ff-site-new`** (sibling repo, not this repo — commit there separately):
  - `archive-to-markdown/discord-json-to-api.py` — modified (Marv/Ravens
    Leader fix), uncommitted.
  - `archive-to-markdown/meta/ff4.json` — modified (blacklist 819 → 1246),
    uncommitted.
  - `archive-to-markdown/api/ff4/3_ambush.json` — regenerated on disk
    (gitignored build artifact, not tracked either way, just noting it no
    longer matches the other 23 episodes' generation state — see risk above).

## Next steps, in order

1. Fix the messageNo-drift risk in `ff4_score_editor.py` (above) *before*
   doing any more blacklist editing through it.
2. Decide on and implement the recap/briefing OTHER→ACTION retype.
3. Regenerate all 24 episodes' `api/ff4/*.json` once 1–2 are settled, to
   bake in the Marv fix + current blacklist for real.
4. Commit in both repos.
5. Still open from the original second-pass notes, unrelated to this
   thread: 3 "no independent context available" rows (L1076 `Kys`, L1399
   `he finds one :)`, L1821 `we hovering today`) with no raw export to check
   against, and the ~69 Tier-B low-value name-drop rows that were only
   spot-checked, not exhaustively reviewed.

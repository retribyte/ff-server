# FF4 Relevance Scores — Second Pass Notes

Second-pass review of `FF4-relevance-scores.md`, in two parts:

1. The 42 rows whose own `Reasoning` column already read as unsure.
2. A broader scan for narration/action/dialogue fragments scored low (≤5)
   despite their *own* reasoning text using narrative vocabulary
   (`action`, `narration`, `character`, `dialog`, `descriptor`, `mechanic`,
   `state`, etc.) — a self-contradiction between what the reasoning
   describes and the score it got. That pattern is what part 1 kept
   surfacing (`His hand is covered in fluid`, `*Zion eats Vec.8`, `HES DEAD`
   all fit it), so it was worth scanning systematically instead of only
   where the reasoning admitted uncertainty.

This file does **not** modify `FF4-relevance-scores.md` — use
`ff4_score_editor.py` to apply any of this before the next vetting pass.

Context came from, in order of preference: the live episode JSON
(`ff-site-new/archive-to-markdown/api/ff4/*.json`, ±3-4 messages), and
where a row's text had drifted from that, the raw Discord export
(`discord-exports/episodes/*Final Frontier 4*.json`). **FF4 isn't seeded in
the local dev DB** (only FF2 and Vortox Machina are — confirmed via
`GET /api/seasons` on the running `ff-server` dev instance), so "dev
server" context here means these on-disk pipeline artifacts, not the live
site.

---

## Part 1 — rows that flagged their own uncertainty

*(unchanged from the original pass — see prior notes below in this file's
history / the "Part 1" table)*

### Recommend raising
L25 `Emmett's cushioned` (3→6), L194 `HES DEAD` (2→5), L387 `Dee nuh` (2→5),
L595 `His hand is covered in fluid` (4→7), L638 `Quarterfette` (2→5), L876
`Emmett, what is that.` (3→7-8, likely misattributed dialogue), L1468
`*Zion eats Vec.8` (2→7), L1546 `They'll all around Seth` (2→5), L1629
`it explodes` (2→5).

### Modest bump
L182 `Ol' Dreadflower was hoppin around` (3→4-5), L552 `Petty w/ a prior`
(3→4), L834 `pepsis room` (2→3-4), L391 `Epic inflation moment` (2→3), L949
`Purrple` (3→4), L188-192 `LOWERCASE` ×5 (1→2).

### Checked, keep as-is
L21, L33, L66, L88, L89, L109, L154, L159, L180, L183, L223, L255, L404,
L446, L544, L658, L799, L889, L1002, L1392.

### No independent context available
L1076 `Kys`, L1399 `he finds one :)`, L1821 `we hovering today` — text not
found in current pipeline output *or* raw Discord export (raw export for
FF4 episodes 20-23 doesn't exist in this workspace at all).

---

## Part 2 — broader scan for mis-scored narration/action/dialogue

Method: pulled every row scored ≤5 whose reasoning text itself used
narrative vocabulary, filtered out the ones where that vocabulary was
clearly describing a joke/meme anyway (`(absurd)`, `spam`, `nickname`,
"points up" gesture-references like `bellow^`), then pulled context for the
rest. 99 candidates → 82 matched to current episode JSON, 6 more recovered
via prefix-match / raw export.

### Already fixed upstream — no action needed

11 rows are no longer type `OTHER` in the current pipeline output — they've
already been reattributed to `ACTION` or `QUOTE`, so the score in the table
is moot (the blacklist tool only ever considers `OTHER`-type text, so these
won't surface as candidates regardless of their score column):

L201 `(whispering)`, L208 `(to dutch)`, L242 `(reluctantly)`, L689 `Miny
Seth in a very soft whisper:`, L938 `Why is he duplicating?`, L944 `Did
you....talk?`, L1458 `(mockingly)`, L1480 `I saved you!`, L1481 `Hanzi,
staring at the Vec cloud:`, L1703 `Uh... Dutch?!`, L1734 `The undead
summon, sounding like Emmett:`.

### Recommend raising — clear narration/dialogue/plot content

- **L1729** `Vec was the artifact all along </3` (4) → **7-8**. This is an
  actual plot-twist reveal (the artifact the crew was hunting all season
  was Vec) sitting in the finale — about as core as content gets.
- **L751** `Like I've been a lot of things before, but I've never been a
  giant cracker` (3) → **6-7**. Full sentence of in-character dialogue
  (Dutch's wisecrack) landed as `OTHER` — misattribution, not filler.
- **L752** `"We need to make sure there are no leaks..."` (2) → **6-7**.
  Same issue — a full in-character line (a spy-parody bit) as `OTHER`.
- **L1403** `Zach's end has been irreparably damaged after meeting with
  Jack` (5) → **7**. The scores table shows this truncated with `...`,
  which is likely why it read as an ambiguous fragment — it's actually a
  complete DM narration sentence.
- **L1463** `is Hanzi scrambling about with papers all over the walls in
  the tactics room?` (3) → **6**. Same truncation issue — full DM
  narration/question about the scene, not a fragment.
- **L681/682** `I didn't specify, so it happens after the episode in
  secret` / `No one sees` (5/3) → **7 / 6**. Direct DM narration about a
  secret in-fiction event, continued two lines later with more narration.
- **L648** `Zach keeps them and puts them in his drawer` (5) → **7**.
  Continues DM narration mid-scene (Dutch's pants bit).
- **L735** `Awful, Morra turned Zach into a marble.` (5) → **7**. Narrates
  an actual in-game transformation event.
- **L950** `Yes, but it starts slithering around` (5) → **6-7**. DM
  narration directly continuing an 8ball answer, followed by a matching
  `ACTION` line describing the same slithering.
- **L1417** `Jack's alias is Huckleberry Finn` (5) → **6-7**. Genuine
  naming/lore reveal mid-scene.
- **L1932** `Tbh, I see Zach and Dutch have each other's nicknames be
  Fleshball and Fleabag respectfully` (4) → **5-6**. Full sentence,
  character lore in the finale's send-off scene — read as a fragment only
  because of the `...` truncation in the table.
- **L477** `Dutch is 2 feet tall` (4) → **6-7**. Genuine character-state
  narration in an actual size-changing scene.
- **L405** `doesnt rain glass, it rains acid` (3) → **6-7**. Directly
  anticipates/paraphrases the DM's actual next line ("It starts raining
  acid glass. And magma.").
- **L1478** `DUTCH SUFFOCATES` (1) → **5-6**. Directly follows the actual
  vacuum-in-mouth event — narrates its consequence, not just an exclamation.
- **L1476** `Purple vomit` (1) → **5**. Directly describes the `ACTION` line
  right before it ("Dutch's nose spews out purple mist").
- **L756** `THAT'S SANYA` (5) → **5-6** (keep in this range — a genuine
  in-fiction identity reveal, current score is actually reasonable, flagging
  to confirm rather than raise further).
- **L1591** `Our balls... rumble as one...!` (2) → **5**. Restates/narrates
  the just-confirmed 8ball event verbatim.
- **L1746** `Yes, but they have to use Morra's phone` (4) → **5-6**. DM
  answering an 8ball question with a real narrative constraint.
- **L1879** `yes but only for 10 seconds` (2) → **5**. DM resolving a live
  combat-mechanic question (duplicate attacking).
- **L1895 / L1898 / L1911** `(DM make him attack the leader)` / `(use the
  grenade)` / `(Toss another grenade!...)` (5/5/5) → **keep at 5**, these
  are genuinely game-relevant (player tactical instructions during the
  finale boss fight, driving the following damage rolls) — confirming
  rather than changing.

### Modest bump (weaker but still worth a nudge)

L226 `garricks sheer willpower prevented the bong from breaking` (3→5),
L234 `Fungo sits on Trey's head menacingly` (2→4-5), L270 `Is that over
comms?` (5→6), L610 `And by Brody I mean Morra` (5→5-6, confirm), L655 `no
HP?` (2→4-5), L716 `Caused by the crash, of course` (4→5-6), L850 `dutch
sniffing the body suit` (5→6, confirm), L878/879 `instead he carries ALL
PIECES` / `WITH A NEWFOUND STRENGTH` (2/2→5), L899 `(I just decided that
Sascha is a lioness)` (5→5-6, confirm), L927 `Melted fungoid` (4→5), L933
`He's not done yet` (2→4-5), L1260 `bellow is in zachs room` (3→5), L1294
`he hit it so hard, it put a crack in it` (2 — keep, it's actually a "butt
crack" pun, not narration, on closer read of full sentence), L1311/1313
`NEW MORRA POWER` / `New Morra power les go` (2/2→4), L1325 `bellow is not
close enough to hear` (3→5), L1339/1340 `AND FOREVER AGAIN...` / `HE CANT
STOP` (2/2→4-5), L1421 `center of room in everyones way` (2→4-5), L1531
`bellow was referring to zach` (3→4), L1546 (already in Part 1), L1571 `it
tickled him! hes laughing!` (3→5), L1640 `10 second clones!` (3→4-5), L1642
`Bellow's a fairly decent size` (2→4), L1914 `like pointing towards the
ground` (3→4-5).

### Checked, keep as-is (genuinely lower-value on inspection)

L88, L88 `Put him in a jar`, L89 `i did`, L347 `Dutch actually said that`,
L349 `(Wolverine)`, L569 `chomsky flame`, L588 `hallucinatory dreams`,
L722 `dutch and bellow dancing` (meme GIF caption), L747 `ok fine i pick
up`, L749 `dutch is playing fotenight` (Fortnite meme), L802 `spawning ten
dragons` (Minecraft meme), L808/L809 (snail/Pinocchio comparisons, mostly
joke asides), L925 `fungo pop`, L982/983 `X when Y`-format meme captions,
L1099 `just like edmin used to do 😔`, L1105 `it cant tell you because dutch
doesnt know`, L1116 `he cried about him`, L1156/1163 (Discord
deafen/mute mechanics, purely administrative), L1201 `stole it from a
karen`, L1228/1234 (character-descriptor jokes), L1239 (VC music meta),
L1324 `the finger is sentient`, L1363 `kick my finger*`, L1453 `DUTCH IS
ALIVE` (joke escalation), L1531, L1594 `Yeah, Emmett's a tad busy for
dialog.`, L1610 `where is he showering`, L1669, L1729's neighbors, L1825
`remember jack exploded off screen in a family guy cutaway gag` (it's a
meta pop-culture joke, not a real callback — full text resolves the
ambiguity toward *keep low*), L1885, L1888, L1920.

Also spot-checked a handful of the weaker "character name/reference" rows
that didn't carry strong narrative vocabulary in their reasoning (Tier B,
69 rows, not exhaustively checked) — most confirmed as genuinely low-value
name-drops/memes on inspection. Didn't do a full context pass on all 69;
flag if you want that too.

## Scope note

Part 1 covered 42 rows; Part 2's heuristic scan covered 99 candidates (82
verified with context) out of 1908 total rows, plus a handful of
manually-spot-checked Tier-B rows. Not a full re-score. The recurring
failure mode across both parts: **short fragments and `...`-truncated
sentences that read as ambiguous in isolation but are unambiguous once you
see the message immediately before/after** — worth keeping in mind if you
want to sample any other slice of the file the same way.

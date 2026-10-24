# FF4 Orphaned Speaker Tags

Query: `messages` in season **FF4** (Postgres `final-frontier` DB) where the
text is exactly a known character's name followed by a colon (e.g. `Emmett:`,
`Chilzor:`), found by matching `trim(text)` — trailing colon stripped —
case-insensitively against `characters.name` (full name or first word).

**Pattern:** when a player was voicing more than one character in a scene,
they'd sometimes send the new speaker's name as its own Discord message
(`Chilzor:`) as an ad-hoc cue, then send the actual line as a follow-up
message. The archive importer never merged the two — it recorded the name
as its own row (type `OTHER`, uncharacterized, or occasionally `QUOTE`
against whichever character was already active) and left the real line
that follows either **unattributed** (`OTHER`, no `characterId`) or
**misattributed** to the previously-active character.

35 messages in FF4 end with `:`. Two categories turned out to be false
positives and are excluded below:
- `Loudspeaker:` (11×, all Trey/Zion) — stylistic narration; the QUOTE that
  follows is correctly attributed to Zion himself, not a separate speaker.
- `D:` / `d:` (5×) — the ":D" emoticon reversed, which happens to match a
  stray one-letter "D" character record. Not a name.

**Confirmed: 12 rows, 5 episodes.**

## Tawfeek Residence (5)

Zander voicing both Squina and Emmett Tawfeek in the same scene.

| Tag # | Tag text | Next # | Next text | Next got attributed to | Should be |
|---|---|---|---|---|---|
| 98 | `Emmett:` | 99 | "Yeah." | *(unattributed)* | Emmett Tawfeek |
| 100 | `Squina:` | 101 | "I brought some drinks, despite this buffoon crashing our ship who knows where." | *(unattributed)* | Squina |
| 102 | `Emmett:` | 103 | "Thanks Squi." | *(unattributed)* | Emmett Tawfeek |
| 118 | `Emmett:` | 119 | "Rrright. And about the garden, we have a garden, but not enough to completely feed five." | *(unattributed)* | Emmett Tawfeek |
| 142 | `Emmett:` | 143 | "... Take care of himself." | *(unattributed)* | Emmett Tawfeek |

## Event Horizon (1)

| Tag # | Tag text | Next # | Next text | Next got attributed to | Should be |
|---|---|---|---|---|---|
| 536 | `Emmett:` | 537 | "Starting to have second thoughts here. This artifact is vital to my species' preservation, man." | Vec | Emmett Tawfeek |

## Sir, This Is A Chilzor's (2)

Two different players (Trey, then later Silas) cued the shared NPC Chilzor.

| Tag # | Tag text | Player | Next # | Next text | Next got attributed to | Should be |
|---|---|---|---|---|---|---|
| 556 | `Chilzor:` | Trey | 557 | "Uhh..eheheh, I must have heard ya wrong." | Dutch Elkins | Chilzor |
| 569 | `Chilzor:` | Silas | 570 | "INITIATING KILL MODE. I MEAN, \"DETAIN\" MODE." | Dutch Elkins | Chilzor |

## Crashlanded (3)

| Tag # | Tag text | Player | Next # | Next text | Next got attributed to | Should be |
|---|---|---|---|---|---|---|
| 490 | `Big:` | Zander | 491 | "Pay attention." | Vec | Big |
| 953 | `John:` | Hunt520 | 954 | "Glad you still think of me as my status, but I still think of you as a disappointment!" | *(unattributed)* | **John Smith** (id 3379) |
| 990 | `John:` | Hunt520 | 991 | "You brat!" | *(unattributed)* | **John Smith** (id 3379) |

Note: the character table has two similarly-named entries in this episode —
**John Smith** (id 3379, DB name `John`) and **John Smith IV** (id 3380), a
one-off joke character unrelated to these lines. Hunt520 is voicing his
character Zacharias Smith's father, John Smith, in both cases — the
`John:` tags and their orphaned follow-up lines belong to id 3379, not
3380. A plain name match against the character table is ambiguous here
and needs a human/episode-context tiebreaker, not an automated one.

## Marv Attacks! (1)

| Tag # | Tag text | Next # | Next text | Next got attributed to | Should be |
|---|---|---|---|---|---|
| 327 | `Joker:` | 328 | "Petty w/ a prior" | *(unattributed)* | Joker |

## Excluded as ambiguous

**Marv Attacks! #211** — Trey (playing Zion) sends `Zander:` as message 211,
followed by message 212, a QUOTE correctly attributed to his own character
Zion ("Ow, my fucking ears"), echoing Dutch's line from message 210. Reads
as an in-joke aside rather than a genuine speaker switch — there's no
orphaned/misattributed line following it, so it doesn't fit the pattern
above. Left out of the fix list.

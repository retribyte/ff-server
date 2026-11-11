-- Story voices become personas, the same rule as messages: a story line or
-- in-paragraph segment is voiced by a character, a character shown as one of
-- its personas, or an NPC persona alone. Adds StoryLine.personaId and the
-- story_segments table (replacing the story_lines.segments JSON), copies the
-- existing voices over, and installs the persona-match triggers for both.
--
-- Additive only: story_lines.speaker, .npcVoice and .segments stay (unread by
-- the new code) so this file is backward-compatible with the code that is live
-- until the deploy lands. A follow-up PR re-runs the backfill below for
-- anything the old code wrote in between, then drops them.
--
-- reviewed: the only UPDATE sets story_lines."personaId" (a column this file
-- adds) on lines that had a plain-text speaker; nothing is dropped or deleted.
-- The INSERTs add NPC personas (one per distinct speaker name, joining an
-- existing NPC persona of the same name) and copy the segments JSON into rows.

-- ---- DDL (from prisma migrate diff) ----------------------------------------

ALTER TABLE "story_lines" ADD COLUMN "personaId" INTEGER;

CREATE TABLE "story_segments" (
    "id" SERIAL NOT NULL,
    "lineId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "characterId" INTEGER,
    "personaId" INTEGER,
    "italic" BOOLEAN NOT NULL DEFAULT false,
    "bold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "story_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "story_segments_characterId_idx" ON "story_segments"("characterId");
CREATE INDEX "story_segments_personaId_idx" ON "story_segments"("personaId");
CREATE UNIQUE INDEX "story_segments_lineId_position_key" ON "story_segments"("lineId", "position");
CREATE INDEX "story_lines_personaId_idx" ON "story_lines"("personaId");

ALTER TABLE "story_lines" ADD CONSTRAINT "story_lines_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_segments" ADD CONSTRAINT "story_segments_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "story_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_segments" ADD CONSTRAINT "story_segments_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_segments" ADD CONSTRAINT "story_segments_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Triggers (also in prisma/scripts/create-triggers.ts) -------------------

-- A row's persona belongs to that row's character; an NPC persona's rows have
-- no character (null == null, hence IS DISTINCT FROM). Same check as
-- messages_persona_match, written generically for the story tables.
CREATE OR REPLACE FUNCTION persona_matches_character() RETURNS trigger AS $$
BEGIN
    IF NEW."personaId" IS NOT NULL AND
       (SELECT "characterId" FROM personas WHERE id = NEW."personaId") IS DISTINCT FROM NEW."characterId" THEN
        RAISE EXCEPTION 'persona % does not belong to character %', NEW."personaId", coalesce(NEW."characterId"::text, 'null (NPC)')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS story_lines_persona_match ON story_lines;
CREATE TRIGGER story_lines_persona_match
    BEFORE INSERT OR UPDATE OF "personaId", "characterId" ON story_lines
    FOR EACH ROW EXECUTE FUNCTION persona_matches_character();

DROP TRIGGER IF EXISTS story_segments_persona_match ON story_segments;
CREATE TRIGGER story_segments_persona_match
    BEFORE INSERT OR UPDATE OF "personaId", "characterId" ON story_segments
    FOR EACH ROW EXECUTE FUNCTION persona_matches_character();

-- A persona in use (now by story lines and segments too) can't change character
CREATE OR REPLACE FUNCTION personas_character_frozen() RETURNS trigger AS $$
BEGIN
    IF NEW."characterId" IS DISTINCT FROM OLD."characterId" AND (
        EXISTS (SELECT 1 FROM messages WHERE "personaId" = OLD.id) OR
        EXISTS (SELECT 1 FROM story_lines WHERE "personaId" = OLD.id) OR
        EXISTS (SELECT 1 FROM story_segments WHERE "personaId" = OLD.id)
    ) THEN
        RAISE EXCEPTION 'persona % is in use, so its character can''t change', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---- Backfill ---------------------------------------------------------------
-- Every statement skips rows already carried over, so the follow-up can
-- re-run them for rows the old code writes before the new code is up. (The
-- new code clears a line's legacy columns whenever it edits that line, so a
-- re-run can't bring back voices or segments it changed.)

-- An in-paragraph speaker pointing at a character that no longer exists would
-- fail the new foreign key with a less helpful message: stop here instead.
DO $$
DECLARE dangling bigint;
BEGIN
    SELECT count(*) INTO dangling
    FROM story_lines sl,
         jsonb_array_elements(CASE WHEN jsonb_typeof(sl.segments) = 'array' THEN sl.segments ELSE '[]'::jsonb END) seg
    WHERE nullif(seg->>'characterId', '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = (seg->>'characterId')::int);
    IF dangling > 0 THEN
        RAISE EXCEPTION '% story segment(s) point at a character that no longer exists', dangling;
    END IF;
END $$;

-- The NPC name each voice not yet carried over has: its plain-text speaker,
-- or, for an NPC voice nobody named yet, a shared placeholder (unnamed voices
-- are gone). Scoped like the UPDATE and INSERT below, so a re-run never
-- re-creates an NPC persona the new code has since deleted.
CREATE TEMP TABLE story_npc_names ON COMMIT DROP AS
SELECT DISTINCT ON (lower(name)) name
FROM (
    SELECT coalesce(nullif(btrim(speaker), ''), 'Unnamed NPC') AS name
    FROM story_lines
    WHERE "characterId" IS NULL AND "personaId" IS NULL
      AND (nullif(btrim(speaker), '') IS NOT NULL OR "npcVoice")
    UNION ALL
    SELECT coalesce(nullif(btrim(seg->>'speaker'), ''), 'Unnamed NPC')
    FROM story_lines sl,
         jsonb_array_elements(CASE WHEN jsonb_typeof(sl.segments) = 'array' THEN sl.segments ELSE '[]'::jsonb END) seg
    WHERE NOT EXISTS (SELECT 1 FROM story_segments ss WHERE ss."lineId" = sl.id)
      AND nullif(seg->>'characterId', '') IS NULL
      AND (nullif(btrim(seg->>'speaker'), '') IS NOT NULL OR seg->>'npc' = 'true')
) names
ORDER BY lower(name), name;

-- One NPC persona per name; a name an NPC persona already has (from the
-- episodes) joins it (personas_npc_name_key: unique lower(name) for NPCs)
INSERT INTO personas (name)
SELECT name FROM story_npc_names n
WHERE NOT EXISTS (SELECT 1 FROM personas p WHERE p."characterId" IS NULL AND lower(p.name) = lower(n.name));

-- Whole lines: a plain-text or NPC speaker becomes that NPC persona
UPDATE story_lines sl
SET "personaId" = p.id
FROM personas p
WHERE sl."characterId" IS NULL
  AND sl."personaId" IS NULL
  AND (nullif(btrim(sl.speaker), '') IS NOT NULL OR sl."npcVoice")
  AND p."characterId" IS NULL
  AND lower(p.name) = lower(coalesce(nullif(btrim(sl.speaker), ''), 'Unnamed NPC'));

-- Segments: one row per JSON span, in order, same voice rule
INSERT INTO story_segments ("lineId", "position", "text", "characterId", "personaId", "italic", "bold")
SELECT sl.id,
       (e.ord - 1)::int,
       coalesce(e.seg->>'text', ''),
       nullif(e.seg->>'characterId', '')::int,
       p.id,
       coalesce(e.seg->>'italic' = 'true', false),
       coalesce(e.seg->>'bold' = 'true', false)
FROM story_lines sl
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(sl.segments) = 'array' THEN sl.segments ELSE '[]'::jsonb END) WITH ORDINALITY AS e(seg, ord)
LEFT JOIN personas p
       ON nullif(e.seg->>'characterId', '') IS NULL
      AND (nullif(btrim(e.seg->>'speaker'), '') IS NOT NULL OR e.seg->>'npc' = 'true')
      AND p."characterId" IS NULL
      AND lower(p.name) = lower(coalesce(nullif(btrim(e.seg->>'speaker'), ''), 'Unnamed NPC'))
WHERE jsonb_typeof(sl.segments) = 'array'
  AND NOT EXISTS (SELECT 1 FROM story_segments ss WHERE ss."lineId" = sl.id);

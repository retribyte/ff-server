-- Follow-up to 202611102208_story-voices-as-personas.sql: drops the pre-persona
-- story voice columns story_lines.speaker, ."npcVoice" and .segments (JSON),
-- and the GIN index on segments. Nothing has read them since that release
-- (ff-server 8314cf8 / ff-site 0334bd8, both live 2026-11-11), and the API
-- has stopped deriving the matching response fields.
--
-- First it re-runs that file's backfill, unchanged, for anything the old code
-- wrote between that SQL landing and the new code going live (about 40 s on
-- 2026-11-11). Every statement skips rows already carried over, and the new
-- code clears a line's legacy columns whenever it edits that line, so the
-- re-run can't bring back a voice or segments that were changed since.
--
-- reviewed: the DROP COLUMNs remove story_lines.speaker, "npcVoice" and
-- segments, which nothing reads or writes since the story-voices release; their
-- contents were copied to story_lines."personaId" and story_segments by
-- 202611102208 and again by the backfill below, just before the drop. The only
-- UPDATE sets story_lines."personaId" on lines with a plain-text speaker that
-- have no voice yet (the same statement as 202611102208).

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

-- ---- Drop (from prisma migrate diff) ----------------------------------------

DROP INDEX "story_lines_segments_idx";

ALTER TABLE "story_lines" DROP COLUMN "npcVoice",
DROP COLUMN "segments",
DROP COLUMN "speaker";

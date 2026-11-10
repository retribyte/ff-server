-- Rename the Discord bot's account and its (message-less) character from
-- "FF 8 Ball" to "8 Ball" (the user's call, 2026-11-09). The character keeps
-- its permanent slug ff_8_ball. The import pipeline's meta maps and seeds use
-- the new name from the same release, so re-imports find the renamed account.
-- reviewed: renames two rows in place by their old name; ids, slugs and every
-- foreign key are unchanged. Skipped if "8 Ball" is already taken.
UPDATE "User" SET username = '8 Ball'
WHERE username = 'FF 8 Ball'
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE username = '8 Ball');

UPDATE characters SET name = '8 Ball'
WHERE slug = 'ff_8_ball' AND name = 'FF 8 Ball';
